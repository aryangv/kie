// GitHub Trending source. There is no official trending API, so we scrape the
// public /trending page and pull out the repo references. This is a
// supplementary signal: it ensures repos that are climbing on GitHub enter the
// system even before forums discuss them. Best-effort — markup changes are
// tolerated by matching loosely, and failures are isolated by the collector.

import type { RawMention } from "../types.js";
import { splitRef } from "../ingest/extract.js";
import type { FetchOptions, Source } from "./types.js";

const RESERVED = new Set(["trending", "topics", "collections", "sponsors", "login"]);

// Anchor on each row's "stargazers" link: href="/owner/repo/stargazers".
// Every trending repo card has exactly one, which makes this far more stable
// than keying off CSS classes (those churn; this link is structural).
const TRENDING_RE = /href="\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/stargazers"/g;

/**
 * Parse trending repo refs out of the /trending HTML. Pure + exported so a
 * markup change is caught by a unit test instead of silently returning zero.
 */
export function extractTrendingRefs(html: string): string[] {
  const seen = new Set<string>();
  for (const m of html.matchAll(TRENDING_RE)) {
    if (RESERVED.has(m[1].toLowerCase())) continue;
    seen.add(`${m[1].toLowerCase()}/${m[2].toLowerCase()}`);
  }
  return [...seen];
}

export class GitHubTrendingSource implements Source {
  readonly name = "github-trending" as const;

  isEnabled() {
    return true;
  }

  async fetch(_opts: FetchOptions): Promise<RawMention[]> {
    const res = await fetch("https://github.com/trending?since=daily", {
      headers: { "User-Agent": "kie-mcp/0.1", Accept: "text/html" },
    });
    if (!res.ok) throw new Error(`GitHub trending -> ${res.status}`);
    const html = await res.text();

    const now = Math.floor(Date.now() / 1000);
    const day = new Date().toISOString().slice(0, 10);
    const out: RawMention[] = [];

    for (const repoRef of extractTrendingRefs(html)) {
      const { owner, name } = splitRef(repoRef);
      out.push({
        source: this.name,
        externalId: `trending:${day}:${repoRef}`,
        title: `${owner}/${name} is trending on GitHub`,
        url: `https://github.com/${repoRef}`,
        points: 0,
        createdAt: now,
        repoRef,
      });
    }
    return out;
  }
}
