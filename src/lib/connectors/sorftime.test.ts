import assert from "node:assert/strict";
import test from "node:test";
import {
  ConnectorNotConfiguredError,
  fetchSorftimeCandidates,
  normalizeSorftimeRequest,
} from "./sorftime.ts";

const categoryReport = {
  "Top100产品": [{
    ASIN: "B0CP6DDN1H",
    标题: "Motorola Moto G Play",
    月销量: "10533",
    月销额: "1200762.00",
    品牌: "Motorola",
    所处类目排名: "类目：Renewed Smartphones，排名:3\n类目：Cell Phones，排名:4",
    价格: 114.0,
    产品分类: "CELLULAR PHONE",
    评论数: 4827,
    星级: 4.3,
    卖家: "Techmate Intl.",
  }],
  类目统计报告: {
    nodeid: "7072561011",
    类目名称: "Cell Phones",
    "top100产品月销量": "232127",
    "top100产品月销额": "81687183.19",
    top3_brands_sales_volume_share: "销量前三的品牌月销量占比:84.11%",
    amazonOwned_sales_volume_share: "亚马逊自营月销量占比:22.38%",
    average_price: "销量前的80%产品平均价格：363.7295",
    median_price: "销量前的80%产品中位价格：338.00",
    low_reviews_sales_volume_share: "评价数量300以下产品月销量占比：9.07%",
  },
};

function mcpEnvelope(payload: unknown, options: { sse?: boolean; prefix?: string } = {}) {
  const envelope = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{
        type: "text",
        text: `${options.prefix ?? ""}${JSON.stringify(payload)}`,
      }],
    },
  });
  if (!options.sse) return envelope;
  return `event: message\ndata: ${envelope}\n\n`;
}

function toolName(init?: RequestInit) {
  return (JSON.parse(String(init?.body)) as { params?: { name?: string } }).params?.name ?? "";
}

