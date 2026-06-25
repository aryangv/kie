// Generate install instructions for a tool. We can't always know the exact
// published package name from a repo (npm/PyPI names often differ from the repo
// slug), so we emit the most likely command together with an honest caveat and
// the repo URL to verify against. MCP servers get IDE-specific wiring for both
// Claude Code and Cursor. Nothing here executes — the agent runs commands only
// after the user confirms.

import type { Tool } from "../types.js";
import { categorize } from "../match/taxonomy.js";
import { splitRef } from "../ingest/extract.js";

export interface InstallPlan {
  kind: "mcp-server" | "package" | "cli-tool" | "go-module" | "clone";
  commands: string[];
  notes: string[];
}

function isMcpServer(tool: Tool): boolean {
  const cats = categorize({ name: tool.name, topics: tool.topics, description: tool.description });
  if (cats.has("mcp")) return true;
  const hay = `${tool.name} ${tool.description ?? ""} ${tool.topics.join(" ")}`.toLowerCase();
  return hay.includes("mcp") || hay.includes("model context protocol");
}

/** Whether a repo is meant to be installed as a runnable app/CLI, imported as a
 * library, or can't be told apart. The install command differs sharply between
 * the two (e.g. `go install` vs `go get`, `cargo install` vs `cargo add`), so a
 * wrong guess produces a command that simply won't work. */
export type Artifact = "cli" | "library" | "unknown";

const CLI_TOPICS = new Set([
  "cli", "command-line", "commandline", "command-line-tool", "cli-tool", "cli-app",
  "terminal", "tui", "console", "shell", "binary",
]);
const LIB_TOPICS = new Set([
  "library", "sdk", "framework", "package", "module", "bindings", "api-client",
]);
const CLI_DESC =
  /\b(cli|command[- ]?line|terminal (?:app|application|ui)|tui|standalone (?:binary|executable|tool)|binary|executable)\b/i;
const LIB_DESC =
  /\b(librar(?:y|ies)|sdk|framework|package|module|api client|client library|bindings)\b/i;

export function classifyArtifact(tool: Tool): Artifact {
  const topics = new Set(tool.topics.map((t) => t.toLowerCase()));
  const cats = categorize({ name: tool.name, topics: tool.topics, description: tool.description });
  const desc = tool.description ?? "";

  let cli = false;
  let lib = false;
  for (const t of topics) {
    if (CLI_TOPICS.has(t)) cli = true;
    if (LIB_TOPICS.has(t)) lib = true;
  }
  if (cats.has("cli") || cats.has("terminal") || cats.has("editor")) cli = true;
  if (CLI_DESC.test(desc)) cli = true;
  if (LIB_DESC.test(desc)) lib = true;
  if (/[-_](cli|cmd)$/.test(tool.name.toLowerCase())) cli = true;

  if (cli && !lib) return "cli";
  if (lib && !cli) return "library";
  return "unknown";
}

