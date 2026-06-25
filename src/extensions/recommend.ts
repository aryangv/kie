// Match the extension catalog against the user's profile + installed setup.
// Pure and testable: given extensions, profile, and the installed-id set, decide
// for each whether it's already installed, worth recommending (relevant + not
// installed), or merely optional (no clear tie to the stack).

import type { ProfileView } from "../profile/profile.js";
import type { DiscussionSignal, Extension } from "./catalog.js";

export type ExtStatus = "installed" | "recommend" | "optional";

type Relevance = "specific" | "broad" | "none";

export interface ExtensionRec {
  ext: Extension;
  status: ExtStatus;
  reason: string;
  /** How well it matched the profile, for ranking within a status bucket. */
  relevance: Relevance;
}

// Categories so generic in the Claude-Code-extension space that a match alone
// means almost nothing — nearly every skill/MCP touches "AI" and "MCP". A
// discovered item needs a *specific* category match to be a real recommendation.
const BROAD_CATEGORIES = new Set(["ai-tool", "mcp"]);

const STATUS_ORDER: Record<ExtStatus, number> = { recommend: 0, optional: 1, installed: 2 };
const RELEVANCE_ORDER: Record<Relevance, number> = { specific: 0, broad: 1, none: 2 };

export function isInstalled(ext: Extension, installed: Set<string>): boolean {
  return ext.match.some((m) => installed.has(m.toLowerCase()));
}

function relevance(ext: Extension, profileCategories: Set<string>): Relevance {
  if (ext.universal) return "specific"; // curated + universal = strong by hand
  const matched = ext.relevantCategories.filter((c) => profileCategories.has(c));
  if (matched.some((c) => !BROAD_CATEGORIES.has(c))) return "specific";
  return matched.length ? "broad" : "none";
}

function classify(ext: Extension, cats: Set<string>, installed: Set<string>): ExtensionRec {
  const rel = relevance(ext, cats);
  if (isInstalled(ext, installed)) {
    return { ext, status: "installed", reason: "Already in your setup.", relevance: rel };
  }
  // Skills that ship WITH Claude Code often aren't on disk at the scanned paths,
  // so the filesystem check above misses them. Don't pitch a built-in as a gap —
  // surface it as available, with how to enable it if it isn't already.
  if (ext.bundled) {
    return {
      ext,
      status: "installed",
      reason: "Ships with Claude Code — enable via /plugin if you haven't already.",
      relevance: rel,
    };
  }
  if (ext.discovered) {
    // Discovered subagents are popularity-driven: Kie's job is to surface what
    // the community likes to *everyone*, so a hot subagent is recommended even
    // without a stack match — a specific match just ranks it higher.
    if (ext.kind === "subagent") {
      const reason =
        rel === "specific"
          ? ext.why
          : `Liked by the community${ext.sourceRepo ? ` (from ${ext.sourceRepo})` : ""} — popular pick, verify it fits.`;
      return { ext, status: "recommend", reason, relevance: rel };
    }
    // Other discovered items are unvetted: only a SPECIFIC category match earns
    // a recommendation. A broad-only or no match is demoted, never pitched as fit.
    if (rel === "specific") return { ext, status: "recommend", reason: ext.why, relevance: rel };
    return {
      ext,
      status: "optional",
      reason: "Popular on GitHub, but not a clear match to your stack — verify relevance.",
      relevance: rel,
    };
  }
  // Curated entries are hand-vetted, so any category match (even broad) counts.
  if (rel !== "none") return { ext, status: "recommend", reason: ext.why, relevance: rel };
  return {
    ext,
    status: "optional",
    reason: "Useful in general, not tied to your current stack.",
    relevance: rel,
  };
}

export interface RecommendOptions {
  /** Cap on discovered non-subagent items shown, ranked by stars. Default 6. */
  maxDiscovered?: number;
  /** Cap on discovered subagents shown (their own budget). Default 8. */
  maxDiscoveredSubagents?: number;
}

// How many "stars of heat" one unit of discussion is worth. Tuned so active
// discussion gives mid-tier repos a real lift without letting a single small
// mention dethrone a massively-starred project.
const DISCUSSION_STAR_EQUIV = 50;

/**
 * Blended popularity: GitHub stars (what the community *likes*) plus discussion
 * heat (what's *hot now*, from collected HN/Reddit/… mentions). Pure + testable.
 * With no discussion this is just the star count, so prior star-only ordering is
 * preserved.
 */
export function popularityScore(ext: { stars?: number; discussion?: DiscussionSignal }): number {
  const stars = ext.stars ?? 0;
  const d = ext.discussion;
  // Engagement points plus a small per-mention base (breadth of discussion).
  const heat = d ? d.points + d.mentionCount * 10 : 0;
  return stars + heat * DISCUSSION_STAR_EQUIV;
}

/** Rank within a status bucket: stronger profile match first, then popularity. */
function byRelevanceThenPopularity(a: ExtensionRec, b: ExtensionRec): number {
  return (
    RELEVANCE_ORDER[a.relevance] - RELEVANCE_ORDER[b.relevance] ||
    popularityScore(b.ext) - popularityScore(a.ext)
  );
}

export function recommendExtensions(
  exts: Extension[],
  profile: ProfileView,
  installed: Set<string>,
  opts: RecommendOptions = {},
): ExtensionRec[] {
  const cats = new Set(profile.categoryIncumbents.keys());
  const maxDiscovered = opts.maxDiscovered ?? 6;
  const maxSubagents = opts.maxDiscoveredSubagents ?? 8;
  const all = exts.map((ext) => classify(ext, cats, installed));

  // Cap noisy discovery with a separate budget per "lane" so a flood of hot
  // subagents can't bury discovered MCP servers (and vice versa). Within each
  // lane: recommend before optional, then stronger match, then stars.
  const cappable = (r: ExtensionRec) => r.ext.discovered && r.status !== "installed";
  const laneSort = (a: ExtensionRec, b: ExtensionRec) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byRelevanceThenPopularity(a, b);

  const subs = all.filter((r) => cappable(r) && r.ext.kind === "subagent").sort(laneSort);
  const others = all.filter((r) => cappable(r) && r.ext.kind !== "subagent").sort(laneSort);
  const keep = new Set([...subs.slice(0, maxSubagents), ...others.slice(0, maxDiscovered)]);
  const kept = all.filter((r) => !cappable(r) || keep.has(r));

  // Final order: status, then curated before discovered, then match, then popularity.
  return kept.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      Number(!!a.ext.discovered) - Number(!!b.ext.discovered) ||
      byRelevanceThenPopularity(a, b),
  );
}

/** Merge catalogs, de-duping by id (curated wins over discovered). */
export function mergeExtensions(curated: Extension[], discovered: Extension[]): Extension[] {
  const byId = new Map<string, Extension>();
  for (const e of [...curated, ...discovered]) {
    if (!byId.has(e.id)) byId.set(e.id, e);
  }
  return [...byId.values()];
}
