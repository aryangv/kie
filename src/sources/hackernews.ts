// Hacker News source via the free Algolia search API (no auth).
//
// We pull recent items that reference a GitHub repo from BOTH *stories* (the
// submitted URL or the title/text points at a repo) and *comments* (a repo
// surfaced in discussion — "have you tried X?"). A lot of tool-discovery signal
// lives in comment threads, so scanning them widens the radar well beyond just
// submitted links. Each query is paginated up to a bounded number of pages so a
// busy window isn't truncated to the first page.

import type { RawMention } from "../types.js";
import { extractRepoRefs } from "../ingest/extract.js";
import { getJson, type FetchOptions, type Source } from "./types.js";

interface AlgoliaHit {
  objectID: string;
  author: string | null;
  points: number | null;
  created_at_i: number;
  // story hits:
  title?: string | null;
  url?: string | null;
  num_comments?: number | null;
  story_text?: string | null;
  // comment hits:
  comment_text?: string | null;
  story_id?: number | null;
  story_title?: string | null;
}
interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbPages?: number;
}

const ENDPOINT = "https://hn.algolia.com/api/v1/search_by_date";

function itemUrl(objectID: string): string {
  return `https://news.ycombinator.com/item?id=${objectID}`;
}

/**
 * Pure transform: HN *story* hits -> mentions. A story is attributed to the
 * first repo its title/url/text references (a Show HN usually points at one).
 * Exported for testing.
 */
export function parseHnStories(hits: AlgoliaHit[]): RawMention[] {
  const out: RawMention[] = [];
  for (const hit of hits) {
    const haystack = [hit.title, hit.url, hit.story_text].filter(Boolean).join(" ");
    const refs = extractRepoRefs(haystack);
    if (refs.length === 0) continue;
    out.push({
      source: "hackernews",
      externalId: hit.objectID,
      title: hit.title ?? "(untitled)",
      url: itemUrl(hit.objectID),
      author: hit.author ?? undefined,
      points: hit.points ?? 0,
      comments: hit.num_comments ?? 0,
      createdAt: hit.created_at_i,
      repoRef: refs[0],
    });
  }
  return out;
}

/**
 * Pure transform: HN *comment* hits -> mentions. Every distinct repo a comment
 * references becomes a mention, deduped to one per (story, repo) so a repo cited
 * across many comments in the same thread isn't counted dozens of times. The
 * externalId is synthetic and stable (`hn-comment:<story>:<repo>`) so repeated
 * collections dedupe idempotently. Algolia doesn't expose comment scores, so
 * these carry 0 engagement — they widen breadth/discovery, not points.
 * Exported for testing.
 */
export function parseHnComments(hits: AlgoliaHit[]): RawMention[] {
  const seen = new Set<string>();
  const out: RawMention[] = [];
  for (const hit of hits) {
    const refs = extractRepoRefs(hit.comment_text ?? "");
    if (refs.length === 0) continue;
    const storyKey = hit.story_id != null ? String(hit.story_id) : hit.objectID;
    for (const ref of refs) {
      const key = `${storyKey}:${ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        source: "hackernews",
        externalId: `hn-comment:${key}`,
        title: hit.story_title ? `In comments: ${hit.story_title}` : "HN comment",
        url: itemUrl(hit.objectID),
        author: hit.author ?? undefined,
        points: 0,
        comments: 0,
        createdAt: hit.created_at_i,
        repoRef: ref,
      });
    }
  }
  return out;
}

// Bounded pagination: pull up to this many pages per query so a busy window
// (especially comments) isn't capped to one page, without unbounded crawling.
// Override via KIE_HN_MAX_PAGES.
function maxPages(): number {
  return Math.max(1, Number(process.env.KIE_HN_MAX_PAGES ?? 3));
}

export class HackerNewsSource implements Source {
  readonly name = "hackernews" as const;

  isEnabled() {
    return true; // no credentials required
  }

  /** Page through one Algolia tag query, stopping at the last page, an empty
   * page, the page cap, or the first failed request (partial results are kept). */
  private async fetchAllPages(tag: string, since: number, perPage: number): Promise<AlgoliaHit[]> {
    const base = `${ENDPOINT}?tags=${tag}&numericFilters=created_at_i>${since}&hitsPerPage=${perPage}`;
    const all: AlgoliaHit[] = [];
    const pages = maxPages();
    for (let page = 0; page < pages; page++) {
      let data: AlgoliaResponse;
      try {
        data = await getJson<AlgoliaResponse>(`${base}&page=${page}`);
      } catch {
        break; // a transient page failure shouldn't drop earlier pages
      }
      if (!data.hits || data.hits.length === 0) break;
      all.push(...data.hits);
      if (data.nbPages !== undefined && page >= data.nbPages - 1) break;
    }
    return all;
  }

  async fetch(opts: FetchOptions): Promise<RawMention[]> {
    const since = Math.floor(Date.now() / 1000) - opts.sinceHours * 3600;
    const perPage = Math.min(opts.limit, 1000);
    const [stories, comments] = await Promise.all([
      this.fetchAllPages("story", since, perPage),
      this.fetchAllPages("comment", since, perPage),
    ]);
    return [...parseHnStories(stories), ...parseHnComments(comments)];
  }
}
