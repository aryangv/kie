import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../store/db.js";
import { recommendStarters, CURATED } from "./curated.js";
import { buildProfileView } from "../profile/profile.js";

test("recommends curated tools whose category isn't covered", () => {
  const store = new Store(":memory:");
  const recs = recommendStarters(store, buildProfileView(store));
  // Empty profile -> everything is a fresh recommendation.
  assert.equal(recs.filter((r) => r.status === "recommend").length, CURATED.length);
  store.close();
});

test("marks a category the user already covers as 'covered'", () => {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  // Give the user a 'cli' incumbent; jq is categorized 'cli'.
  store.upsertProfileRow({ key: "library:commander", kind: "library", label: "commander", category: "cli", weight: 1, now });
  const recs = recommendStarters(store, buildProfileView(store));
  const jq = recs.find((r) => r.tool.name === "jq")!;
  assert.equal(jq.status, "covered");
  store.close();
});

test("respects prior decisions", () => {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  const id = store.upsertTool("burntsushi/ripgrep", "https://github.com/BurntSushi/ripgrep", "ripgrep", now);
  store.setDecision(id, "rejected", null, now);
  const recs = recommendStarters(store, buildProfileView(store));
  const rg = recs.find((r) => r.tool.name === "ripgrep")!;
  assert.equal(rg.status, "decided");
  store.close();
});
