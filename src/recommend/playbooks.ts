// Goal-driven recommendations. Where `recommend_extensions` matches the catalog
// against WHAT YOU USE (your stack profile), playbooks match against WHAT YOU'RE
// TRYING TO DO: the user states a goal in plain language ("I want to reduce my
// token usage") and Kie answers with a set of OPTIONS, each with pros, cons, and
// how to implement it.
//
// Keyless and host-model-friendly, like the rest of Kie:
//  - the curated PLAYBOOKS are deterministic, hand-vetted editorial content;
//  - goal -> playbook is a PURE keyword match (no LLM API of Kie's own);
//  - on a weak/no match we hand the menu of known goals + the user's profile back
//    to the host model to reason over — the same "host model is the reasoning
//    layer" pattern as `profile_infer` / `should_i_use`.
//
// Repo-backed options carry a `repoRef`; at tool time they get live stars, a
// discussion signal (from the mentions Kie already collects), and a "maintained"
// flag folded in. An optional discovery lane (see discoverPlaybookOptions) surfaces
// fresh community tools by GitHub search, flagged `⚠ community — verify` exactly
// like discovered extensions.

import type { DiscussionSignal } from "../extensions/catalog.js";
import type { Store } from "../store/db.js";
import { enrichRepo } from "../enrich/github.js";
import { summarizeDiscussion } from "../extensions/discussion.js";

/** One way to achieve a goal: a technique, built-in feature, or a tool. */
export interface PlaybookOption {
  name: string;
  /** One-line "what it is". */
  what: string;
  pros: string[];
  cons: string[];
  /** Implementation steps / commands the agent can act on. */
  how: string[];
  /** Ships with Claude Code — nothing to install, just turn it on/use it. */
  builtin?: boolean;
  /** "owner/name" for a repo-backed option — enriched + discussion-ranked. */
  repoRef?: string;
  /** Canonical link (repo, docs, npm). */
  url?: string;
  /** Found via live GitHub search rather than curated — lower confidence. */
  discovered?: boolean;
  // ---- Populated at runtime when a repoRef resolves (see resolveRepoOption): --
  /** GitHub stars, when known. */
  stars?: number;
  /** Discussion heat from collected HN/Reddit/… mentions of the repo. */
  discussion?: DiscussionSignal;
  /** False when the repo looks unmaintained (stale push / archived); undefined when unknown. */
  maintained?: boolean;
}

export interface Playbook {
  id: string;
  /** Canonical goal slug, e.g. "reduce-token-usage". */
  goal: string;
  /** Human title. */
  title: string;
  /** Lowercase keyword triggers matched against the user's free-text goal. */
  match: string[];
  /** One/two-line framing of the goal. */
  summary: string;
  /** Curated options, ordered cheapest-effort-first. */
  options: PlaybookOption[];
  /** Optional GitHub search query for the discovery lane (community tools). */
  discoverQuery?: string;
}

// ---------------------------------------------------------------------------
// Curated catalog. The first entry — reducing token usage — is the one this
// feature was built around; the model below generalizes to other dev goals
// (faster CI, observability, …) as future entries.
// ---------------------------------------------------------------------------

