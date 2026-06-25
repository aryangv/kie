// Extract GitHub repository references ("owner/name") from arbitrary text/URLs.
//
// Sources hand us discussion titles and links; the real signal is which repo
// they point at. We normalize every reference to a lowercase "owner/name" key
// so the same repo from HN, Reddit and Lobsters dedupes to one tool row.

/** Top-level github.com paths that are site features, not user repos. */
const RESERVED_OWNERS = new Set([
  "about", "features", "pricing", "sponsors", "topics", "trending", "collections",
  "marketplace", "explore", "settings", "notifications", "new", "login", "join",
  "orgs", "apps", "customer-stories", "readme", "security", "enterprise", "team",
  "contact", "site", "blog", "search", "stars", "dashboard", "codespaces",
]);

/** Repo names that are really owner sub-pages, not repositories. */
const RESERVED_REPOS = new Set(["sponsors", "followers", "following"]);

const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})";
const REPO = "[A-Za-z0-9_.-]+";
const GITHUB_URL = new RegExp(
  `(?:https?://)?(?:www\\.)?github\\.com/(${OWNER})/(${REPO})`,
  "gi",
);

/** Strip trailing junk a repo name may have picked up from a URL path. */
function cleanRepoName(raw: string): string {
  let name = raw;
  // Drop a trailing ".git", common in clone URLs.
  if (name.toLowerCase().endsWith(".git")) name = name.slice(0, -4);
  // A leading path segment like "repo#readme" or "repo)" — trim to valid chars.
  const m = name.match(/^[A-Za-z0-9_.-]+/);
  name = m ? m[0] : name;
  // Trailing dots are not valid in repo names.
  name = name.replace(/\.+$/, "");
  return name;
}

/**
 * Extract all distinct repo references from a string.
 * Returns normalized lowercase "owner/name" keys.
 */
export function extractRepoRefs(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(GITHUB_URL)) {
    const owner = match[1];
    const name = cleanRepoName(match[2]);
    if (!owner || !name) continue;
    if (RESERVED_OWNERS.has(owner.toLowerCase())) continue;
    if (RESERVED_REPOS.has(name.toLowerCase())) continue;
    found.add(`${owner.toLowerCase()}/${name.toLowerCase()}`);
  }
  return [...found];
}

/** Convenience: the first repo reference in a string, or undefined. */
export function firstRepoRef(text: string): string | undefined {
  return extractRepoRefs(text)[0];
}

/** Split a normalized ref into its parts. */
export function splitRef(repoRef: string): { owner: string; name: string } {
  const [owner, name] = repoRef.split("/");
  return { owner, name };
}
