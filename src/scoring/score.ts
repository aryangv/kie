// Popularity scoring. Produces a 0..100 composite per tool from four signals,
// each normalized against the current cohort so the score is always relative to
// "what's hot right now" rather than absolute counts:
//
//   velocity   - stars gained per day (momentum, not size)
//   breadth    - how many distinct sources mention it (HN + Reddit + ... )
//   recency    - exponential decay on time since the latest mention
//   engagement - upvotes/points/comments across mentions
//
// The pure functions here take plain feature objects so they're trivially
// testable; the store-backed ranker that feeds them lives in ranker.ts.

import type { ScoreBreakdown, SourceName } from "../types.js";

/** Default breadth denominator: total sources we can collect from. */
export const TOTAL_SOURCES = 5;

const WEIGHTS = { velocity: 0.35, breadth: 0.25, recency: 0.2, engagement: 0.2 };
const RECENCY_HALF_LIFE_HOURS = 48;

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

/**
 * Score a whole cohort together. Velocity and engagement are both normalized by
 * the cohort maximum on a log scale, so a viral outlier (a 200k-star repo, or a
 * once-in-a-cohort star spike) doesn't flatten everything else to ~zero. Breadth
 * and recency are already absolute 0..1.
 */
export function scoreTools(
  features: ToolFeatures[],
  opts: { sourceCount?: number } = {},
): Map<number, ScoreBreakdown> {
  // Breadth is normalized by how many sources are actually enabled, so a repo
  // seen on every live source can still reach 1.0 even if (say) X is disabled.
  const sourceCount = Math.max(1, opts.sourceCount ?? TOTAL_SOURCES);
  const maxVelocity = Math.max(1e-6, ...features.map((f) => Math.log1p(velocityRaw(f))));
  const maxEngagement = Math.max(1e-6, ...features.map((f) => Math.log1p(f.engagementRaw)));

  const result = new Map<number, ScoreBreakdown>();
  for (const f of features) {
    const velocity = clamp01(Math.log1p(velocityRaw(f)) / maxVelocity);
    const breadth = clamp01(f.distinctSources.size / sourceCount);
    const recency = recencyScore(f.hoursSinceLastMention);
    const engagement = clamp01(Math.log1p(f.engagementRaw) / maxEngagement);

    const composite =
      WEIGHTS.velocity * velocity +
      WEIGHTS.breadth * breadth +
      WEIGHTS.recency * recency +
      WEIGHTS.engagement * engagement;

    result.set(f.toolId, {
      velocity,
      breadth,
      recency,
      engagement,
      score: Math.round(composite * 1000) / 10, // one decimal, 0..100
    });
  }
  return result;
}
