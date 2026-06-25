// "Here's what's new" — the delta digest. Given a watermark (the last time you
// looked), it returns the repos that (a) were first seen after the watermark,
// (b) actually fit your stack (complements — they fill a gap), and (c) you
// haven't already decided on. That's the proactive recommendation: new, useful,
// not noise you've already seen or dismissed.

import type { Store } from "../store/db.js";
import type { TrendingEntry } from "../types.js";
import { rankTrending } from "../scoring/ranker.js";
import { ensureProfileFresh } from "../profile/profile.js";
import { classifyFit } from "../match/fit.js";
import { defaultSources } from "../ingest/collector.js";

export interface Digest {
  /** Watermark this digest is relative to (unix sec), or null for first-ever. */
  since: number | null;
  window: string;
  /** New, fitting repos since the watermark, best first. */
  items: TrendingEntry[];
}

export interface DigestOptions {
  window?: string;
  limit?: number;
  /** Only include tools first seen at/after this unix-sec watermark. */
  since: number | null;
}

function enabledSourceCount(): number {
  return defaultSources().filter((s) => s.isEnabled()).length;
}

export function buildDigest(store: Store, opts: DigestOptions): Digest {
  const window = opts.window ?? "7d";
  const limit = opts.limit ?? 10;
  const profile = ensureProfileFresh(store);

  // Rank a generous slice, then filter to the "new + fits + undecided" set.
  const ranked = rankTrending(store, {
    window,
    limit: 100,
    sourceCount: enabledSourceCount(),
  });

  const items: TrendingEntry[] = [];
  for (const entry of ranked) {
    if (opts.since !== null && entry.tool.firstSeen < opts.since) continue; // not new
    if (store.getDecision(entry.tool.id)) continue; // already accepted/rejected/installed
    const fit = classifyFit(entry.tool, profile);
    // Keep things that fill a gap (complements) AND anything we couldn't
    // categorize (uncertain) — rather than letting a keyword miss silently bury
    // a good repo, we surface it flagged "unsure" for the agent/you to judge.
    // Only confidently-classified "replaces"/"irrelevant" are dropped.
    if (fit.verdict !== "complements" && !fit.uncertain) continue;
    entry.fit = fit;
    items.push(entry);
    if (items.length >= limit) break;
  }

  return { since: opts.since, window, items };
}
