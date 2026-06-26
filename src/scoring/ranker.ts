// Bridge between the store and the pure scorer. Builds per-tool features from
// persisted mentions within a time window, scores the cohort, persists the
// scores, and returns a ranked list of trending entries.

import type { SourceName, TrendingEntry } from "../types.js";
import type { Store, MentionRow, MetricRow } from "../store/db.js";
import { scoreTools, type ScoreMode, type ToolFeatures } from "./score.js";
import { isMaintained } from "../recommend/playbooks.js";

const WINDOW_HOURS: Record<string, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

export function windowToHours(window: string): number {
  return WINDOW_HOURS[window] ?? WINDOW_HOURS["7d"];
}

export interface RankOptions {
  window: string; // "24h" | "7d" | "30d"
  language?: string;
  limit: number;
  /** Number of enabled sources, used as the breadth denominator. */
  sourceCount?: number;
  /**
   * "trending" (default): only repos mentioned within the window, momentum-led.
   * "established": every repo Kie has ever seen mentioned, proven-value-led — so
   * an old, still-useful repo surfaces even with no buzz this week.
   */
  sort?: ScoreMode;
}

/**
 * Stars gained over the scoring window, measured from the `tool_metrics` time
 * series — the real momentum signal. Baseline is the last snapshot taken at or
 * before the window cutoff; if every snapshot falls inside the window we use the
 * earliest one. Returns undefined when there's <2 snapshots (no measurable span),
 * leaving the scorer to fall back to its dampened size proxy.
 */
export function measuredStarsDelta(metrics: MetricRow[], cutoff: number): number | undefined {
  if (metrics.length < 2) return undefined;
  const latest = metrics[metrics.length - 1];
  let baseline = metrics[0];
  for (const m of metrics) {
    if (m.captured_at > cutoff) break;
    baseline = m;
  }
  const delta = latest.stars - baseline.stars;
  return delta >= 0 ? delta : 0;
}

export function rankTrending(store: Store, opts: RankOptions): TrendingEntry[] {
  const mode = opts.sort ?? "trending";
  const hours = windowToHours(opts.window);
  const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;
  const now = Math.floor(Date.now() / 1000);
  const tools = store.allTools();

  const features: ToolFeatures[] = [];
  const mentionsByTool = new Map<number, MentionRow[]>();

  for (const tool of tools) {
    const allMentions = store.mentionsForTool(tool.id);
    // Trending gates on buzz *in the window*; established considers every repo
    // we've ever seen mentioned (so an old workhorse isn't excluded just because
    // nobody posted about it this week) and scores it on all-time signal.
    const mentions = mode === "established" ? allMentions : allMentions.filter((m) => m.created_at >= cutoff);
    if (mentions.length === 0) continue;
    mentionsByTool.set(tool.id, mentions);

    const distinctSources = new Set<SourceName>(mentions.map((m) => m.source as SourceName));
    const engagementRaw = mentions.reduce((s, m) => s + m.points + 0.5 * m.comments, 0);
    const lastAt = Math.max(...mentions.map((m) => m.created_at));
    const starsDelta = measuredStarsDelta(store.metricsForTool(tool.id), cutoff);

    features.push({
      toolId: tool.id,
      stars: tool.currentStars,
      ageHours: Math.max((now - tool.firstSeen) / 3600, 1),
      starsDelta,
      distinctSources,
      mentionCount: mentions.length,
      engagementRaw,
      hoursSinceLastMention: Math.max((now - lastAt) / 3600, 0),
      maintained: isMaintained(tool.pushedAt, now),
    });
  }

  const scores = scoreTools(features, { sourceCount: opts.sourceCount, mode });

  // Persist scores for this window for transparency / later reuse. Established
  // runs are keyed separately so they don't clobber the trending scores under the
  // same window.
  const scoreKey = mode === "established" ? `${opts.window}:established` : opts.window;
  for (const [toolId, breakdown] of scores) {
    store.saveScore(toolId, scoreKey, breakdown.score, JSON.stringify(breakdown), now);
  }

  const langFilter = opts.language?.toLowerCase();
  const entries: TrendingEntry[] = [];
  for (const tool of tools) {
    const breakdown = scores.get(tool.id);
    if (!breakdown) continue;
    if (langFilter && (tool.language ?? "").toLowerCase() !== langFilter) continue;
    const mentions = mentionsByTool.get(tool.id)!;
    entries.push({
      tool,
      breakdown,
      sources: [...new Set(mentions.map((m) => m.source as SourceName))],
      mentionCount: mentions.length,
    });
  }

  entries.sort((a, b) => b.breakdown.score - a.breakdown.score);
  return entries.slice(0, opts.limit);
}
