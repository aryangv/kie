import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanInstalledExtensions } from "./installed.js";
import { recommendExtensions } from "./recommend.js";
import { formatExtensionRecs } from "../mcp/format.js";
import type { Extension } from "./catalog.js";
import type { ProfileView } from "../profile/profile.js";

function profile(categories: string[]): ProfileView {
  return {
    languages: new Set(["typescript"]),
    categoryIncumbents: new Map(categories.map((c) => [c, ["x"]])),
    rows: [],
    isEmpty: false,
  };
}

const ext = (over: Partial<Extension> & { id: string; kind: Extension["kind"] }): Extension => ({
  name: over.id,
  description: "d",
  url: "https://example.com",
  relevantCategories: [],
  match: [over.id],
  install: ["do the thing"],
  why: "because",
  ...over,
});

test("formatter uses kind-aware verbs (get it / add / install)", () => {
  const recs = recommendExtensions(
    [
      ext({ id: "saas:x", kind: "saas", universal: true, install: ["Get it: https://x.com"] }),
      ext({ id: "sub:y", kind: "subagent", universal: true, install: ["drop into .claude/agents"] }),
      ext({ id: "mcp:z", kind: "mcp-server", universal: true, install: ["npx z"] }),
    ],
    profile([]),
    new Set(),
  );
  const out = formatExtensionRecs(recs, "note");
  assert.match(out, /\[SaaS\] saas:x.*\n.*\n\s+get it:/);
  assert.match(out, /\[subagent\] sub:y.*\n.*\n\s+add:/);
  assert.match(out, /\[MCP server\] mcp:z.*\n.*\n\s+install:/);
});

test("installed scan detects subagents under .claude/agents", () => {
  const root = mkdtempSync(join(tmpdir(), "kie-agents-"));
  mkdirSync(join(root, ".claude", "agents"), { recursive: true });
  writeFileSync(join(root, ".claude", "agents", "code-reviewer.md"), "# reviewer");
  const scan = scanInstalledExtensions([root]);
  assert.ok(scan.identifiers.has("code-reviewer"), "agent file detected (sans .md)");
});
