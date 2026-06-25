// The pluggable source contract. Each platform (HN, Reddit, Lobsters, GitHub,
// and later X/Twitter) implements Source. The collector treats them uniformly,
// so adding a new platform never touches the core.

import type { RawMention, SourceName } from "../types.js";

export interface Source {
  readonly name: SourceName;
  /** True when the source is usable (e.g. required credentials are present). */
  isEnabled(): boolean;
  /**
   * Fetch recent items and return normalized mentions. Implementations should
   * already have attached repoRef where one was found; the collector drops
   * mentions without a repoRef. Network/parse errors should be thrown; the
   * collector isolates each source so one failure doesn't sink the batch.
   */
  fetch(opts: FetchOptions): Promise<RawMention[]>;
}

export interface FetchOptions {
  /** Only return items newer than this many hours ago. */
  sinceHours: number;
  /** Soft cap on items to pull per source. */
  limit: number;
}

/** Minimal typed fetch-JSON helper shared by adapters. */
export async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "kie-mcp/0.1 (+https://github.com)", ...headers },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}
