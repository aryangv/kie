import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstallPlan, classifyArtifact } from "./install.js";
import type { Tool } from "../types.js";

const tool = (over: Partial<Tool> & { repoRef: string }): Tool => ({
  id: 1,
  url: `https://github.com/${over.repoRef}`,
  name: over.repoRef.split("/")[1],
  description: null,
  language: null,
  topics: [],
  currentStars: 0,
  readme: null,
  firstSeen: 0,
  ...over,
});

test("classifyArtifact detects CLI apps from topics/description/name", () => {
  assert.equal(classifyArtifact(tool({ repoRef: "x/rg", topics: ["cli", "search"] })), "cli");
  assert.equal(
    classifyArtifact(tool({ repoRef: "x/tool", description: "A blazing fast command-line tool" })),
    "cli",
  );
  assert.equal(classifyArtifact(tool({ repoRef: "x/foo-cli" })), "cli");
});

test("classifyArtifact detects libraries", () => {
  assert.equal(
    classifyArtifact(tool({ repoRef: "x/lib", topics: ["library"], description: "A TypeScript SDK" })),
    "library",
  );
});

test("classifyArtifact returns unknown when signals conflict or are absent", () => {
  assert.equal(classifyArtifact(tool({ repoRef: "x/plain" })), "unknown");
  // both a library and a cli signal -> ambiguous
  assert.equal(
    classifyArtifact(tool({ repoRef: "x/both", topics: ["library", "cli"] })),
    "unknown",
  );
});

test("Go CLI uses `go install …@latest`, NOT `go get`", () => {
  const plan = buildInstallPlan(tool({ repoRef: "junegunn/fzf", language: "Go", topics: ["cli"] }));
  assert.equal(plan.kind, "cli-tool");
  assert.deepEqual(plan.commands, ["go install github.com/junegunn/fzf@latest"]);
  assert.ok(!plan.commands.some((c) => /\bgo get\b/.test(c)), "must not emit go get for a CLI");
});

test("Go library uses `go get`", () => {
  const plan = buildInstallPlan(
    tool({ repoRef: "spf13/cobra", language: "Go", topics: ["library"], description: "A library for building CLIs" }),
  );
  // description mentions both 'library' and 'cli' -> ambiguous -> shows both.
  assert.ok(plan.commands.some((c) => c.includes("go get github.com/spf13/cobra")));
});

test("Go ambiguous shows both install and get", () => {
  const plan = buildInstallPlan(tool({ repoRef: "acme/thing", language: "Go" }));
  assert.equal(plan.kind, "go-module");
  assert.ok(plan.commands.some((c) => c.includes("go install github.com/acme/thing@latest")));
  assert.ok(plan.commands.some((c) => c.includes("go get github.com/acme/thing")));
});

test("Rust CLI uses cargo install; library uses cargo add", () => {
  const cli = buildInstallPlan(tool({ repoRef: "x/rg", language: "Rust", topics: ["cli"] }));
  assert.deepEqual(cli.commands, ["cargo install rg"]);
  const lib = buildInstallPlan(tool({ repoRef: "x/serde", language: "Rust", topics: ["library"] }));
  assert.deepEqual(lib.commands, ["cargo add serde"]);
});

test("npm CLI suggests npx / global install; library suggests npm install", () => {
  const cli = buildInstallPlan(tool({ repoRef: "x/create-app", language: "TypeScript", topics: ["cli"] }));
  assert.equal(cli.kind, "cli-tool");
  assert.ok(cli.commands.some((c) => c.startsWith("npx ")));
  assert.ok(cli.commands.some((c) => c.includes("npm install -g")));

  const lib = buildInstallPlan(tool({ repoRef: "x/zod", language: "TypeScript", topics: ["library"] }));
  assert.deepEqual(lib.commands, ["npm install zod"]);
});

test("python CLI prefers pipx; library prefers pip", () => {
  const cli = buildInstallPlan(tool({ repoRef: "x/httpie", language: "Python", topics: ["cli"] }));
  assert.ok(cli.commands.some((c) => c.startsWith("pipx install")));
  const lib = buildInstallPlan(tool({ repoRef: "x/requests", language: "Python", topics: ["library"] }));
  assert.deepEqual(lib.commands, ["pip install requests"]);
});

test("MCP servers still get IDE wiring regardless of language", () => {
  const plan = buildInstallPlan(tool({ repoRef: "x/cool", language: "Python", topics: ["mcp-server", "mcp"] }));
  assert.equal(plan.kind, "mcp-server");
  assert.ok(plan.commands.some((c) => c.includes("claude mcp add")));
});
