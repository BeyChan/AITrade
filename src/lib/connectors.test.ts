import assert from "node:assert/strict";
import test from "node:test";
import { getConnectorReadiness } from "./connectors/registry.ts";
import { ConnectorNotConfiguredError, fetchKeepaCandidates } from "./connectors/keepa.ts";

test("manual quote entry is registered as an available local source", () => {
  const manual = getConnectorReadiness({ NODE_ENV: "test" } as NodeJS.ProcessEnv).find(
    (source) => source.code === "manual_quotes",
  );
  assert.equal(manual?.status, "available");
  assert.equal(manual?.configured, true);
});

test("Keepa without a key throws not_configured and makes no external request", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      fetchKeepaCandidates({
        asins: ["B0TEST001"],
        marketplace: "US",
        env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      }),
      (error: unknown) => error instanceof ConnectorNotConfiguredError && error.code === "not_configured",
    );
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Keepa read-only adapter maps product price and market metadata", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        products: [
          {
            asin: "b0test001",
            title: "Test Product",
            categoryTree: [{ name: "Pet Supplies" }, { name: "Fountains" }],
            monthlySold: 1200,
            reviewCount: 340,
            rating: 43,
            stats: { current: [null, 3999, 4500, 1250] },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const result = await fetchKeepaCandidates({
      asins: ["B0TEST001", "b0test001"],
      marketplace: "US",
      env: { NODE_ENV: "test", KEEPA_API_KEY: "test-key" } as NodeJS.ProcessEnv,
    });
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].record.asin, "B0TEST001");
    assert.equal(result.records[0].record.competitorPriceCents, 3999);
    assert.equal(result.records[0].record.monthlySalesEstimate, 1200);
    assert.equal(result.records[0].record.rating, 4.3);
    assert.equal(result.records[0].sourceRecordId, "US:B0TEST001");
    assert.match(requestedUrl, /domain=1/);
    assert.match(requestedUrl, /asin=B0TEST001/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
