// Catalog of Claude Code "extensions" — skills, plugins, MCP servers, subagents,
// and valuable SaaS — that Kie can recommend you ADD to your setup (distinct from
// external dev-tool repos).
//
// This is a curated seed of entries we're confident exist; GitHub search
// augments it at runtime (see discover.ts). Each entry declares what makes it
// relevant (profile categories, or universal) and how to detect if you already
// have it (match aliases), so the recommender can skip what's installed.

export type ExtensionKind = "skill" | "plugin" | "mcp-server" | "subagent" | "saas";

/** How much a repo is being discussed, folded in from collected source mentions. */
export interface DiscussionSignal {
  /** Number of mentions across sources. */
  mentionCount: number;
  /** Total engagement points (HN points, reddit upvotes, …) across mentions. */
  points: number;
  /** Distinct source names, e.g. ["hackernews", "reddit"]. */
  sources: string[];
}

export interface Extension {
  /** Stable id, e.g. "mcp:github". */
  id: string;
  kind: ExtensionKind;
  name: string;
  description: string;
  url: string;
  /** Profile categories that make this relevant. Empty + universal => always. */
  relevantCategories: string[];
  /** Broadly useful regardless of stack (docs, filesystem, git, …). */
  universal?: boolean;
  /** Lowercased aliases used to detect an existing install in the local setup. */
  match: string[];
  /** Install command(s)/guidance lines. */
  install: string[];
  why: string;
  /** True when found via live GitHub search (lower confidence than curated). */
  discovered?: boolean;
  /** True for skills/plugins that ship WITH Claude Code (e.g. the Anthropic
   * document skills). They often aren't on disk at the scanned paths, so they
   * can't be filesystem-detected — we treat them as built-in rather than
   * pitching them as something to "add". */
  bundled?: boolean;
  /** Star count, when known (used to rank/cap discovered items). */
  stars?: number;
  /**
   * Ready-to-use content for this extension, when we can fetch it — e.g. the
   * actual subagent prompt (a `.claude/agents/*.md` body) pulled from a popular
   * community repo. UNTRUSTED third-party text; always fence it before showing.
   */
  content?: string;
  /** Source repo "owner/name" when an item was extracted from inside a repo. */
  sourceRepo?: string;
  /** Lowercased "owner/name" of the originating repo, for cross-referencing the
   * mention store. Set on discovered items; absent on curated ones. */
  repoRef?: string;
  /** Discussion signal folded in from collected HN/Reddit/etc. mentions of the
   * repo. Populated by `annotateDiscussion`; undefined when the repo isn't (yet)
   * in the mention store. Drives ranking and the "discussed on …" annotation. */
  discussion?: DiscussionSignal;
}

