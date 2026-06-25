#!/usr/bin/env node
// Kie MCP server (stdio). Exposes the trending radar to Claude Code and
// Cursor.
//
// Discovery:  whats_trending, tool_details, refresh_now
// Personal:   should_i_use, profile_get, profile_update, record_decision
// Action:     install_tool (returns commands; the agent runs them after consent)

import "../env.js"; // must be first: populate process.env before other modules load
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Store } from "../store/db.js";
import type { Tool } from "../types.js";
import { rankTrending } from "../scoring/ranker.js";
import { refresh, ensureFreshInBackground } from "../scheduler/refresh.js";
import { defaultSources } from "../ingest/collector.js";
import { firstRepoRef, splitRef } from "../ingest/extract.js";
import { enrichRepo } from "../enrich/github.js";
import {
  buildProfileView,
  ensureProfileFresh,
  recordDecision,
  scanAndRebuild,
  codeRoots,
} from "../profile/profile.js";
import { classifyFit } from "../match/fit.js";
import { recommendStarters } from "../recommend/curated.js";
import { buildDigest } from "../recommend/digest.js";
import { CURATED_EXTENSIONS } from "../extensions/catalog.js";
import { scanInstalledExtensions } from "../extensions/installed.js";
import { discoverExtensions, resolveInstall } from "../extensions/discover.js";
import { annotateDiscussion } from "../extensions/discussion.js";
import { recommendExtensions, mergeExtensions } from "../extensions/recommend.js";
import { buildInstallPlan, formatInstallPlan } from "../install/install.js";
import {
  formatDigest,
  formatExtensionRecs,
  formatFit,
  formatInstallSummary,
  formatProfile,
  formatRichContext,
  formatStarters,
  formatToolDetails,
  formatTrendingList,
} from "./format.js";

/** Count of sources whose credentials are present (breadth denominator). */
function enabledSourceCount(): number {
  return defaultSources().filter((s) => s.isEnabled()).length;
}

const MAX_CACHE_AGE_HOURS = Number(process.env.KIE_MAX_CACHE_AGE_HOURS ?? 6);

