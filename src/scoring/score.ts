// Popularity scoring. Produces a 0..100 composite per tool from five signals,
// each normalized against the current cohort so the score is always relative to
// the cohort rather than absolute counts:
//
//   velocity    - stars gained over the window (momentum, not size)
//   breadth     - how many distinct sources mention it (HN + Reddit + ... )
//   recency     - exponential decay on time since the latest mention
//   engagement  - upvotes/points/comments across mentions
//   established - proven adoption: log-scaled absolute stars × maintained
//
// Two weight profiles let the same scorer serve two questions: "what's HOT right
// now" (trending — velocity-led) and "what's PROVEN and worth adopting"
// (established — established-led, momentum downweighted). An old, useful,
// still-maintained repo with flat star growth scores near-zero on velocity but
// can lead the established profile — so it stops being invisible just because it
// isn't spiking.
//
// The pure functions here take plain feature objects so they're trivially
// testable; the store-backed ranker that feeds them lives in ranker.ts.

import type { ScoreBreakdown, SourceName } from "../types.js";

/** Default breadth denominator: total sources we can collect from. */
export const TOTAL_SOURCES = 5;

export type ScoreMode = "trending" | "established";

/** Weights per mode; each set sums to 1. */
const WEIGHT_PROFILES: Record<ScoreMode, Record<keyof Omit<ScoreBreakdown, "score">, number>> = {
  // Hot now: momentum leads, but established gets a real (not token) share so a
  // proven repo isn't crushed next to a spiking newcomer.
  trending: { velocity: 0.3, breadth: 0.18, recency: 0.15, engagement: 0.17, established: 0.2 },
  // Proven value: established leads; momentum/recency are minor tiebreakers.
  established: { velocity: 0.1, breadth: 0.2, recency: 0.05, engagement: 0.2, established: 0.45 },
};

const RECENCY_HALF_LIFE_HOURS = 48;

/** A repo whose maintenance is unknown isn't penalized; a stale one is damped. */
const UNMAINTAINED_FACTOR = 0.5;

export interface ToolFeatures {
  toolId: number;
  stars: number;
  /** Hours since we first saw the tool (proxy for age when no star history). */
  ageHours: number;
  /** Stars gained over the scoring window, when metric history exists. */
  starsDelta?: number;
  distinctSources: Set<SourceName>;
  mentionCount: number;
  /** Sum of points + 0.5 * comments across mentions. */
  engagementRaw: number;
  /** Hours since the most recent mention. */
  hoursSinceLastMention: number;
  /** Maintenance state from the repo's last push. False = stale (damps
   * established); undefined = unknown (no penalty). */
  maintained?: boolean;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Stars/day momentum: prefer the measured per-window delta (from tool_metrics
 * history). Only when there's no history do we fall back to amortizing total
 * stars over age — a coarse size proxy, deliberately de-weighted by the
 * log-scaled normalization below so it can't dominate ranking.
 */
function velocityRaw(f: ToolFeatures): number {
  if (f.starsDelta !== undefined && f.starsDelta >= 0) {
    return f.starsDelta; // already per-window; window is fixed across cohort
  }
  const ageDays = Math.max(f.ageHours / 24, 0.5);
  return f.stars / ageDays;
}

function recencyScore(hoursSinceLast: number): number {
  return clamp01(Math.pow(0.5, hoursSinceLast / RECENCY_HALF_LIFE_HOURS));
}

/** Proven-adoption signal before normalization: log of absolute stars, damped
 * when the repo looks unmaintained. */
function establishedRaw(f: ToolFeatures): number {
  const factor = f.maintained === false ? UNMAINTAINED_FACTOR : 1;
  return Math.log1p(Math.max(0, f.stars)) * factor;
}

/**
 * Score a whole cohort together. Velocity, engagement, and established are each
 * normalized by the cohort maximum on a log scale, so a viral outlier (a 200k-
 * star repo, or a once-in-a-cohort star spike) doesn't flatten everything else
 * to ~zero. Breadth and recency are already absolute 0..1. `mode` selects the
 * weight profile (default "trending").
 */
export function scoreTools(
  features: ToolFeatures[],
  opts: { sourceCount?: number; mode?: ScoreMode } = {},
): Map<number, ScoreBreakdown> {
  // Breadth is normalized by how many sources are actually enabled, so a repo
  // seen on every live source can still reach 1.0 even if (say) X is disabled.
  const sourceCount = Math.max(1, opts.sourceCount ?? TOTAL_SOURCES);
  const weights = WEIGHT_PROFILES[opts.mode ?? "trending"];
  const maxVelocity = Math.max(1e-6, ...features.map((f) => Math.log1p(velocityRaw(f))));
  const maxEngagement = Math.max(1e-6, ...features.map((f) => Math.log1p(f.engagementRaw)));
  const maxEstablished = Math.max(1e-6, ...features.map((f) => establishedRaw(f)));

  const result = new Map<number, ScoreBreakdown>();
  for (const f of features) {
    const velocity = clamp01(Math.log1p(velocityRaw(f)) / maxVelocity);
    const breadth = clamp01(f.distinctSources.size / sourceCount);
    const recency = recencyScore(f.hoursSinceLastMention);
    const engagement = clamp01(Math.log1p(f.engagementRaw) / maxEngagement);
    const established = clamp01(establishedRaw(f) / maxEstablished);

    const composite =
      weights.velocity * velocity +
      weights.breadth * breadth +
      weights.recency * recency +
      weights.engagement * engagement +
      weights.established * established;

    result.set(f.toolId, {
      velocity,
      breadth,
      recency,
      engagement,
      established,
      score: Math.round(composite * 1000) / 10, // one decimal, 0..100
    });
  }
  return result;
}
