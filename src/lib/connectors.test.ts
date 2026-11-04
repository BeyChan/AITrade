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

test("Keepa retries transient HTTP failures and records each attempt", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    if (requestCount === 1) return new Response("temporary", { status: 503 });
    return new Response(JSON.stringify({
      products: [{
        asin: "B0RETRY001",
        title: "Retry Product",
        monthlySold: 10,
        stats: { current: [null, 1499] },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await fetchKeepaCandidates({
      asins: ["B0RETRY001"],
      marketplace: "US",
      env: { NODE_ENV: "test", KEEPA_API_KEY: "retry-test-key" } as NodeJS.ProcessEnv,
      fetchOptions: { maxAttempts: 2, retryBaseDelayMs: 1, sleep: async () => {} },
    });
    assert.equal(requestCount, 2);
    assert.equal(result.records.length, 1);
    assert.deepEqual(result.apiCalls?.map((call) => [call.statusCode, call.retryCount]), [[503, 0], [200, 1]]);
    assert.equal(result.apiCalls?.[0].endpoint, "/product");
    assert.equal(result.apiCalls?.[0].requestSummary.asinCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Keepa stops after the configured transient retry budget", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response("upstream unavailable", { status: 500 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      fetchKeepaCandidates({
        asins: ["B0RETRY002"],
        marketplace: "US",
        env: { NODE_ENV: "test", KEEPA_API_KEY: "retry-test-key" } as NodeJS.ProcessEnv,
        fetchOptions: { maxAttempts: 3, retryBaseDelayMs: 1, sleep: async () => {} },
      }),
      /3 次尝试后失败/,
    );
    assert.equal(requestCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
