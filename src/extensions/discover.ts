// GitHub-search discovery for Claude Code extensions. There's no extension
// registry, so we search by the conventional GitHub topics and turn the top
// repos into catalog entries, categorizing them via the shared taxonomy so the
// recommender can judge relevance. Best-effort: any failure returns [].

import type { Extension, ExtensionKind } from "./catalog.js";
import { categorize } from "../match/taxonomy.js";

interface RepoHit {
  full_name: string;
  html_url: string;
  description: string | null;
  topics?: string[];
  stargazers_count: number;
  default_branch?: string;
}
interface SearchResponse {
  items?: RepoHit[];
}

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "kie-mcp/0.1",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

// GitHub topic -> the kind of extension it denotes.
const TOPIC_KIND: { topic: string; kind: ExtensionKind }[] = [
  { topic: "claude-code-skill", kind: "skill" },
  { topic: "claude-skill", kind: "skill" },
  { topic: "mcp-server", kind: "mcp-server" },
  { topic: "claude-code-plugin", kind: "plugin" },
  { topic: "claude-code-subagent", kind: "subagent" },
  { topic: "claude-subagents", kind: "subagent" },
];

function installFor(kind: ExtensionKind, repo: RepoHit): string[] {
  const { full_name } = repo;
  const name = full_name.split("/")[1];
  switch (kind) {
    case "mcp-server":
      return [
        `claude mcp add ${name} -- npx -y ${name}`,
        `(Verify the exact package/run command in the README: ${repo.html_url})`,
      ];
    case "plugin":
      return [
        `/plugin marketplace add ${full_name}`,
        `/plugin install ${name}`,
        `(Confirm the marketplace/plugin name in the README: ${repo.html_url})`,
      ];
    case "skill":
      return [
        `Copy its SKILL.md into .claude/skills/${name}/ (or install the plugin that ships it).`,
        `Source: ${repo.html_url}`,
      ];
    case "subagent":
      return [
        `Copy the agent .md file(s) into .claude/agents/ (this repo is a subagent collection).`,
        `Source: ${repo.html_url}`,
      ];
    case "saas":
      return [`Get it: ${repo.html_url}`];
  }
}

async function searchTopicRepos(topic: string, perTopic: number): Promise<RepoHit[]> {
  const url =
    `https://api.github.com/search/repositories?q=topic:${topic}` +
    `&sort=stars&order=desc&per_page=${perTopic}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) return [];
  const data = (await res.json()) as SearchResponse;
  return data.items ?? [];
}

/** Turn a whole repo into one extension entry (used for non-subagent kinds, and
 * as the fallback when a subagent repo yields no individual agent files). */
function repoToExtension(repo: RepoHit, kind: ExtensionKind): Extension {
  const ref = repo.full_name.toLowerCase();
  const name = repo.full_name.split("/")[1];
  const cats = [...categorize({ name, topics: repo.topics, description: repo.description })];
  return {
    id: `gh:${ref}`,
    kind,
    name,
    description: repo.description ?? "(no description)",
    url: repo.html_url,
    relevantCategories: cats,
    match: [name.toLowerCase(), ref],
    install: installFor(kind, repo),
    why: `Popular on GitHub (★${repo.stargazers_count.toLocaleString()})${repo.description ? ` — ${repo.description}` : ""}`,
    discovered: true,
    stars: repo.stargazers_count,
    repoRef: ref,
  };
}

// ---- Individual subagent extraction --------------------------------------
//
// "What's hot" for subagents means the actual prompts people use, not just the
// repos that hold them. Most popular subagent repos are *collections* of
// `.claude/agents/*.md` files, so we drill in: list the tree, pick the agent
// files, fetch each one's prompt, and surface them individually — inheriting the
// repo's star count as the popularity signal.

const SKIP_MD = new Set([
  "readme.md", "license.md", "contributing.md", "changelog.md",
  "code_of_conduct.md", "security.md", "index.md", "summary.md",
]);

// "agent"/"agents"/"subagent" as a whole token in a filename — so `code-agent.md`
// and `agents.md` qualify, but `reagent.md` / `management.md` (incidental
// substrings) don't.
const AGENT_NAME = /(^|[-_. ])(sub)?agents?([-_. ]|$)/;

/**
 * Heuristic: is this repo path an agent/subagent prompt file? Pure + testable.
 * We require either an `agents`/`subagents` *directory* segment or an "agent"
 * token in the filename, so we don't slurp ordinary docs. README/LICENSE/etc.
 * excluded.
 */
export function isAgentFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (!lower.endsWith(".md")) return false;
  const segs = lower.split("/");
  const base = segs.pop() ?? lower; // segs is now directory segments only
  if (SKIP_MD.has(base)) return false;
  const inAgentsDir = segs.includes("agents") || segs.includes("subagents") || segs.includes("agent");
  return inAgentsDir || AGENT_NAME.test(base);
}