const WARMING_MESSAGE =
  "Kie is warming up — the first collection across your sources is running in the " +
  "background (this can take ~30s–2min). Try again shortly, or run refresh_now to " +
  "wait for it to finish.";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function normalizeRepo(input: string): string {
  return firstRepoRef(input) ?? input.trim().toLowerCase().replace(/^github\.com\//, "");
}

/** Get a tool from the store, or fetch+persist it from GitHub on demand. */
async function getOrFetchTool(store: Store, ref: string): Promise<Tool | undefined> {
  const existing = store.getToolByRef(ref);
  if (existing) return existing;
  const meta = await enrichRepo(ref).catch(() => null);
  if (!meta) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const { name } = splitRef(ref);
  const id = store.upsertTool(ref, meta.url, name, now);
  store.applyRepoMeta(id, meta);
  return store.getTool(id);
}

/** Build the Kie MCP server and register all tools against `store`. Pure of any
 * transport so tests can drive it over an in-memory transport with a :memory:
 * store. */
export function createKieServer(store: Store): McpServer {
  const server = new McpServer({ name: "kie", version: "0.1.0" });

  // ---- Discovery -----------------------------------------------------------

  server.registerTool(
    "whats_trending",
    {
      title: "What's trending",
      description:
        "List GitHub repos/tools currently trending across Hacker News, Reddit, Lobsters " +
        "and GitHub, each with a 0-100 popularity score and a fit tag against your profile.",
      inputSchema: {
        window: z.enum(["24h", "7d", "30d"]).optional().describe("Time window (default 7d)"),
        language: z.string().optional().describe("Filter by primary language, e.g. TypeScript"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 15)"),
      },
    },
    async ({ window, language, limit }) => {
      // Serve cached data immediately; revalidate in the background so the next
      // call sees fresher data. A blocking refresh here can hang 30s–2min on the
      // first call of a session.
      const { warming } = ensureFreshInBackground(store, MAX_CACHE_AGE_HOURS);
      const win = window ?? "7d";
      const entries = rankTrending(store, {
        window: win,
        language,
        limit: limit ?? 15,
        sourceCount: enabledSourceCount(),
      });
      if (entries.length === 0 && warming) return text(WARMING_MESSAGE);
      const profile = ensureProfileFresh(store);
      for (const e of entries) e.fit = classifyFit(e.tool, profile);
      return text(formatTrendingList(entries, win));
    },
  );

  server.registerTool(
    "tool_details",
    {
      title: "Tool details",
      description:
        "Full detail for one repo: description, language, stars, topics, score breakdown, " +
        "and where it has been mentioned. Accepts 'owner/name' or a GitHub URL.",
      inputSchema: { repo: z.string().describe("Repo as 'owner/name' or a github.com URL") },
    },
    async ({ repo }) => {
      const ref = normalizeRepo(repo);
      const tool = store.getToolByRef(ref);
      if (!tool) {
        return text(
          `'${ref}' isn't in the trend store yet. Run whats_trending or refresh_now first, ` +
            `or try should_i_use which can fetch it on demand.`,
        );
      }
      const scoreRow = store.db
        .prepare("SELECT breakdown FROM scores WHERE tool_id = ? ORDER BY computed_at DESC LIMIT 1")
        .get(tool.id) as { breakdown: string } | undefined;
      const breakdown = scoreRow ? JSON.parse(scoreRow.breakdown) : null;
      return text(formatToolDetails(tool, breakdown, store.mentionsForTool(tool.id)));
    },
  );

  server.registerTool(
    "refresh_now",
    {
      title: "Refresh now",
      description:
        "Force an immediate collection pass across all sources and re-enrich repo metadata.",
      inputSchema: {},
    },
    async () => {
      const result = await refresh(store);
      const lines = result.collect.reports.map(
        (r) =>
          `  • ${r.source}: ${r.enabled ? "" : "(disabled) "}fetched ${r.fetched}, ` +
          `new ${r.newMentions}${r.error ? ` — error: ${r.error}` : ""}`,
      );
      return text(
        `Refresh complete.\n${lines.join("\n")}\n` +
          `Enriched ${result.enriched} repo(s), skipped ${result.skipped}` +
          `, ${result.skippedFresh} still fresh.`,
      );
    },
  );

  server.registerTool(
    "whats_new",
    {
      title: "What's new for me",
      description:
        "The proactive digest: repos discovered since you last checked that actually fit " +
        "your stack (fill a gap), excluding anything you've already decided on. Ask this " +
        "whenever you want a 'here's what's new' update. By default it advances your " +
        "'last seen' marker so the next call only shows newer items; set peek=true to look " +
        "without advancing it.",
      inputSchema: {
        window: z.enum(["24h", "7d", "30d"]).optional(),
        limit: z.number().int().min(1).max(30).optional(),
        peek: z.boolean().optional().describe("Look without advancing your last-seen marker"),
      },
    },
    async ({ window, limit, peek }) => {
      // Serve the delta from cache now; revalidate in the background.
      const { warming } = ensureFreshInBackground(store, MAX_CACHE_AGE_HOURS);
      if (warming) return text(WARMING_MESSAGE);
      const sinceStr = store.getMeta("lastDigestAt");
      const since = sinceStr ? Number(sinceStr) : null;
      const digest = buildDigest(store, { window: window ?? "7d", limit: limit ?? 10, since });
      if (!peek) store.setMeta("lastDigestAt", String(Math.floor(Date.now() / 1000)));
      return text(formatDigest(digest));
    },
  );

  // ---- Personal (profile + fit) -------------------------------------------

  server.registerTool(
    "should_i_use",
    {
      title: "Should I use this?",
      description:
        "Judge a repo against your living profile: does it REPLACE something you already " +
        "use, COMPLEMENT your stack (with install instructions), or is it IRRELEVANT? " +
        "Fetches the repo from GitHub on demand if it isn't already tracked.",
      inputSchema: { repo: z.string().describe("Repo as 'owner/name' or a github.com URL") },
    },
    async ({ repo }) => {
      const ref = normalizeRepo(repo);
      const tool = await getOrFetchTool(store, ref);
      if (!tool) {
        return text(`Couldn't find '${ref}' on GitHub (renamed, private, or rate-limited?).`);
      }
      const decision = store.getDecision(tool.id);
      const profile = ensureProfileFresh(store);
      const fit = classifyFit(tool, profile);
      let out = formatFit(tool, fit);
      if (decision) out += `\n\nNote: you previously marked this "${decision.decision}".`;
      if (fit.verdict === "complements") {
        out += formatInstallSummary(buildInstallPlan(tool));
        out += `\n\nWant me to install it? Use install_tool or just say yes.`;
      }
      // Hand the agent the raw material (description, README, discussion
      // headlines) so it can reason beyond our keyword heuristic.
      out += formatRichContext(tool, store.mentionsForTool(tool.id));
      return text(out);
    },
  );

  server.registerTool(
    "profile_get",
    {
      title: "Get profile",
      description: "Show your living stack profile: languages and the tool categories you cover.",
      inputSchema: {},
    },
    async () => text(formatProfile(ensureProfileFresh(store))),
  );

  server.registerTool(
    "profile_update",
    {
      title: "Update profile",
      description:
        "Update the living profile: rescan your code, or manually add/remove entries. " +
        "Rescanning re-reads dependency manifests under your code roots.",
      inputSchema: {
        rescan: z.boolean().optional().describe("Scan code roots and rebuild from manifests"),
        roots: z.array(z.string()).optional().describe("Override code roots for this scan"),
        addLanguages: z.array(z.string()).optional(),
        addLibraries: z.array(z.string()).optional().describe("Library names (auto-categorized)"),
        removeKeys: z.array(z.string()).optional().describe("Profile row keys to remove"),
      },
    },
    async ({ rescan, roots, addLanguages, addLibraries, removeKeys }) => {
      const now = Math.floor(Date.now() / 1000);
      if (removeKeys?.length) {
        const ph = removeKeys.map(() => "?").join(",");
        store.db.prepare(`DELETE FROM profile WHERE key IN (${ph})`).run(...removeKeys);
      }
      for (const lang of addLanguages ?? []) {
        store.upsertProfileRow({
          key: `language:${lang.toLowerCase()}`,
          kind: "language",
          label: lang,
          category: null,
          weight: 1,
          now,
        });
      }
      if (addLibraries?.length) {
        const { categorizeDependency } = await import("../match/taxonomy.js");
        for (const lib of addLibraries) {
          store.upsertProfileRow({
            key: `library:${lib.toLowerCase()}`,
            kind: "library",
            label: lib,
            category: categorizeDependency(lib) ?? null,
            weight: 1,
            now,
          });
        }
      }
      if (rescan) {
        const view = scanAndRebuild(store, roots && roots.length ? roots : codeRoots());
        return text(
          `Rescanned ${(roots && roots.length ? roots : codeRoots()).join(", ")}.\n\n` +
            formatProfile(view),
        );
      }
      return text(formatProfile(buildProfileView(store)));
    },
  );

  server.registerTool(
    "setup",
    {
      title: "First-run setup",
      description:
        "Onboarding: scan your code to build your living profile, then recommend a set of " +
        "broadly-useful starter tools (search, fuzzy finder, git TUI, knowledge base, ...), " +
        "skipping anything your stack already covers. Run this once when getting started.",
      inputSchema: {
        roots: z.array(z.string()).optional().describe("Code roots to scan (defaults to your config)"),
      },
    },
    async ({ roots }) => {
      const scanRootsList = roots && roots.length ? roots : codeRoots();
      const view = scanAndRebuild(store, scanRootsList);
      const recs = recommendStarters(store, view);
      return text(
        `Scanned ${scanRootsList.join(", ")}.\n\n` +
          formatProfile(view) +
          `\n\n` +
          formatStarters(recs),
      );
    },
  );

  server.registerTool(
    "recommend_extensions",
    {
      title: "Recommend Claude Code extensions",
      description:
        "Recommend things to add to your setup — Claude Code skills, plugins, MCP servers, " +
        "and subagents, plus valuable SaaS tools (with how to get them) — matched to your " +
        "stack profile, skipping ones you already have. Distinct from whats_trending (which " +
        "covers external dev-tool repos). Combines a curated catalog with live GitHub search.",
      inputSchema: {
        discover: z
          .boolean()
          .optional()
          .describe("Also search GitHub for extensions (default true)"),
      },
    },
    async ({ discover }) => {
      // Warm the mention store in the background so the discussion-ranking signal
      // (which reads collected HN/Reddit mentions) populates over repeated use,
      // even on a session that never called whats_trending. Non-blocking.
      ensureFreshInBackground(store, MAX_CACHE_AGE_HOURS);
      const profile = ensureProfileFresh(store);
      const scan = scanInstalledExtensions(codeRoots());
      let exts = CURATED_EXTENSIONS;
      if (discover !== false) {
        const found = await discoverExtensions().catch(() => []);
        exts = mergeExtensions(CURATED_EXTENSIONS, found);
      }
      // Fold in the HN/Reddit/… discussion signal we've already collected, so a
      // repo that's being talked about ranks above an equally-starred quiet one.
      annotateDiscussion(exts, store);
      const recs = recommendExtensions(exts, profile, scan.identifiers);
      // Resolve real install commands for the discovered items we'll actually
      // show (bounded — the recommender already capped them).
      await Promise.all(
        recs.filter((r) => r.ext.discovered && r.status !== "installed").map((r) => resolveInstall(r.ext)),
      );
      return text(formatExtensionRecs(recs, scan.note));
    },
  );

  server.registerTool(
    "record_decision",
    {
      title: "Record decision",
      description:
        "Record that you accepted, rejected, or installed a tool. Installing/accepting adds " +
        "it to your profile so similar tools later read as 'you already do this'.",
      inputSchema: {
        repo: z.string().describe("Repo as 'owner/name' or a github.com URL"),
        decision: z.enum(["accepted", "rejected", "installed"]),
        note: z.string().optional(),
      },
    },
    async ({ repo, decision, note }) => {
      const ref = normalizeRepo(repo);
      const tool = await getOrFetchTool(store, ref);
      if (!tool) return text(`Couldn't resolve '${ref}' to record a decision.`);
      const view = recordDecision(store, tool, decision, note ?? null);
      return text(`Recorded "${decision}" for ${tool.repoRef}.\n\n` + formatProfile(view));
    },
  );

  // ---- Action --------------------------------------------------------------

  server.registerTool(
    "install_tool",
    {
      title: "Install tool",
      description:
        "Return the exact install command(s) for a repo, tailored to its ecosystem (npm/pip/" +
        "cargo/go) or MCP-server wiring for Claude Code & Cursor. Does NOT install — the agent " +
        "runs the commands only after you confirm.",
      inputSchema: { repo: z.string().describe("Repo as 'owner/name' or a github.com URL") },
    },
    async ({ repo }) => {
      const ref = normalizeRepo(repo);
      const tool = await getOrFetchTool(store, ref);
      if (!tool) return text(`Couldn't resolve '${ref}' to build an install plan.`);
      return text(formatInstallPlan(tool, buildInstallPlan(tool)));
    },
  );

  return server;
}

async function main() {
  const store = new Store();
  const server = createKieServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("kie MCP server running on stdio");
}

// Only boot the stdio server when run directly (node dist/mcp/server.js), not
// when this module is imported (e.g. by a test driving an in-memory transport).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
