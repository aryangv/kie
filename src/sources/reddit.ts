// Reddit source via the free OAuth API (userless "client_credentials" grant).
//
// Requires a free Reddit "script" app: set REDDIT_CLIENT_ID and
// REDDIT_CLIENT_SECRET. Without them the source disables itself so the rest of
// the pipeline keeps working. Subreddits are configurable via REDDIT_SUBREDDITS
// (comma-separated); defaults cover general programming + ML + web.

import type { RawMention } from "../types.js";
import { extractRepoRefs } from "../ingest/extract.js";
import type { FetchOptions, Source } from "./types.js";

// Pages of /hot to pull per subreddit (cursor-followed). Reddit's API is free,
// so a few pages is cheap; only runs at all when Reddit credentials are set.
// Override via KIE_REDDIT_MAX_PAGES.
function redditMaxPages(): number {
  return Math.max(1, Number(process.env.KIE_REDDIT_MAX_PAGES ?? 3));
}

const DEFAULT_SUBS = [
  "programming",
  "MachineLearning",
  "webdev",
  "rust",
  "golang",
  "javascript",
  "selfhosted",
  "commandline",
];

interface RedditListing {
  data: {
    /** Cursor for the next page (fullname of the last item), null at the end. */
    after?: string | null;
    children: {
      data: {
        id: string;
        title: string;
        url: string;
        permalink: string;
        author: string;
        score: number;
        num_comments: number;
        created_utc: number;
        selftext?: string;
      };
    }[];
  };
}

/**
 * Pure transform: a subreddit listing -> mentions. Drops posts outside the
 * window or without a GitHub repo reference (in title/url/selftext). Exported
 * for offline testing.
 */
export function parseRedditListing(listing: RedditListing, sinceSec: number): RawMention[] {
  const out: RawMention[] = [];
  for (const child of listing.data?.children ?? []) {
    const p = child.data;
    if (p.created_utc < sinceSec) continue;
    const haystack = [p.title, p.url, p.selftext].filter(Boolean).join(" ");
    const refs = extractRepoRefs(haystack);
    if (refs.length === 0) continue;
    out.push({
      source: "reddit",
      externalId: p.id,
      title: p.title,
      url: `https://www.reddit.com${p.permalink}`,
      author: p.author,
      points: p.score ?? 0,
      comments: p.num_comments ?? 0,
      createdAt: Math.floor(p.created_utc),
      repoRef: refs[0],
    });
  }
  return out;
}

export class RedditSource implements Source {
  readonly name = "reddit" as const;
  private token: { value: string; expiresAt: number } | null = null;

  private get clientId() {
    return process.env.REDDIT_CLIENT_ID;
  }
  private get clientSecret() {
    return process.env.REDDIT_CLIENT_SECRET;
  }
  private get subreddits() {
    return (process.env.REDDIT_SUBREDDITS ?? DEFAULT_SUBS.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  isEnabled() {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "kie-mcp/0.1",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`Reddit token request failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return this.token.value;
  }

  async fetch(opts: FetchOptions): Promise<RawMention[]> {
    const token = await this.getToken();
    const sinceSec = Math.floor(Date.now() / 1000) - opts.sinceHours * 3600;
    const perSub = Math.max(10, Math.floor(opts.limit / this.subreddits.length));
    const limit = Math.min(perSub, 100);
    const pages = redditMaxPages();
    const headers = { Authorization: `Bearer ${token}`, "User-Agent": "kie-mcp/0.1" };
    const out: RawMention[] = [];

    for (const sub of this.subreddits) {
      // Follow the `after` cursor up to the page cap; stop early at the last
      // page or a failed request (a bad sub shouldn't sink the rest of the batch).
      let after: string | null = null;
      for (let page = 0; page < pages; page++) {
        const cursor = after ? `&after=${encodeURIComponent(after)}` : "";
        const url = `https://oauth.reddit.com/r/${sub}/hot.json?limit=${limit}${cursor}`;
        const res = await fetch(url, { headers });
        if (!res.ok) break;
        const listing = (await res.json()) as RedditListing;
        out.push(...parseRedditListing(listing, sinceSec));
        after = listing.data?.after ?? null;
        if (!after) break;
      }
    }
    return out;
  }
}
