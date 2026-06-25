// Discover what Claude Code extensions the user already has, so the recommender
// doesn't pitch things they've installed. Everything here is best-effort and
// defensive: the on-disk layout varies and evolves, so we probe several likely
// locations, parse JSON safely, and never throw.
//
// Returns a set of lowercased identifiers (skill names, MCP server names/packages,
// plugin names) that the catalog matches against via its `match` aliases.

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

function safeReadJson(path: string): unknown | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** All entry names (files and dirs) directly under path. */
function listEntries(path: string): string[] {
  try {
    return existsSync(path) ? readdirSync(path) : [];
  } catch {
    return [];
  }
}

function dirNames(path: string): string[] {
  try {
    if (!existsSync(path)) return [];
    return readdirSync(path).filter((e) => {
      try {
        return statSync(join(path, e)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** Find every directory literally named "skills" under root, up to maxDepth. */
function findSkillsDirs(root: string, maxDepth: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    for (const entry of dirNames(dir)) {
      const full = join(dir, entry);
      if (entry === "skills") out.push(full);
      else walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** Pull mcpServers keys (and their package names from args) out of a config blob. */
function mcpServerIds(blob: unknown, out: Set<string>) {
  if (!blob || typeof blob !== "object") return;
  const obj = blob as Record<string, unknown>;
  const servers = obj.mcpServers;
  const collect = (servers: unknown) => {
    if (!servers || typeof servers !== "object") return;
    for (const [name, cfg] of Object.entries(servers as Record<string, unknown>)) {
      out.add(name.toLowerCase());
      const args = (cfg as { args?: unknown }).args;
      if (Array.isArray(args)) {
        for (const a of args) if (typeof a === "string") out.add(a.toLowerCase());
      }
    }
  };
  collect(servers);
  // ~/.claude.json also nests servers per-project under "projects".
  const projects = obj.projects;
  if (projects && typeof projects === "object") {
    for (const proj of Object.values(projects as Record<string, unknown>)) {
      collect((proj as { mcpServers?: unknown }).mcpServers);
    }
  }
}

export interface InstalledScan {
  identifiers: Set<string>;
  /** Human-readable note about what was (or wasn't) found, for transparency. */
  note: string;
}

/** Scan the local Claude Code setup. `projectRoots` are extra repo roots to check. */
export function scanInstalledExtensions(projectRoots: string[] = []): InstalledScan {
  const ids = new Set<string>();
  const home = homedir();
  const found: string[] = [];

  // Skills: ~/.claude/skills/* and <root>/.claude/skills/*
  const skillDirs = [join(home, ".claude", "skills"), ...projectRoots.map((r) => join(r, ".claude", "skills"))];
  for (const d of skillDirs) {
    for (const name of dirNames(d)) ids.add(name.toLowerCase());
  }
  const skillCount = [...ids].length;
  if (skillCount) found.push(`${skillCount} skill(s)`);

  // Subagents: ~/.claude/agents/* and <root>/.claude/agents/* — files or dirs,
  // named "<agent>.md" or "<agent>/".
  const agentDirs = [join(home, ".claude", "agents"), ...projectRoots.map((r) => join(r, ".claude", "agents"))];
  let agentCount = 0;
  for (const d of agentDirs) {
    for (const entry of listEntries(d)) {
      ids.add(entry.replace(/\.md$/i, "").toLowerCase());
      agentCount++;
    }
  }
  if (agentCount) found.push(`${agentCount} subagent(s)`);

  // Plugins: ~/.claude/plugins/* (best-effort — layout varies). Also look for
  // skills *bundled inside* plugins, since many skills (e.g. the Anthropic
  // document skills) ship via a plugin rather than ~/.claude/skills.
  const pluginsRoot = join(home, ".claude", "plugins");
  const pluginDirs = dirNames(pluginsRoot);
  for (const p of pluginDirs) ids.add(p.toLowerCase());
  if (pluginDirs.length) found.push(`${pluginDirs.length} plugin dir(s)`);
  let pluginSkills = 0;
  for (const skillsDir of findSkillsDirs(pluginsRoot, 4)) {
    for (const name of dirNames(skillsDir)) {
      ids.add(name.toLowerCase());
      pluginSkills++;
    }
  }
  if (pluginSkills) found.push(`${pluginSkills} plugin-provided skill(s)`);

  // MCP servers: ~/.claude.json, project .mcp.json and .cursor/mcp.json
  const before = ids.size;
  mcpServerIds(safeReadJson(join(home, ".claude.json")), ids);
  for (const r of projectRoots) {
    mcpServerIds(safeReadJson(join(r, ".mcp.json")), ids);
    mcpServerIds(safeReadJson(join(r, ".cursor", "mcp.json")), ids);
  }
  const mcpCount = ids.size - before;
  if (mcpCount) found.push(`${mcpCount} MCP id(s)`);

  const note = found.length
    ? `Detected in your setup: ${found.join(", ")}.`
    : "Couldn't detect any installed skills/plugins/MCP servers at the usual paths — " +
      "recommendations below may include things you already have.";

  return { identifiers: ids, note };
}
