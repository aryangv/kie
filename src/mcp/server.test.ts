import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createKieServer } from "./server.js";
import { Store } from "../store/db.js";

// Drive the real server over an in-memory transport (no stdio, no build step) to
// prove the tool wiring: every tool registers with a valid schema, and a
// no-network handler responds end-to-end.
test("server registers all 12 tools and serves a no-network handler", async () => {
  const prevRoots = process.env.KIE_CODE_ROOTS;
  // Point the profile scan at an empty dir so ensureProfileFresh touches nothing real.
  process.env.KIE_CODE_ROOTS = mkdtempSync(join(tmpdir(), "kie-srv-test-"));
  const store = new Store(":memory:");
  const client = new Client({ name: "test", version: "0.0.0" });
  try {
    const server = createKieServer(store);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.equal(names.length, 12, `expected 12 tools, got ${names.join(", ")}`);
    for (const expected of [
      "whats_trending", "tool_details", "whats_new", "should_i_use", "profile_get",
      "profile_update", "profile_infer", "recommend_extensions", "record_decision",
      "install_tool", "refresh_now", "setup",
    ]) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }

    // profile_get exercises a real handler (ensureProfileFresh -> format) with no network.
    const res = await client.callTool({ name: "profile_get", arguments: {} });
    const text = (res.content as { type: string; text: string }[])[0].text;
    assert.match(text, /profile/i);
  } finally {
    await client.close();
    store.close();
    prevRoots === undefined ? delete process.env.KIE_CODE_ROOTS : (process.env.KIE_CODE_ROOTS = prevRoots);
  }
});

test("host-model lane: profile_infer responds and profile_update persists setCategories", async () => {
  const prevRoots = process.env.KIE_CODE_ROOTS;
  process.env.KIE_CODE_ROOTS = mkdtempSync(join(tmpdir(), "kie-infer-test-"));
  const store = new Store(":memory:");
  const client = new Client({ name: "test", version: "0.0.0" });
  try {
    const server = createKieServer(store);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const textOf = (r: unknown) =>
      ((r as { content: { type: string; text: string }[] }).content)[0].text;

    // profile_infer responds end-to-end with no network (empty stack -> nothing to do).
    const infer = await client.callTool({ name: "profile_infer", arguments: {} });
    assert.match(textOf(infer), /infer|categoriz/i);

    // The model's write-back: assign a category to a dep the taxonomy doesn't know.
    await client.callTool({
      name: "profile_update",
      arguments: { setCategories: [{ library: "MysteryLib", category: "AI-Tool" }] },
    });

    // It persists as an inferred row: lowercased, model-confidence (0.9), and it
    // now shows up as covering that category in the rendered profile.
    const row = store.allProfileRows().find((r) => r.key === "library:mysterylib");
    assert.ok(row, "setCategories row persisted");
    assert.equal(row!.category, "ai-tool", "category normalized to lowercase");
    assert.equal(row!.confidence, 0.9, "stored at model-inferred confidence");

    const profile = await client.callTool({ name: "profile_get", arguments: {} });
    assert.match(textOf(profile), /ai-tool/, "inferred category surfaces in the profile");
  } finally {
    await client.close();
    store.close();
    prevRoots === undefined ? delete process.env.KIE_CODE_ROOTS : (process.env.KIE_CODE_ROOTS = prevRoots);
  }
});