export const CURATED_EXTENSIONS: Extension[] = [
  // ---- Anthropic document skills (broadly useful) --------------------------
  {
    id: "skill:docx",
    kind: "skill",
    name: "docx",
    description: "Create, read, and edit Word (.docx) documents.",
    url: "https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview",
    relevantCategories: [],
    universal: true,
    bundled: true,
    match: ["docx", "anthropic-skills:docx"],
    install: ["Ships with Claude Code's Anthropic skills — enable it via /plugin (anthropic skills marketplace)."],
    why: "Lets the agent produce/edit real Word docs (reports, letters) instead of plain text.",
  },
  {
    id: "skill:pdf",
    kind: "skill",
    name: "pdf",
    description: "Read, extract, merge, split, fill, and create PDF files.",
    url: "https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview",
    relevantCategories: [],
    universal: true,
    bundled: true,
    match: ["pdf", "anthropic-skills:pdf"],
    install: ["Ships with Claude Code's Anthropic skills — enable it via /plugin."],
    why: "Handle PDFs end-to-end (extract tables, fill forms, OCR) from the agent.",
  },
  {
    id: "skill:xlsx",
    kind: "skill",
    name: "xlsx",
    description: "Read, edit, and create spreadsheets (.xlsx/.csv) with formulas and charts.",
    url: "https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview",
    relevantCategories: ["data"],
    universal: true,
    bundled: true,
    match: ["xlsx", "anthropic-skills:xlsx"],
    install: ["Ships with Claude Code's Anthropic skills — enable it via /plugin."],
    why: "Clean, compute, and chart tabular data in real spreadsheets.",
  },
  {
    id: "skill:skill-creator",
    kind: "skill",
    name: "skill-creator",
    description: "Create, edit, and evaluate your own Claude Code skills.",
    url: "https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview",
    relevantCategories: ["mcp", "ai-tool"],
    bundled: true,
    match: ["skill-creator", "anthropic-skills:skill-creator"],
    install: ["Ships with Claude Code's Anthropic skills — enable it via /plugin."],
    why: "You build agent tooling (MCP) — this helps you package reusable skills.",
  },
  // ---- Official MCP servers (@modelcontextprotocol/server-*) ----------------
  {
    id: "mcp:filesystem",
    kind: "mcp-server",
    name: "filesystem",
    description: "Scoped local file read/write for the agent.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    relevantCategories: [],
    universal: true,
    match: ["filesystem", "server-filesystem", "@modelcontextprotocol/server-filesystem"],
    install: [
      "claude mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem <allowed-dir>",
    ],
    why: "Give the agent controlled file access outside the repo (notes, assets).",
  },
  {
    id: "mcp:github",
    kind: "mcp-server",
    name: "github",
    description: "Drive GitHub (issues, PRs, code search) over MCP.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    relevantCategories: [],
    universal: true,
    match: ["github", "server-github", "@modelcontextprotocol/server-github"],
    install: ["claude mcp add github -e GITHUB_TOKEN=… -- npx -y @modelcontextprotocol/server-github"],
    why: "Let the agent open PRs, triage issues, and search code without leaving chat.",
  },
  {
    id: "mcp:postgres",
    kind: "mcp-server",
    name: "postgres",
    description: "Query and inspect a Postgres database over MCP.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    relevantCategories: ["database", "orm"],
    match: ["postgres", "postgresql", "server-postgres", "@modelcontextprotocol/server-postgres"],
    install: ["claude mcp add postgres -- npx -y @modelcontextprotocol/server-postgres <conn-url>"],
    why: "You use an ORM/database — this lets the agent inspect schema and run read queries.",
  },
  {
    id: "mcp:puppeteer",
    kind: "mcp-server",
    name: "puppeteer",
    description: "Drive a headless browser (navigate, click, screenshot) over MCP.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
    relevantCategories: ["ui-framework", "web-framework", "css", "e2e-testing"],
    match: ["puppeteer", "playwright", "server-puppeteer", "@modelcontextprotocol/server-puppeteer"],
    install: ["claude mcp add puppeteer -- npx -y @modelcontextprotocol/server-puppeteer"],
    why: "You build web UIs — let the agent open the app and verify changes in a real browser.",
  },
  {
    id: "mcp:memory",
    kind: "mcp-server",
    name: "memory",
    description: "Persistent knowledge-graph memory across sessions over MCP.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    relevantCategories: [],
    universal: true,
    match: ["memory", "server-memory", "@modelcontextprotocol/server-memory"],
    install: ["claude mcp add memory -- npx -y @modelcontextprotocol/server-memory"],
    why: "Give the agent durable memory of facts/decisions across sessions.",
  },
  // ---- Subagents (curated; community ones come from GitHub discovery) -------
  // Subagents are focused .md prompt files in .claude/agents/. These are the
  // roles worth standing up; relevantCategories gate the stack-specific ones so
  // they only surface when your profile actually covers that area.
  {
    id: "subagent:code-reviewer",
    kind: "subagent",
    name: "code-reviewer",
    description: "Reviews diffs for bugs, edge cases, and quality issues.",
    url: "https://docs.claude.com/en/docs/claude-code/sub-agents",
    relevantCategories: [],
    universal: true,
    match: ["code-reviewer", "reviewer", "code-review"],
    install: [
      "Create .claude/agents/code-reviewer.md with a focused review prompt (see the sub-agents docs).",
    ],
    why: "A dedicated reviewer subagent catches issues your main agent skims past.",
  },
  {
    id: "subagent:debugger",
    kind: "subagent",
    name: "debugger",
    description: "Reproduces, isolates, and root-causes failures with runtime evidence.",
    url: "https://docs.claude.com/en/docs/claude-code/sub-agents",
    relevantCategories: [],
    universal: true,
    match: ["debugger", "bug-fixer", "bugfixer"],
    install: [
      "Create .claude/agents/debugger.md with a prompt that reproduces a failure, forms a hypothesis, and fixes it.",
    ],
    why: "A dedicated debugger keeps your main agent from guessing — it reproduces first, then fixes.",
  },
  {
    id: "subagent:test-writer",
    kind: "subagent",
    name: "test-writer",
    description: "Writes and maintains unit/integration tests, aiming for meaningful coverage.",
    url: "https://docs.claude.com/en/docs/claude-code/sub-agents",
    relevantCategories: ["testing", "e2e-testing"],
    match: ["test-writer", "test-author", "tester", "test-engineer"],
    install: [
      "Create .claude/agents/test-writer.md with a prompt that writes tests for changed code in your test framework.",
    ],
    why: "You have a test setup — a test-writer subagent keeps coverage up as features land.",
  },
  {
    id: "subagent:security-reviewer",
    kind: "subagent",
    name: "security-reviewer",
    description: "Audits changes for injection, authz gaps, secret leaks, and unsafe deps.",
    url: "https://docs.claude.com/en/docs/claude-code/sub-agents",
    relevantCategories: ["web-framework", "api", "database"],
    match: ["security-reviewer", "security-auditor", "sec-review", "security"],
    install: [
      "Create .claude/agents/security-reviewer.md with a prompt that checks diffs for OWASP-style issues and secrets.",
    ],
    why: "You ship server/API/DB code — a security subagent flags vulnerabilities before they merge.",
  },
  {
    id: "subagent:docs-writer",
    kind: "subagent",
    name: "docs-writer",
    description: "Writes and updates READMEs, API docs, and docstrings from the code.",
    url: "https://docs.claude.com/en/docs/claude-code/sub-agents",
    relevantCategories: ["documentation"],
    universal: true,
    match: ["docs-writer", "documenter", "doc-writer", "technical-writer"],
    install: [
      "Create .claude/agents/docs-writer.md with a prompt that keeps docs in sync with code changes.",
    ],
    why: "Offload docs to a subagent so your main agent stays focused on building.",
  },
  {
    id: "subagent:api-designer",
    kind: "subagent",
    name: "api-designer",
    description: "Designs consistent REST/RPC endpoints, schemas, and error contracts.",
    url: "https://docs.claude.com/en/docs/claude-code/sub-agents",
    relevantCategories: ["api", "web-framework"],
    match: ["api-designer", "api-architect"],
    install: [
      "Create .claude/agents/api-designer.md with a prompt that reviews/designs API surface and contracts.",
    ],
    why: "You build APIs — a design-focused subagent keeps endpoints consistent and well-typed.",
  },
  {
    id: "subagent:db-migrator",
    kind: "subagent",
    name: "db-migrator",
    description: "Plans and writes safe, reversible database schema migrations.",
    url: "https://docs.claude.com/en/docs/claude-code/sub-agents",
    relevantCategories: ["orm", "database"],
    match: ["db-migrator", "migration-writer", "database-expert", "dba"],
    install: [
      "Create .claude/agents/db-migrator.md with a prompt that authors migrations and checks for data-loss/locking risks.",
    ],
    why: "You use a database/ORM — a migration subagent avoids the classic destructive-migration footgun.",
  },
  {
    id: "subagent:perf-optimizer",
    kind: "subagent",
    name: "perf-optimizer",
    description: "Profiles hot paths and proposes targeted performance fixes.",
    url: "https://docs.claude.com/en/docs/claude-code/sub-agents",
    relevantCategories: ["web-framework", "ui-framework", "database", "ml"],
    match: ["perf-optimizer", "performance", "performance-optimizer"],
    install: [
      "Create .claude/agents/perf-optimizer.md with a prompt that measures before/after and avoids speculative rewrites.",
    ],
    why: "A perf subagent grounds optimizations in measurements instead of guesses.",
  },
  {
    id: "subagent:ml-experimenter",
    kind: "subagent",
    name: "ml-experimenter",
    description: "Runs and evaluates ML experiments, reads metrics, and suggests next runs.",
    url: "https://docs.claude.com/en/docs/claude-code/sub-agents",
    relevantCategories: ["ml", "data"],
    match: ["ml-experimenter", "ml-engineer", "data-scientist"],
    install: [
      "Create .claude/agents/ml-experimenter.md with a prompt that designs runs, reads metrics, and proposes the next experiment.",
    ],
    why: "You work with ML/data — an experimenter subagent keeps a tight measure-iterate loop.",
  },
  {
    id: "subagent:refactorer",
    kind: "subagent",
    name: "refactorer",
    description: "Performs behavior-preserving refactors with tests as the safety net.",
    url: "https://docs.claude.com/en/docs/claude-code/sub-agents",
    relevantCategories: [],
    match: ["refactorer", "refactor", "refactoring"],
    install: [
      "Create .claude/agents/refactorer.md with a prompt that refactors in small, test-backed steps.",
    ],
    why: "A refactoring specialist keeps cleanups disciplined and behavior-preserving.",
  },
  // ---- Closed SaaS (recommend + how to get it; not installable) -------------
  {
    id: "saas:vercel",
    kind: "saas",
    name: "Vercel",
    description: "Deploy and host frontend apps (Next.js, etc.) with previews.",
    url: "https://vercel.com",
    relevantCategories: ["web-framework", "ui-framework"],
    match: [],
    install: ["https://vercel.com — free Hobby tier; `npm i -g vercel` then `vercel`."],
    why: "You build web apps — Vercel gives push-to-deploy hosting with preview URLs.",
  },
  {
    id: "saas:figma",
    kind: "saas",
    name: "Figma",
    description: "Collaborative interface design and prototyping.",
    url: "https://figma.com",
    relevantCategories: ["design", "ui-framework", "css"],
    match: [],
    install: ["https://figma.com — free tier. Pairs with the Figma MCP for design-to-code."],
    why: "You work on UI/CSS — Figma is the standard for designing and handing off interfaces.",
  },
  {
    id: "saas:v0",
    kind: "saas",
    name: "v0",
    description: "AI that generates React/Tailwind UI from prompts.",
    url: "https://v0.dev",
    relevantCategories: ["ui-framework", "css"],
    match: [],
    install: ["https://v0.dev — free tier; generates shadcn/Tailwind React components."],
    why: "You use React + Tailwind — v0 scaffolds components from a prompt to start from.",
  },
  {
    id: "saas:higgsfield",
    kind: "saas",
    name: "Higgsfield",
    description: "AI image/video generation for creative and marketing assets.",
    url: "https://higgsfield.ai",
    relevantCategories: ["creative", "design", "css"],
    match: [],
    install: ["https://higgsfield.ai — paid; sign up for AI video/image generation."],
    why: "For site/landing visuals — generate motion and imagery without a video team.",
  },
  {
    id: "saas:sentry",
    kind: "saas",
    name: "Sentry",
    description: "Error tracking and performance monitoring for apps.",
    url: "https://sentry.io",
    relevantCategories: ["web-framework", "monitoring"],
    match: [],
    install: ["https://sentry.io — free Developer tier; add the SDK for your framework."],
    why: "You ship web apps — Sentry surfaces production errors with stack traces.",
  },
  {
    id: "saas:linear",
    kind: "saas",
    name: "Linear",
    description: "Fast issue tracking and project management for software teams.",
    url: "https://linear.app",
    relevantCategories: [],
    universal: true,
    match: [],
    install: ["https://linear.app — free tier; has an MCP server for agent access too."],
    why: "Lightweight, keyboard-driven issue tracking that fits a dev workflow.",
  },
];
