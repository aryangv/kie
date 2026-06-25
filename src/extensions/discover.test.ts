import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpAddCommandFromReadme, isAgentFile, parseAgentMarkdown } from "./discover.js";

test("extracts a claude mcp add command from README markdown", () => {
  const readme = [
    "# Cool MCP Server",
    "Install it:",
    "```bash",
    "claude mcp add cool -- npx -y @acme/cool-mcp-server",
    "```",
    "Done.",
  ].join("\n");
  assert.equal(
    mcpAddCommandFromReadme(readme),
    "claude mcp add cool -- npx -y @acme/cool-mcp-server",
  );
});

test("handles prompt/markdown prefixes like '$ ' and '> '", () => {
  assert.equal(
    mcpAddCommandFromReadme("$ claude mcp add x -- npx -y x-server"),
    "claude mcp add x -- npx -y x-server",
  );
});

test("returns null when no command is present", () => {
  assert.equal(mcpAddCommandFromReadme("just some prose about the project"), null);
});

test("isAgentFile picks agent .md files and skips docs/boilerplate", () => {
  assert.equal(isAgentFile("agents/code-reviewer.md"), true);
  assert.equal(isAgentFile(".claude/agents/debugger.md"), true);
  assert.equal(isAgentFile("subagents/api-designer.md"), true);
  assert.equal(isAgentFile("my-agent.md"), true); // "agent" token in the filename
  assert.equal(isAgentFile("agents.md"), true);
  assert.equal(isAgentFile("README.md"), false);
  assert.equal(isAgentFile("docs/guide.md"), false); // not an agent dir/name
  assert.equal(isAgentFile("agents/code-reviewer.txt"), false); // not markdown
  assert.equal(isAgentFile("agents/CONTRIBUTING.md"), false);
  // Incidental substrings must NOT match (word-boundary, not bare /agent/).
  assert.equal(isAgentFile("reagent.md"), false);
  assert.equal(isAgentFile("docs/management.md"), false);
});

test("parseAgentMarkdown reads YAML frontmatter and strips it from the body", () => {
  const raw = [
    "---",
    "name: code-reviewer",
    'description: "Reviews diffs for bugs and quality"',
    "tools: [Read, Grep]",
    "---",
    "You are a meticulous senior code reviewer.",
    "Always reproduce before judging.",
  ].join("\n");
  const parsed = parseAgentMarkdown(raw);
  assert.equal(parsed.name, "code-reviewer");
  assert.equal(parsed.description, "Reviews diffs for bugs and quality");
  assert.ok(parsed.body.startsWith("You are a meticulous"));
  assert.doesNotMatch(parsed.body, /^---/);
});

test("parseAgentMarkdown falls back to heading + first prose line without frontmatter", () => {
  const raw = ["# Test Writer", "", "Writes thorough unit tests for changed code.", "", "- bullet"].join("\n");
  const parsed = parseAgentMarkdown(raw);
  assert.equal(parsed.name, "Test Writer");
  assert.equal(parsed.description, "Writes thorough unit tests for changed code.");
});