export function buildInstallPlan(tool: Tool): InstallPlan {
  const { owner, name } = splitRef(tool.repoRef);
  const lang = (tool.language ?? "").toLowerCase();

  if (isMcpServer(tool)) {
    return {
      kind: "mcp-server",
      commands: [
        `# Claude Code:`,
        `claude mcp add ${name} -- npx -y ${name}`,
        ``,
        `# Cursor: add to .cursor/mcp.json`,
        JSON.stringify(
          { mcpServers: { [name]: { command: "npx", args: ["-y", name] } } },
          null,
          2,
        ),
      ],
      notes: [
        `${tool.repoRef} looks like an MCP server. Confirm the exact package/run command ` +
          `in its README — some are Python (use "uvx <pkg>") or need a build step.`,
        `Repo: ${tool.url}`,
      ],
    };
  }

  const artifact = classifyArtifact(tool);
  const verify = `Verify the exact name/command in the README: ${tool.url}`;

  switch (lang) {
    case "javascript":
    case "typescript": {
      const pkgNote = `Guessing the npm package name is "${name}" (it may be scoped, e.g. @${owner}/${name}). ${verify}`;
      if (artifact === "cli") {
        return {
          kind: "cli-tool",
          commands: [`npx ${name}`, `# or install globally:`, `npm install -g ${name}`],
          notes: [`${tool.repoRef} looks like a CLI app, so run it with npx or install it globally. ${pkgNote}`],
        };
      }
      if (artifact === "library") {
        return { kind: "package", commands: [`npm install ${name}`], notes: [pkgNote] };
      }
      return {
        kind: "package",
        commands: [`npm install ${name}`],
        notes: [pkgNote, `If it's actually a CLI app, run it with "npx ${name}" or install with "npm install -g ${name}".`],
      };
    }
    case "python": {
      const pkgNote = `Guessing the PyPI name is "${name}". ${verify}`;
      if (artifact === "cli") {
        return {
          kind: "cli-tool",
          commands: [`pipx install ${name}`, `# or:`, `uv tool install ${name}`],
          notes: [`${tool.repoRef} looks like a CLI app — pipx/uv install it as an isolated tool. ${pkgNote}`],
        };
      }
      if (artifact === "library") {
        return { kind: "package", commands: [`pip install ${name}`], notes: [pkgNote] };
      }
      return {
        kind: "package",
        commands: [`pip install ${name}`],
        notes: [pkgNote, `If it's actually a CLI app, prefer "pipx install ${name}".`],
      };
    }
    case "rust": {
      const crateNote = `Guessing the crate name is "${name}". ${verify} or crates.io.`;
      if (artifact === "cli") {
        return {
          kind: "cli-tool",
          commands: [`cargo install ${name}`],
          notes: [`${tool.repoRef} looks like a binary — "cargo install" builds and installs it. ${crateNote}`],
        };
      }
      if (artifact === "library") {
        return { kind: "package", commands: [`cargo add ${name}`], notes: [crateNote] };
      }
      return {
        kind: "package",
        commands: [`# as a library dependency:`, `cargo add ${name}`, `# as an installable binary:`, `cargo install ${name}`],
        notes: [`Couldn't tell if ${tool.repoRef} is a crate or a CLI binary — pick the matching command. ${crateNote}`],
      };
    }
    case "go": {
      const importPath = `github.com/${owner}/${name}`;
      if (artifact === "cli") {
        return {
          kind: "cli-tool",
          commands: [`go install ${importPath}@latest`],
          notes: [
            `${tool.repoRef} looks like a Go app — "go install …@latest" builds the binary into your GOBIN ` +
              `(NOT "go get", which only adds a dependency). The binary may live in a subdir, e.g. ` +
              `${importPath}/cmd/${name}@latest. ${verify}`,
          ],
        };
      }
      if (artifact === "library") {
        return {
          kind: "go-module",
          commands: [`go get ${importPath}`],
          notes: [`Adds ${tool.repoRef} as a module dependency (import path is reliable). Repo: ${tool.url}`],
        };
      }
      return {
        kind: "go-module",
        commands: [`# as an installable command:`, `go install ${importPath}@latest`, `# as a library dependency:`, `go get ${importPath}`],
        notes: [
          `Couldn't tell if ${tool.repoRef} is a Go app or a library — use "go install …@latest" for a CLI ` +
            `(binary may be under /cmd/...), or "go get" to import it. ${verify}`,
        ],
      };
    }
    default:
      return {
        kind: "clone",
        commands: [`git clone ${tool.url}`],
        notes: [
          `No package manager inferred (${tool.language ?? "unknown language"}). ` +
            `Follow the install steps in the README: ${tool.url}`,
        ],
      };
  }
}

export function formatInstallPlan(tool: Tool, plan: InstallPlan): string {
  return (
    `Install plan for ${tool.repoRef} (${plan.kind}):\n\n` +
    plan.commands.join("\n") +
    `\n\nNotes:\n` +
    plan.notes.map((n) => `  • ${n}`).join("\n") +
    `\n\nConfirm before I run anything.`
  );
}
