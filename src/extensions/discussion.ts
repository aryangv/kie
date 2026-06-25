// Fold the discussion signal Kie already collects (HN/Reddit/Lobsters/… mentions
// of GitHub repos) into the extension recommender. Stars say what the community
// *likes* over time; discussion says what's *hot right now* — both matter for
// "give users what the community is into," so we cross-reference discovered
// extension repos against the mention store and let it boost ranking.

import type { Store } from "../store/db.js";
import type { DiscussionSignal, Extension } from "./catalog.js";

/** Aggregate a repo's mentions into a discussion signal. Pure + testable. */
export function summarizeDiscussion(
  mentions: { source: string; points: number }[],
): DiscussionSignal {
  const sources = [...new Set(mentions.map((m) => m.source))];
  const points = mentions.reduce((sum, m) => sum + (m.points || 0), 0);
  return { mentionCount: mentions.length, points, sources };
}

/**
 * Annotate extensions in place with the discussion signal for their repo, looked
 * up from the mention store by `repoRef`. Best-effort: items without a repoRef
 * (curated) are left untouched. Results are cached per repoRef so the many
 * individual subagents sharing one source repo only trigger a single lookup.
 *
 * We assign unconditionally (even `undefined`) rather than only-when-present, so
 * a re-annotated extension never keeps a stale signal from a previous pass —
 * relevant if a shared catalog object is reused across calls.
 */
export function annotateDiscussion(exts: Extension[], store: Store): void {
  const cache = new Map<string, DiscussionSignal | undefined>();
  for (const ext of exts) {
    if (!ext.repoRef) continue;
    if (!cache.has(ext.repoRef)) {
      const tool = store.getToolByRef(ext.repoRef);
      const mentions = tool ? store.mentionsForTool(tool.id) : [];
      cache.set(ext.repoRef, mentions.length ? summarizeDiscussion(mentions) : undefined);
    }
    ext.discussion = cache.get(ext.repoRef);
  }
}
