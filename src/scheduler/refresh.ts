// Freshness orchestration. MCP servers are spawned per IDE session, so instead
// of a long-running daemon we refresh lazily: a tool call checks how stale the
// cache is and, if needed, runs a collection pass before answering.
//
// A refresh = collect mentions from all sources -> enrich newly/again-seen
// repos via GitHub -> record a metrics snapshot (stars + mention count) so
// velocity can be measured over time.

import type { Store } from "../store/db.js";
import { collect, defaultSources, type CollectResult } from "../ingest/collector.js";
import { enrichMany } from "../enrich/github.js";
import type { Source } from "../sources/types.js";

const DEFAULT_SINCE_HOURS = 24 * 7;
const DEFAULT_FETCH_LIMIT = 200;

// Cap GitHub calls per refresh; unauthenticated limit is 60/hr (5000 with token).
// Read lazily so a .env loaded at startup is respected (module-load is too early).
function enrichCap(): number {
  return Number(process.env.KIE_ENRICH_CAP ?? (process.env.GITHUB_TOKEN ? 200 : 45));
}

// Don't re-enrich a repo whose metadata is younger than this. The GitHub data
// (stars, README, topics) barely moves hour-to-hour, so re-fetching everything
// each pass is wasted network + rate-limit budget.
function enrichFreshHours(): number {
  return Number(process.env.KIE_ENRICH_FRESH_HOURS ?? 24);
}

export interface RefreshResult {
  collect: CollectResult;
  enriched: number;
  skipped: number;
  /** Repos left untouched because their metadata was still fresh (<TTL). */
  skippedFresh: number;
  ranAt: number;
}

/** A repo candidate for enrichment, with when it was last enriched (null = never). */
export interface EnrichCandidate {
  id: number;
  repoRef: string;
  lastEnrichedAt: number | null;
}

/**
 * Choose which candidates to enrich this pass: drop any enriched more recently
 * than `cutoff` (still-fresh), then take at most `cap`, preserving input order
 * (callers pass newest-mentioned first). Pure so it can be unit-tested.
 */
export function selectForEnrich(
  candidates: EnrichCandidate[],
  cutoff: number,
  cap: number,
): { enrich: EnrichCandidate[]; freshSkipped: number } {
  const stale = candidates.filter(
    (c) => c.lastEnrichedAt === null || c.lastEnrichedAt <= cutoff,
  );
  return { enrich: stale.slice(0, cap), freshSkipped: candidates.length - stale.length };
}

export function lastRefresh(store: Store): number | null {
  const v = store.getMeta("lastRefresh");
  return v ? Number(v) : null;
}

export function isStale(store: Store, maxAgeHours: number): boolean {
  const last = lastRefresh(store);
  if (last === null) return true;
  return Date.now() / 1000 - last > maxAgeHours * 3600;
}

export async function refresh(
  store: Store,
  sources: Source[] = defaultSources(),
): Promise<RefreshResult> {
  const collectResult = await collect(
    store,
    { sinceHours: DEFAULT_SINCE_HOURS, limit: DEFAULT_FETCH_LIMIT },
    sources,
  );

  const now = Math.floor(Date.now() / 1000);

  // Enrich touched tools, newest-mentioned first: skip still-fresh repos, then
  // cap to stay within the GitHub rate budget.
  const candidates: EnrichCandidate[] = collectResult.touchedToolIds
    .map((id) => store.getTool(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .map((t) => ({ id: t.id, repoRef: t.repoRef, lastEnrichedAt: store.lastEnrichedAt(t.id) }));

  const cutoff = now - enrichFreshHours() * 3600;
  const { enrich, freshSkipped } = selectForEnrich(candidates, cutoff, enrichCap());
  const byRef = new Map(enrich.map((c) => [c.repoRef, c.id]));

  const res = await enrichMany(
    enrich.map((c) => c.repoRef),
    (meta) => {
      const toolId = byRef.get(meta.repoRef) ?? byRef.get(meta.repoRef.toLowerCase());
      if (toolId === undefined) return;
      store.applyRepoMeta(toolId, meta);
      const mentionCount = store.mentionsForTool(toolId).length;
      store.recordMetric(toolId, now, meta.stars, mentionCount);
    },
  );

  return {
    collect: collectResult,
    enriched: res.enriched,
    skipped: res.skipped,
    skippedFresh: freshSkipped,
    ranAt: now,
  };
}

/** Refresh only if the cache is older than maxAgeHours; returns the result if it ran. */
export async function refreshIfStale(
  store: Store,
  maxAgeHours: number,
  sources?: Source[],
): Promise<RefreshResult | null> {
  if (!isStale(store, maxAgeHours)) return null;
  return refresh(store, sources);
}

// A single in-flight background refresh, shared so concurrent tool calls (or a
// burst on session start) don't kick off duplicate network passes.
let inFlight: Promise<RefreshResult> | null = null;

/** Whether a background refresh is currently running. */
export function isRefreshing(): boolean {
  return inFlight !== null;
}

/**
 * Start a refresh in the background (or return the one already running). The
 * caller does NOT await this — the point is to return cached data immediately
 * and let the next call pick up the fresher data. Errors are swallowed so an
 * unawaited rejection can't crash the process.
 */
export function refreshInBackground(store: Store, sources?: Source[]): Promise<RefreshResult> {
  if (inFlight) return inFlight;
  inFlight = refresh(store, sources).finally(() => {
    inFlight = null;
  });
  inFlight.catch(() => {});
  return inFlight;
}

/**
 * Stale-while-revalidate: if the cache is stale and no refresh is already
 * running, kick one off in the background. Returns immediately. `warming` is
 * true when there's no cached data at all yet (first-ever run), so callers can
 * tell the user to check back rather than show an empty result.
 */
export function ensureFreshInBackground(
  store: Store,
  maxAgeHours: number,
  sources?: Source[],
): { warming: boolean; refreshing: boolean } {
  if (isStale(store, maxAgeHours)) refreshInBackground(store, sources);
  return { warming: lastRefresh(store) === null, refreshing: isRefreshing() };
}