export interface ParsedAgent {
  name?: string;
  description?: string;
  /** The prompt body with any YAML frontmatter stripped. */
  body: string;
}

function frontmatterField(front: string, field: string): string | undefined {
  const m = front.match(new RegExp(`^${field}\\s*:\\s*(.+)$`, "im"));
  if (!m) return undefined;
  return m[1].trim().replace(/^["']|["']$/g, "").trim() || undefined;
}

/**
 * Parse a Claude Code agent `.md` file: pull `name`/`description` from YAML
 * frontmatter when present, else fall back to the first heading / first prose
 * line. Returns the prompt body with frontmatter stripped. Pure + testable.
 */
export function parseAgentMarkdown(raw: string): ParsedAgent {
  let body = raw;
  let name: string | undefined;
  let description: string | undefined;

  const fm = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fm) {
    name = frontmatterField(fm[1], "name");
    description = frontmatterField(fm[1], "description");
    body = fm[2];
  }
  const lines = body.split(/\r?\n/);
  if (!name) {
    const heading = lines.find((l) => /^#\s+\S/.test(l));
    if (heading) name = heading.replace(/^#\s+/, "").trim();
  }
  if (!description) {
    const prose = lines.find((l) => l.trim() && !/^#/.test(l) && !/^[-*]\s/.test(l));
    if (prose) description = prose.trim();
  }
  return { name, description, body: body.trim() };
}

interface TreeResponse {
  tree?: { path: string; type: string }[];
}

async function fetchAgentFilePaths(repo: RepoHit, maxFiles: number): Promise<string[]> {
  const branch = repo.default_branch ?? "main";
  const [owner, name] = repo.full_name.split("/");
  const url = `https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) return [];
  const data = (await res.json()) as TreeResponse;
  return (data.tree ?? [])
    .filter((e) => e.type === "blob" && isAgentFile(e.path))
    .map((e) => e.path)
    .slice(0, maxFiles);
}

function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}

/** Expand one subagent repo into individual subagent extensions (with prompts). */
async function expandSubagentRepo(repo: RepoHit, maxFiles: number): Promise<Extension[]> {
  const [owner, name] = repo.full_name.split("/");
  const branch = repo.default_branch ?? "main";
  const paths = await fetchAgentFilePaths(repo, maxFiles);
  if (paths.length === 0) return [];

  const results = await Promise.all(
    paths.map(async (path): Promise<Extension | null> => {
      const raw = await fetchText(`https://raw.githubusercontent.com/${owner}/${name}/${branch}/${path}`);
      if (!raw || !raw.trim()) return null;
      const parsed = parseAgentMarkdown(raw);
      const agentName = parsed.name ?? (path.split("/").pop() ?? "agent").replace(/\.md$/i, "");
      const cats = [...categorize({ name: agentName, description: parsed.description })];
      return {
        id: `gh:${repo.full_name.toLowerCase()}:${slug(agentName)}`,
        kind: "subagent",
        name: agentName,
        description: parsed.description ?? "(no description)",
        url: `https://github.com/${owner}/${name}/blob/${branch}/${path}`,
        relevantCategories: cats,
        match: [agentName.toLowerCase(), slug(agentName)],
        install: [`Save the prompt below as .claude/agents/${slug(agentName)}.md`],
        why: `Liked by the community (★${repo.stargazers_count.toLocaleString()} on ${repo.full_name})`,
        discovered: true,
        stars: repo.stargazers_count,
        content: parsed.body,
        sourceRepo: repo.full_name,
        repoRef: repo.full_name.toLowerCase(),
      } satisfies Extension;
    }),
  );
  return results.filter((e): e is Extension => e !== null);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "kie-mcp/0.1" } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/**
 * Pull a real `claude mcp add …` command out of a README, if present. MCP server
 * READMEs almost always include the exact command — that's the strongest signal,
 * far better than guessing the package name from the repo slug. Pure + testable.
 */
export function mcpAddCommandFromReadme(readme: string): string | null {
  for (const raw of readme.split(/\r?\n/)) {
    const line = raw.replace(/^[\s$>`#-]+/, "").trim(); // strip md/code prompt noise
    if (/^claude\s+mcp\s+add\s+/i.test(line)) {
      return line.replace(/`+$/, "").trim();
    }
  }
  return null;
}

/**
 * Resolve a discovered extension's install command from its actual repo
 * (README `claude mcp add`, then package.json name, then a Python hint), instead
 * of the slug guess. Best-effort and bounded — call it only on items you'll show.
 */
export async function resolveInstall(ext: Extension): Promise<void> {
  if (!ext.discovered) return;
  const m = ext.url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!m) return;
  const [, owner, repo] = m;
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;

  // 1) Strongest: a literal `claude mcp add` line in the README (MCP servers).
  if (ext.kind === "mcp-server") {
    const readme = await fetchText(`${base}/README.md`);
    const cmd = readme && mcpAddCommandFromReadme(readme);
    if (cmd) {
      ext.install = [cmd, `(from the repo's README: ${ext.url})`];
      return;
    }
    // 2) Real npm package name from package.json.
    const pkgRaw = await fetchText(`${base}/package.json`);
    if (pkgRaw) {
      try {
        const pkg = JSON.parse(pkgRaw) as { name?: string };
        if (pkg.name) {
          const short = pkg.name.split("/").pop()!;
          ext.install = [`claude mcp add ${short} -- npx -y ${pkg.name}`, `(verify in README: ${ext.url})`];
          return;
        }
      } catch {
        /* fall through */
      }
    }
    // 3) Python MCP server hint.
    if (await fetchText(`${base}/pyproject.toml`)) {
      ext.install = [
        `# Python MCP server — install with uv/pipx, then wire up:`,
        `claude mcp add ${repo} -- uvx ${repo}`,
        `(verify the package name in the README: ${ext.url})`,
      ];
      return;
    }
  }
  // else: keep the existing best-effort guess set in searchTopic().
}