export const PLAYBOOKS: Playbook[] = [
  {
    id: "playbook:reduce-token-usage",
    goal: "reduce-token-usage",
    title: "Reduce token usage",
    match: [
      "token", "tokens", "context", "context window", "cheaper", "cost",
      "usage", "burn", "spend", "compact", "shrink", "trim",
    ],
    summary:
      "Ways to spend fewer tokens per Claude Code session — ordered cheapest-effort " +
      "first. Measure before you optimize: see where the tokens actually go, then pull " +
      "the biggest lever you can afford.",
    discoverQuery: "claude code context token usage",
    options: [
      {
        name: "Subagents (context isolation)",
        what: "Push exploratory work into a separate agent whose context never enters your main thread — you get back only its summary.",
        pros: [
          "Biggest single lever — a subagent's file reads / dead-ends never cost your main window",
          "Already built into Claude Code; pairs naturally with the subagents Kie's recommend_extensions surfaces",
        ],
        cons: [
          "Setup + orchestration overhead",
          "A summarized hand-back can lose detail the main agent later needs",
        ],
        how: [
          "Create focused .claude/agents/*.md roles (or adopt one from recommend_extensions).",
          "Delegate 'go find/figure out X' work to them so only the conclusion returns to the main context.",
        ],
        builtin: true,
        url: "https://docs.claude.com/en/docs/claude-code/sub-agents",
      },
      {
        name: "/compact + auto-compact",
        what: "Summarize the conversation so far into a compact form, freeing the window.",
        pros: ["Zero setup — built in", "Reclaims a long session without starting over"],
        cons: ["Lossy — a mid-task compaction can drop something you still needed", "Summary quality varies"],
        how: [
          "Run /compact at natural breakpoints (after a task, before a new one).",
          "Let auto-compact handle the rest; keep an eye on what it drops.",
        ],
        builtin: true,
        url: "https://docs.claude.com/en/docs/claude-code/costs",
      },
      {
        name: "Skills (progressive disclosure)",
        what: "Move standing instructions into skills that load only when their trigger fires, instead of riding in context every turn.",
        pros: ["Per-turn system context shrinks", "Instructions still available on demand"],
        cons: ["You have to author/structure the skills", "Trigger has to actually fire when relevant"],
        how: [
          "Pull rarely-needed guidance out of CLAUDE.md into a skill (use the skill-creator skill).",
          "Keep CLAUDE.md to what's needed every session.",
        ],
        builtin: true,
        url: "https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview",
      },
      {
        name: "Trim CLAUDE.md / output styles",
        what: "Every turn pays for your system prompt and project context — cut what isn't earning its place.",
        pros: ["Pure win — affects every single turn", "No new tooling"],
        cons: ["Manual; easy to let CLAUDE.md grow back", "Over-trimming loses useful guardrails"],
        how: [
          "Audit CLAUDE.md: delete stale rules, fold duplicates, move niche guidance into skills.",
          "Prefer terse output styles where you don't need long prose back.",
        ],
        builtin: true,
        url: "https://docs.claude.com/en/docs/claude-code/memory",
      },
      {
        name: "Memory MCP (externalize long-lived facts)",
        what: "Keep durable facts/decisions in a memory server and retrieve them on demand instead of carrying them in-context.",
        pros: ["Long-lived knowledge stops re-entering the window every session", "Survives across sessions"],
        cons: ["Another server to run", "Retrieval round-trips aren't free"],
        how: ["claude mcp add memory -- npx -y @modelcontextprotocol/server-memory"],
        repoRef: "modelcontextprotocol/servers",
        url: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
      },
      {
        name: "ccusage (measure first)",
        what: "A CLI that reads your Claude Code usage logs and shows where tokens actually go.",
        pros: ["Diagnose before you optimize — find the real hot spots", "No code changes to try it"],
        cons: ["Read-only — it tells you where, it doesn't fix anything"],
        how: ["npx ccusage@latest", "(verify the package/repo before relying on it — discovered tooling)"],
        repoRef: "ryoppippi/ccusage",
        url: "https://github.com/ryoppippi/ccusage",
      },
      {
        name: "Prompt compression (LLMLingua) — API pipelines only",
        what: "Compresses prompts before they hit a model. For your OWN app's LLM calls, not the Claude Code IDE loop.",
        pros: ["Real, measurable compression for programmatic pipelines"],
        cons: [
          "Not a Claude Code feature — won't shrink your IDE session",
          "Adds a preprocessing dependency to your app",
        ],
        how: ["pip install llmlingua", "Wire it in front of your own model calls (see the repo)."],
        repoRef: "microsoft/LLMLingua",
        url: "https://github.com/microsoft/LLMLingua",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Pure matching + health (fully offline-testable; the network lanes live in the
// server tool and call these).
// ---------------------------------------------------------------------------

const WORD = /[a-z0-9+#.]+/g;

/**
 * Match a free-text goal to the best playbook by counting trigger hits. Pure +
 * testable. Multi-word triggers (e.g. "context window") are matched as a phrase;
 * single-word triggers must hit a whole word so "token" doesn't fire on
 * "tokenizer"-style noise. Returns undefined when nothing matches (the caller
 * then hands the menu to the host model).
 */
export function matchPlaybook(goal: string, playbooks: Playbook[] = PLAYBOOKS): Playbook | undefined {
  const lower = goal.toLowerCase();
  const words = new Set(lower.match(WORD) ?? []);
  let best: Playbook | undefined;
  let bestScore = 0;
  for (const pb of playbooks) {
    let score = 0;
    for (const trigger of pb.match) {
      const hit = trigger.includes(" ") ? lower.includes(trigger) : words.has(trigger);
      if (hit) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = pb;
    }
  }
  return bestScore > 0 ? best : undefined;
}

/** Roughly a year of seconds — the staleness cutoff for "maintained". */
export const MAINTAINED_MAX_AGE_SEC = 365 * 24 * 60 * 60;

/**
 * Is a repo still maintained, given its last push? Pure + testable. Returns
 * undefined when we don't know (no pushedAt), so the formatter can stay silent
 * rather than implying a repo is abandoned on missing data.
 */
export function isMaintained(pushedAt: number | null | undefined, nowSec: number): boolean | undefined {
  if (pushedAt == null) return undefined;
  return nowSec - pushedAt <= MAINTAINED_MAX_AGE_SEC;
}

// ---------------------------------------------------------------------------
// Network lanes (best-effort; any failure degrades to the curated content). These
// mirror discover.ts: live calls live alongside the pure helpers above, and every
// failure path returns gracefully so the playbook always renders something.
// ---------------------------------------------------------------------------

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "kie-mcp/0.1",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

interface RepoHit {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  pushed_at?: string;
}

export interface DiscoverPlaybookOptions {
  /** Max community options to surface. Default 4. */
  limit?: number;
}

/**
 * Discovery lane: search GitHub for fresh community tools matching the playbook's
 * query and turn the top repos into options, skipping any repo a curated option
 * already covers. Flagged `discovered` so the formatter marks them `⚠ verify`.
 * Best-effort: returns [] on any failure (no network, rate limit, bad query).
 */
export async function discoverPlaybookOptions(
  query: string,
  excludeRefs: Set<string>,
  opts: DiscoverPlaybookOptions = {},
): Promise<PlaybookOption[]> {
  const limit = opts.limit ?? 4;
  try {
    const url =
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}` +
      `&sort=stars&order=desc&per_page=${limit + excludeRefs.size + 4}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: RepoHit[] };
    const now = Math.floor(Date.now() / 1000);
    const out: PlaybookOption[] = [];
    for (const r of data.items ?? []) {
      const ref = r.full_name.toLowerCase();
      if (excludeRefs.has(ref)) continue;
      const pushed = r.pushed_at ? Math.floor(new Date(r.pushed_at).getTime() / 1000) : null;
      out.push({
        name: r.full_name.split("/")[1],
        what: r.description ?? "(no description)",
        pros: [`Community tool — ★${r.stargazers_count.toLocaleString()}`],
        cons: ["Not vetted by Kie — verify it does what its description claims before adopting"],
        how: [`See ${r.html_url} for setup.`],
        repoRef: ref,
        url: r.html_url,
        discovered: true,
        stars: r.stargazers_count,
        maintained: isMaintained(pushed, now),
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Fold live signal into a repo-backed option in place: stars + maintained from
 * GitHub (only when not already known — discovered options arrive pre-filled),
 * and the discussion signal from the mentions Kie has already collected.
 * Best-effort; leaves the curated content intact on any failure.
 */
export async function resolveRepoOption(opt: PlaybookOption, store: Store): Promise<void> {
  if (!opt.repoRef) return;
  if (opt.stars === undefined) {
    const meta = await enrichRepo(opt.repoRef).catch(() => null);
    if (meta) {
      opt.stars = meta.stars;
      opt.maintained = isMaintained(meta.pushedAt, Math.floor(Date.now() / 1000));
    }
  }
  const tool = store.getToolByRef(opt.repoRef);
  const mentions = tool ? store.mentionsForTool(tool.id) : [];
  if (mentions.length) opt.discussion = summarizeDiscussion(mentions);
}
