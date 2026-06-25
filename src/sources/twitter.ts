// X / Twitter source via the X API v2 recent-search endpoint. Bring-your-own
// credentials: set X_BEARER_TOKEN (or TWITTER_BEARER_TOKEN). Without it the
// source disables itself, exactly like Reddit.
//
// Note on URLs: tweet text contains t.co-shortened links, so the real GitHub
// URL only appears in entities.urls[].expanded_url — we request that field and
// extract repo refs from there (falling back to the raw text just in case).
//
// Caveat: X's recent search is gated behind paid API tiers. The plumbing here
// is correct for any tier that grants /2/tweets/search/recent; on a tier that
// doesn't, the call 4xxs and the collector isolates it.

import type { RawMention } from "../types.js";
import { extractRepoRefs } from "../ingest/extract.js";
import type { FetchOptions, Source } from "./types.js";

const DEFAULT_QUERY =
  '("github.com" (tool OR library OR framework OR launched OR "open source" OR release)) ' +
  "-is:retweet -is:reply lang:en";

interface TweetEntitiesUrl {
  expanded_url?: string;
  unwound_url?: string;
}
interface Tweet {
  id: string;
  text: string;
  created_at?: string;
  public_metrics?: { like_count: number; retweet_count: number; reply_count: number };
  entities?: { urls?: TweetEntitiesUrl[] };
}
interface SearchResponse {
  data?: Tweet[];
  meta?: { next_token?: string };
}

// Pages of recent-search to pull per refresh (next_token-followed). X search is
// behind a PAID tier and each page is a separate billed request, so this stays
// modest and only runs when a bearer token is set. Override via KIE_X_MAX_PAGES.
function xMaxPages(): number {
  return Math.max(1, Number(process.env.KIE_X_MAX_PAGES ?? 2));
}

/**
 * Pure transform: a recent-search response -> mentions. Prefers the expanded /
 * unwound URLs (t.co hides the real link in the text), drops tweets outside the
 * window or with no GitHub repo reference. Exported for offline testing.
 */
export function parseTweets(json: SearchResponse, sinceSec: number): RawMention[] {
  const out: RawMention[] = [];
  for (const tweet of json.data ?? []) {
    const createdSec = tweet.created_at
      ? Math.floor(Date.parse(tweet.created_at) / 1000)
      : Math.floor(Date.now() / 1000);
    if (createdSec < sinceSec) continue;

    const urls = (tweet.entities?.urls ?? [])
      .map((u) => u.unwound_url || u.expanded_url)
      .filter((u): u is string => Boolean(u));
    const haystack = [...urls, tweet.text].join(" ");
    const refs = extractRepoRefs(haystack);
    if (refs.length === 0) continue;

    const m = tweet.public_metrics;
    out.push({
      source: "twitter",
      externalId: tweet.id,
      title: tweet.text.slice(0, 200),
      url: `https://x.com/i/status/${tweet.id}`,
      points: (m?.like_count ?? 0) + (m?.retweet_count ?? 0),
      comments: m?.reply_count ?? 0,
      createdAt: createdSec,
      repoRef: refs[0],
    });
  }
  return out;
}

export class TwitterSource implements Source {
  readonly name = "twitter" as const;

  private get bearer() {
    return process.env.X_BEARER_TOKEN ?? process.env.TWITTER_BEARER_TOKEN;
  }
  private get query() {
    return process.env.X_SEARCH_QUERY ?? DEFAULT_QUERY;
  }

  isEnabled() {
    return Boolean(this.bearer);
  }

  async fetch(opts: FetchOptions): Promise<RawMention[]> {
    const max = Math.min(Math.max(opts.limit, 10), 100); // API allows 10..100
    const sinceSec = Math.floor(Date.now() / 1000) - opts.sinceHours * 3600;
    const headers = { Authorization: `Bearer ${this.bearer}`, "User-Agent": "kie-mcp/0.1" };
    const out: RawMention[] = [];
    let nextToken: string | undefined;

    for (let page = 0; page < xMaxPages(); page++) {
      const params = new URLSearchParams({
        query: this.query,
        max_results: String(max),
        "tweet.fields": "created_at,public_metrics,entities",
      });
      if (nextToken) params.set("next_token", nextToken);
      const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, { headers });
      if (!res.ok) {
        // A first-page failure is a real error (bad tier/rate limit); a later-page
        // failure shouldn't discard the tweets we already collected.
        if (page === 0) throw new Error(`X recent search -> ${res.status} (tier may not allow search)`);
        break;
      }
      const json = (await res.json()) as SearchResponse;
      out.push(...parseTweets(json, sinceSec));
      nextToken = json.meta?.next_token;
      if (!nextToken) break;
    }
    return out;
  }
}