export interface DiscoverOptions {
  /** Repos pulled per topic search. */
  perTopic?: number;
  /** Top subagent repos (by stars) to drill into for individual prompts. */
  drillRepos?: number;
  /** Max agent files extracted per drilled repo. */
  filesPerRepo?: number;
}

/** Discover extensions via GitHub topic search. Returns [] on any failure. */
export async function discoverExtensions(opts: DiscoverOptions = {}): Promise<Extension[]> {
  const perTopic = opts.perTopic ?? 8;
  const drillRepos = opts.drillRepos ?? 6;
  const filesPerRepo = opts.filesPerRepo ?? 10;
  const out: Extension[] = [];

  for (const { topic, kind } of TOPIC_KIND) {
    try {
      const repos = await searchTopicRepos(topic, perTopic);
      if (kind !== "subagent") {
        out.push(...repos.map((r) => repoToExtension(r, kind)));
        continue;
      }
      // Subagents: drill the top repos into individual prompts; repos we can't
      // expand fall back to a repo-level entry so we never lose a popular one.
      const ranked = [...repos].sort((a, b) => b.stargazers_count - a.stargazers_count);
      const toDrill = ranked.slice(0, drillRepos);
      const expanded = await Promise.all(
        toDrill.map((r) =>
          expandSubagentRepo(r, filesPerRepo).catch(() => [] as Extension[]),
        ),
      );
      toDrill.forEach((repo, i) => {
        const items = expanded[i];
        if (items.length) out.push(...items);
        else out.push(repoToExtension(repo, "subagent"));
      });
      // Repos beyond the drill budget still surface at repo level.
      out.push(...ranked.slice(drillRepos).map((r) => repoToExtension(r, "subagent")));
    } catch {
      // one topic failing shouldn't abort discovery
    }
  }

  // de-dupe by id within discovered set
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}
