// Enrich a repo reference with GitHub metadata (stars, language, topics, etc.)
// via the REST API. An optional GITHUB_TOKEN raises the rate limit from 60 to
// 5000 requests/hour and is strongly recommended. Repos that 404 (renamed or
// deleted) return null so the caller can skip them.

import type { RepoMeta } from "../types.js";
import { splitRef } from "../ingest/extract.js";

interface GitHubRepoResponse {
  full_name: string;
  html_url: string;
  name: string;
  owner: { login: string };
  description: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  forks_count: number;
  pushed_at: string | null;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "kie-mcp/0.1",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

const README_MAX = 1500;

/** Fetch one candidate README path; null on miss/error. raw.githubusercontent
 * doesn't count against the REST API rate limit, so this is safe per enrichment. */
async function fetchReadmeFile(owner: string, name: string, file: string): Promise<string | null> {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/HEAD/${file}`, {
      headers: { "User-Agent": "kie-mcp/0.1" },
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, README_MAX).trim();
  } catch {
    return null;
  }
}

/**
 * Fetch a README excerpt from raw.githubusercontent.com. `README.md` covers the
 * overwhelming majority of repos, so we try it alone first (one request in the
 * common case); only if it's missing do we probe the rarer names — and those go
 * out in parallel, so a README-less/oddly-named repo costs one extra round-trip
 * instead of four more sequential 404s. Returns null if none is reachable.
 */
async function fetchReadme(owner: string, name: string): Promise<string | null> {
  const primary = await fetchReadmeFile(owner, name, "README.md");
  if (primary !== null) return primary;
  const fallbacks = ["readme.md", "README.markdown", "README.rst", "README.txt"];
  const results = await Promise.all(fallbacks.map((f) => fetchReadmeFile(owner, name, f)));
  return results.find((r) => r !== null) ?? null;
}

export async function enrichRepo(repoRef: string): Promise<RepoMeta | null> {
  const { owner, name } = splitRef(repoRef);
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
    headers: authHeaders(),
  });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) {
    throw new Error(`GitHub rate limit hit for ${repoRef} (set GITHUB_TOKEN to raise it)`);
  }
  if (!res.ok) throw new Error(`GitHub repo ${repoRef} -> ${res.status}`);
  const r = (await res.json()) as GitHubRepoResponse;
  const readme = await fetchReadme(r.owner.login, r.name);

  return {
    repoRef: r.full_name.toLowerCase(),
    url: r.html_url,
    name: r.name,
    owner: r.owner.login,
    description: r.description,
    language: r.language,
    topics: r.topics ?? [],
    stars: r.stargazers_count,
    forks: r.forks_count,
    pushedAt: r.pushed_at ? Math.floor(Date.parse(r.pushed_at) / 1000) : null,
    readme,
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

/** Default number of repos enriched concurrently. Kept modest to stay well
 * under GitHub's secondary (concurrent-request) rate limits. */
export const DEFAULT_ENRICH_CONCURRENCY = 6;

/**
 * Core of {@link enrichMany}, with the per-repo fetcher injected so it can be
 * tested without hitting the network. Runs up to `concurrency` fetches at once
 * via a fixed worker pool; each result is delivered through `onResult` as it
 * arrives (SQLite writes there are synchronous, so they serialize safely on the
 * JS thread). Fault-tolerant: a repo that 404s or throws is counted as skipped
 * so one bad repo never aborts the batch.
 */
export async function enrichManyWith(
  repoRefs: string[],
  fetchOne: (ref: string) => Promise<RepoMeta | null>,
  onResult: (meta: RepoMeta) => void,
  concurrency: number = DEFAULT_ENRICH_CONCURRENCY,
): Promise<{ enriched: number; skipped: number }> {
  let enriched = 0;
  let skipped = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < repoRefs.length) {
      const ref = repoRefs[next++];
      try {
        const meta = await fetchOne(ref);
        if (meta) {
          onResult(meta);
          enriched++;
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, repoRefs.length));
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return { enriched, skipped };
}

/**
 * Enrich many repos, throttled and fault-tolerant. Returns counts of repos that
 * resolved vs. were skipped (404/error). Failures are isolated so one bad repo
 * (or a transient error) doesn't abort the batch.
 */
export async function enrichMany(
  repoRefs: string[],
  onResult: (meta: RepoMeta) => void,
  concurrency: number = DEFAULT_ENRICH_CONCURRENCY,
): Promise<{ enriched: number; skipped: number }> {
  return enrichManyWith(repoRefs, enrichRepo, onResult, concurrency);
}
