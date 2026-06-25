// Lobsters source via public JSON feeds (no auth). The "hottest" feed alone is
// only ~25 stories and skews to blog posts, so we merge several feeds —
// hottest + newest by default, plus any tag feeds you configure — and dedupe by
// story id. We keep stories that link to or mention a GitHub repo.
//
// Feeds are configurable via LOBSTERS_FEEDS (comma-separated). Each entry maps
// to https://lobste.rs/<entry>.json, e.g. "hottest", "newest", "t/rust",
// "t/programming". Default: "hottest,newest".

import type { RawMention } from "../types.js";
import { extractRepoRefs } from "../ingest/extract.js";
import { getJson, type FetchOptions, type Source } from "./types.js";

interface LobstersStory {
  short_id: string;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  created_at: string; // ISO
  submitter_user?: string | { username: string };
  comments_url: string;
  description_plain?: string;
}

const DEFAULT_FEEDS = ["hottest", "newest"];

function submitter(s: LobstersStory): string | undefined {
  if (!s.submitter_user) return undefined;
  return typeof s.submitter_user === "string" ? s.submitter_user : s.submitter_user.username;
}

/**
 * Pure transform: dedupe stories by short_id, drop those outside the window or
 * without a GitHub repo reference, and map to mentions. Exported for testing.
 */
export function parseLobsters(stories: LobstersStory[], sinceMs: number): RawMention[] {
  const seen = new Set<string>();
  const out: RawMention[] = [];
  for (const s of stories) {
    if (seen.has(s.short_id)) continue;
    seen.add(s.short_id);
    const createdMs = Date.parse(s.created_at);
    if (Number.isFinite(createdMs) && createdMs < sinceMs) continue;
    const haystack = [s.title, s.url, s.description_plain].filter(Boolean).join(" ");
    const refs = extractRepoRefs(haystack);
    if (refs.length === 0) continue;
    out.push({
      source: "lobsters",
      externalId: s.short_id,
      title: s.title,
      url: s.comments_url,
      author: submitter(s),
      points: s.score ?? 0,
      comments: s.comment_count ?? 0,
      createdAt: Math.floor((Number.isFinite(createdMs) ? createdMs : Date.now()) / 1000),
      repoRef: refs[0],
    });
  }
  return out;
}

export class LobstersSource implements Source {
  readonly name = "lobsters" as const;

  private get feeds(): string[] {
    return (process.env.LOBSTERS_FEEDS ?? DEFAULT_FEEDS.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  isEnabled() {
    return true;
  }

  async fetch(opts: FetchOptions): Promise<RawMention[]> {
    const sinceMs = Date.now() - opts.sinceHours * 3600 * 1000;
    const merged: LobstersStory[] = [];
    for (const feed of this.feeds) {
      try {
        const stories = await getJson<LobstersStory[]>(`https://lobste.rs/${feed}.json`);
        merged.push(...stories);
      } catch {
        // Skip a bad/empty feed rather than failing the whole source.
      }
    }
    return parseLobsters(merged, sinceMs).slice(0, opts.limit);
  }
}