test("Sorftime without a key throws not_configured and makes no external request", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      fetchSorftimeCandidates({
        mode: "asin",
        marketplace: "US",
        asins: ["B0TEST0001"],
        env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      }),
      (error: unknown) => error instanceof ConnectorNotConfiguredError && error.code === "not_configured",
    );
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sorftime parses SSE category research, maps fields and preserves category ratios", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; tool: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const tool = toolName(init);
    requests.push({ url: String(input), tool });
    if (tool === "category_name_search") {
      return new Response(mcpEnvelope({ items: [{ nodeId: "7072561011", name: "Cell Phones" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      mcpEnvelope(categoryReport, { sse: true, prefix: "如无明确指令不要延伸调用其他工具。\r\n" }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }) as typeof fetch;

  try {
    const result = await fetchSorftimeCandidates({
      mode: "category",
      marketplace: "US",
      categoryQuery: "Cell Phones",
      env: { NODE_ENV: "test", SORFTIME_API_KEY: "test-sorftime-key" } as NodeJS.ProcessEnv,
      fetchOptions: { retryBaseDelayMs: 1, sleep: async () => {} },
    });

    assert.equal(result.records.length, 1);
    const record = result.records[0].record;
    assert.equal(record.asin, "B0CP6DDN1H");
    assert.equal(record.competitorPriceCents, 11400);
    assert.equal(record.monthlySalesEstimate, 10533);
    assert.equal(record.monthlySalesMin, 10533);
    assert.equal(record.monthlySalesMax, 10533);
    assert.equal(record.reviewCount, 4827);
    assert.equal(record.rating, 4.3);
    assert.equal(record.bsr, 4);
    assert.equal(record.source, "sorftime");
    assert.match(record.notes ?? "", /第三方估算/);
    assert.match(record.notes ?? "", /研究占位值/);

    const evidence = result.additionalEvidence?.[0]?.normalizedPayload as {
      stats?: Record<string, unknown>;
    } | undefined;
    assert.equal(evidence?.stats?.top3_brands_sales_volume_share, "销量前三的品牌月销量占比:84.11%");
    assert.equal(evidence?.stats?.amazonOwned_sales_volume_share, "亚马逊自营月销量占比:22.38%");
    assert.equal(evidence?.stats?.low_reviews_sales_volume_share, "评价数量300以下产品月销量占比：9.07%");

    assert.deepEqual(result.apiCalls?.map((call) => call.requestSummary.tool), [
      "category_name_search",
      "category_report",
    ]);
    assert.ok(requests.every((request) => request.url.startsWith("https://mcp.sorftime.com/")));
    assert.ok(requests.every((request) => !JSON.stringify(result.apiCalls).includes("test-sorftime-key")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sorftime parses normal JSON ASIN research and repairs mojibake", async () => {
  const originalFetch = globalThis.fetch;
  const expectedTitle = "测试商品";
  const mojibakeTitle = Buffer.from(expectedTitle, "utf8").toString("latin1");
  let requestCount = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestCount += 1;
    assert.equal(toolName(init), "product_detail");
    return new Response(mcpEnvelope([{
      "产品ASIN码": "B0ASIN0001",
      标题: mojibakeTitle,
      价格: 29.99,
      月销量: 87,
      评论数: 12,
      星级: 4.6,
    }]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await fetchSorftimeCandidates({
      mode: "asin",
      marketplace: "GB",
      asins: ["b0asin0001"],
      env: { NODE_ENV: "test", SORFTIME_API_KEY: "test-sorftime-key" } as NodeJS.ProcessEnv,
    });
    assert.equal(requestCount, 1);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].record.asin, "B0ASIN0001");
    assert.equal(result.records[0].record.marketplace, "GB");
    assert.equal(result.records[0].record.currency, "GBP");
    assert.equal(result.records[0].record.title, expectedTitle);
    assert.equal(result.records[0].record.competitorPriceCents, 2999);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sorftime retries 429 and 5xx and records every attempt", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
    }
    if (requestCount === 2) return new Response("unavailable", { status: 503 });
    return new Response(mcpEnvelope([{
      "产品ASIN码": "B0RETRY001",
      价格: 19.99,
      月销量: 10,
    }]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await fetchSorftimeCandidates({
      mode: "asin",
      marketplace: "US",
      asins: ["B0RETRY001"],
      env: { NODE_ENV: "test", SORFTIME_API_KEY: "retry-test-key" } as NodeJS.ProcessEnv,
      fetchOptions: { maxAttempts: 3, retryBaseDelayMs: 1, sleep: async () => {} },
    });
    assert.equal(requestCount, 3);
    assert.equal(result.records.length, 1);
    assert.deepEqual(
      result.apiCalls?.map((call) => [call.statusCode, call.retryCount]),
      [[429, 0], [503, 1], [200, 2]],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sorftime caps a single ASIN study at 20 products", async () => {
  const asins = Array.from({ length: 21 }, (_, index) => `B0TEST${String(index).padStart(4, "0")}`);
  assert.throws(
    () => normalizeSorftimeRequest({ mode: "asin", marketplace: "US", asins }),
    /最多 20 个 ASIN/,
  );

  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      fetchSorftimeCandidates({
        mode: "asin",
        marketplace: "US",
        asins,
        env: { NODE_ENV: "test", SORFTIME_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      }),
      /最多 20 个 ASIN/,
    );
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an empty Sorftime category never fabricates products", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const tool = toolName(init);
    const payload = tool === "category_name_search"
      ? { items: [{ nodeId: "12345", name: "Empty Category" }] }
      : { "Top100产品": [], 类目统计报告: { 类目名称: "Empty Category" } };
    return new Response(mcpEnvelope(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await fetchSorftimeCandidates({
      mode: "category",
      marketplace: "DE",
      categoryQuery: "Empty Category",
      env: { NODE_ENV: "test", SORFTIME_API_KEY: "test-key" } as NodeJS.ProcessEnv,
    });
    assert.equal(result.records.length, 0);
    assert.match(result.warnings.join(" "), /没有可导入/);
    assert.equal(result.additionalEvidence?.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
