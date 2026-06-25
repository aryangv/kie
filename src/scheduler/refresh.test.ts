import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../store/db.js";
import {
  selectForEnrich,
  refreshInBackground,
  ensureFreshInBackground,
  isRefreshing,
  type EnrichCandidate,
} from "./refresh.js";
import type { Source, FetchOptions } from "../sources/types.js";
import type { RawMention } from "../types.js";

function cand(id: number, lastEnrichedAt: number | null): EnrichCandidate {
  return { id, repoRef: `o/${id}`, lastEnrichedAt };
}

test("selectForEnrich skips still-fresh repos and keeps the never-enriched", () => {
  const now = 1_000_000;
  const cutoff = now - 24 * 3600;
  const candidates = [
    cand(1, null), // never enriched -> enrich
    cand(2, now - 100), // fresher than cutoff -> skip
    cand(3, cutoff - 100), // older than cutoff -> enrich
    cand(4, cutoff), // exactly at cutoff -> enrich (<=)
  ];
  const { enrich, freshSkipped } = selectForEnrich(candidates, cutoff, 100);
  assert.deepEqual(enrich.map((c) => c.id), [1, 3, 4]);
  assert.equal(freshSkipped, 1);
});

test("selectForEnrich caps the batch but preserves order", () => {
  const cutoff = 500;
  const candidates = [cand(1, null), cand(2, null), cand(3, null), cand(4, null)];
  const { enrich, freshSkipped } = selectForEnrich(candidates, cutoff, 2);
  assert.deepEqual(enrich.map((c) => c.id), [1, 2]);
  assert.equal(freshSkipped, 0);
});

// ---- background refresh guard --------------------------------------------

class FakeSource implements Source {
  readonly name = "hackernews" as const;
  fetchCount = 0;
  constructor(private readonly delayMs: number) {}
  isEnabled() {
    return true;
  }
  async fetch(_opts: FetchOptions): Promise<RawMention[]> {
    this.fetchCount++;
    await new Promise((r) => setTimeout(r, this.delayMs));
    // No repoRef: the mention is dropped by the collector, so refresh() does no
    // GitHub enrichment and the test stays fully offline. lastRefresh is still
    // stamped, which is all these guard/warming assertions care about.
    return [
      {
        source: "hackernews",
        externalId: "x1",
        title: "t",
        url: "https://example.com",
        points: 1,
        createdAt: Math.floor(Date.now() / 1000),
      },
    ];
  }
}

test("refreshInBackground dedupes concurrent passes into one", async () => {
  const store = new Store(":memory:");
  const src = new FakeSource(30);
  const p1 = refreshInBackground(store, [src]);
  const p2 = refreshInBackground(store, [src]);
  assert.equal(p1, p2, "concurrent calls share the in-flight promise");
  assert.equal(isRefreshing(), true);
  await p1;
  assert.equal(isRefreshing(), false, "guard clears after completion");
  assert.equal(src.fetchCount, 1, "only one network pass ran");
  store.close();
});

test("ensureFreshInBackground reports warming until the first pass lands", async () => {
  const store = new Store(":memory:");
  const src = new FakeSource(10);
  const first = ensureFreshInBackground(store, 6, [src]);
  assert.equal(first.warming, true, "no cached data yet -> warming");
  assert.equal(first.refreshing, true, "a background pass was kicked off");
  // Let the in-flight refresh finish.
  await refreshInBackground(store, [src]);
  const second = ensureFreshInBackground(store, 6, [src]);
  assert.equal(second.warming, false, "data exists now -> no longer warming");
  store.close();
});
