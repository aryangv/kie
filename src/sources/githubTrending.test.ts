import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTrendingRefs } from "./githubTrending.js";

// A representative slice of the /trending markup: each repo row carries a
// "/owner/repo/stargazers" link. If GitHub changes that structure, this test
// fails loudly instead of the source silently returning nothing.
const SAMPLE = `
  <nav><a href="/sponsors/explore">Sponsors</a><a href="/trending/developers">Devs</a></nav>
  <article class="Box-row">
    <h2><a href="/oven-sh/bun">bun</a></h2>
    <a href="/oven-sh/bun/stargazers">12,000</a>
  </article>
  <article class="Box-row">
    <a href="/charmbracelet/bubbletea/stargazers">9,000</a>
  </article>
`;

test("extractTrendingRefs pulls repo refs from stargazers links", () => {
  const refs = extractTrendingRefs(SAMPLE);
  assert.deepEqual(refs, ["oven-sh/bun", "charmbracelet/bubbletea"]);
});

test("extractTrendingRefs ignores nav/reserved paths and dedupes", () => {
  const refs = extractTrendingRefs(SAMPLE + SAMPLE);
  assert.ok(!refs.some((r) => r.startsWith("sponsors/") || r.startsWith("trending/")));
  assert.equal(new Set(refs).size, refs.length);
});
