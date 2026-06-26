// Shared domain types for Kie.

/** The platforms we collect signal from. */
export type SourceName =
  | "hackernews"
  | "reddit"
  | "lobsters"
  | "github-trending"
  | "twitter";

/**
 * A single normalized signal from a source: someone talked about something,
 * somewhere, at some time. Sources emit these; the collector persists them.
 */
export interface RawMention {
  source: SourceName;
  /** Stable id from the source (e.g. HN object id, reddit fullname) for dedupe. */
  externalId: string;
  /** The post/comment title or text we extracted the reference from. */
  title: string;
  /** Link to the discussion (not the repo). */
  url: string;
  author?: string;
  /** Engagement signal from the source: HN points, reddit upvotes, etc. */
  points: number;
  /** Number of comments / replies, when available. */
  comments?: number;
  /** Unix epoch seconds when the discussion was posted. */
  createdAt: number;
  /**
   * GitHub repo reference extracted from this mention, "owner/name".
   * Undefined when no repo could be extracted (mention is dropped in that case).
   */
  repoRef?: string;
}

/** Enriched metadata for a GitHub repository. */
export interface RepoMeta {
  repoRef: string; // owner/name
  url: string;
  name: string;
  owner: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  pushedAt: number | null; // unix seconds
  /** First ~1500 chars of the README, for richer agent context. Null if none. */
  readme: string | null;
  fetchedAt: number; // unix seconds
}

/** A deduped tool/repo row as stored. */
export interface Tool {
  id: number;
  repoRef: string;
  url: string;
  name: string;
  description: string | null;
  language: string | null;
  topics: string[];
  currentStars: number;
  /** README excerpt cached at enrichment time; undefined if not yet fetched. */
  readme?: string | null;
  /** Unix seconds of the repo's last push, from enrichment. Drives the
   * maintained/established signals. Undefined/null when not yet enriched. */
  pushedAt?: number | null;
  firstSeen: number;
}

/** Computed popularity breakdown for transparency. */
export interface ScoreBreakdown {
  velocity: number; // 0..1 normalized
  breadth: number; // 0..1 normalized
  recency: number; // 0..1 normalized
  engagement: number; // 0..1 normalized
  /** Established/proven adoption: log-scaled absolute stars × maintained. 0..1. */
  established: number;
  /** Final 0..100 composite. */
  score: number;
}

/**
 * Verdict of matching a tool against the living user profile. The classifier in
 * match/fit.ts (Slice 2) produces these; defined here so shared types don't
 * depend on a module that arrives later.
 */
export interface FitVerdict {
  verdict: "replaces" | "complements" | "irrelevant";
  /** Human-readable explanation the agent can relay. */
  reason: string;
  /** Profile entries that drove the verdict (e.g. the tool you already use). */
  related: string[];
  /**
   * True when we couldn't categorize the repo, so the verdict is a low-confidence
   * guess. Consumers (e.g. the digest gate) should surface these for the agent to
   * judge rather than silently drop them.
   */
  uncertain?: boolean;
}

/** A trending entry: tool + score + (optionally) fit against the user profile. */
export interface TrendingEntry {
  tool: Tool;
  breakdown: ScoreBreakdown;
  sources: SourceName[];
  mentionCount: number;
  fit?: FitVerdict;
}
