// Run every enabled source, normalize their output, and persist mentions + the
// tools they reference. Each source is isolated: one failing or disabled source
// never sinks the batch. Returns a per-source report for observability.

import type { RawMention } from "../types.js";
import type { Store } from "../store/db.js";
import type { FetchOptions, Source } from "../sources/types.js";
import { HackerNewsSource } from "../sources/hackernews.js";
import { RedditSource } from "../sources/reddit.js";
import { LobstersSource } from "../sources/lobsters.js";
import { GitHubTrendingSource } from "../sources/githubTrending.js";
import { TwitterSource } from "../sources/twitter.js";
import { splitRef } from "./extract.js";

export function defaultSources(): Source[] {
  return [
    new HackerNewsSource(),
    new RedditSource(),
    new LobstersSource(),
    new GitHubTrendingSource(),
    new TwitterSource(),
  ];
}

export interface SourceReport {
  source: string;
  enabled: boolean;
  fetched: number;
  newMentions: number;
  error?: string;
}

export interface CollectResult {
  reports: SourceReport[];
  /** Tool ids touched in this run (candidates for enrichment + scoring). */
  touchedToolIds: number[];
}

export async function collect(
  store: Store,
  opts: FetchOptions,
  sources: Source[] = defaultSources(),
): Promise<CollectResult> {
  const reports: SourceReport[] = [];
  const touched = new Set<number>();
  const now = Math.floor(Date.now() / 1000);

  for (const source of sources) {
    if (!source.isEnabled()) {
      reports.push({ source: source.name, enabled: false, fetched: 0, newMentions: 0 });
      continue;
    }
    try {
      const mentions = await source.fetch(opts);
      let fresh = 0;
      for (const m of mentions) {
        const toolId = persistMention(store, m, now);
        if (toolId === null) continue;
        touched.add(toolId);
        if (store.insertMention(m, toolId)) fresh++;
      }
      reports.push({
        source: source.name,
        enabled: true,
        fetched: mentions.length,
        newMentions: fresh,
      });
    } catch (err) {
      reports.push({
        source: source.name,
        enabled: true,
        fetched: 0,
        newMentions: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  store.setMeta("lastRefresh", String(now));
  return { reports, touchedToolIds: [...touched] };
}

/** Ensure the tool row exists for a mention's repo and return its id. */
function persistMention(store: Store, m: RawMention, now: number): number | null {
  if (!m.repoRef) return null;
  const { name } = splitRef(m.repoRef);
  const url = `https://github.com/${m.repoRef}`;
  return store.upsertTool(m.repoRef, url, name, now);
}
