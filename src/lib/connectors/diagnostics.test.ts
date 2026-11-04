import assert from "node:assert/strict";
import test from "node:test";
import { runConnectorDiagnostic } from "./diagnostics.ts";

test("connector diagnostics do not make a request when credentials are missing", async () => {
  let calls = 0;
  const fetchMock = (async () => {
    calls += 1;
    throw new Error("should not be called");
  }) as typeof fetch;

  await assert.rejects(
    runConnectorDiagnostic("shopify", {}, fetchMock),
    /Shopify Admin API 尚未配置凭证/,
  );
  assert.equal(calls, 0);
});

test("Shopify diagnostic verifies a self-owned shop with a read-only request", async () => {
  let requestUrl = "";
  let accessToken = "";
  const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requestUrl = String(input);
    accessToken = new Headers(init?.headers).get("x-shopify-access-token") ?? "";
    return Response.json({
      shop: { name: "PawLab Test", currency: "USD", country_code: "US", email: "not-returned@example.com" },
    });
  }) as typeof fetch;

  const result = await runConnectorDiagnostic(
    "shopify",
    {
      SHOPIFY_SHOP_DOMAIN: "pawlab-test.myshopify.com",
      SHOPIFY_ACCESS_TOKEN: "shpat_test_only",
      SHOPIFY_API_VERSION: "2026-10",
    },
    fetchMock,
  );

  assert.equal(result.status, "verified");
  assert.equal(result.verificationLevel, "seller_read");
  assert.equal(requestUrl, "https://pawlab-test.myshopify.com/admin/api/2026-10/shop.json");
  assert.equal(accessToken, "shpat_test_only");
  assert.equal(result.details.shopName, "PawLab Test");
  assert.equal(JSON.stringify(result).includes("shpat_test_only"), false);
  assert.equal(JSON.stringify(result).includes("not-returned@example.com"), false);
});

test("Amazon diagnostic exchanges LWA refresh token and verifies marketplace participation", async () => {
  const calls: string[] = [];
  const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url === "https://api.amazon.com/auth/o2/token") {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
      return Response.json({ access_token: "Atza|temporary", expires_in: 3600 });
    }
    if (url === "https://sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations") {
      assert.equal(new Headers(init?.headers).get("x-amz-access-token"), "Atza|temporary");
      return Response.json({
        payload: [
          { marketplace: { id: "ATVPDKIKX0DER", countryCode: "US" } },
          { marketplace: { id: "A1F83G8C2ARO7P", countryCode: "GB" } },
        ],
      });
    }
    throw new Error(`unexpected URL ${url}`);
  }) as typeof fetch;

  const result = await runConnectorDiagnostic(
    "amazon_sp_api",
    {
      AMAZON_SP_API_CLIENT_ID: "client-id",
      AMAZON_SP_API_CLIENT_SECRET: "client-secret",
      AMAZON_SP_API_REFRESH_TOKEN: "refresh-token",
      AMAZON_SP_API_REGION: "na",
    },
    fetchMock,
  );

  assert.equal(result.status, "verified");
  assert.equal(result.details.marketplaceCount, 2);
  assert.deepEqual(result.details.marketplaceIds, ["ATVPDKIKX0DER", "A1F83G8C2ARO7P"]);
  assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(result).includes("client-secret"), false);
  assert.equal(JSON.stringify(result).includes("refresh-token"), false);
  assert.equal(JSON.stringify(result).includes("Atza|temporary"), false);
});

test("eBay diagnostic only claims application credential validation", async () => {
  const fetchMock = (async () => Response.json({ access_token: "v^1.1#token", expires_in: 7200, scope: "scope" })) as typeof fetch;
  const result = await runConnectorDiagnostic(
    "ebay",
    { EBAY_CLIENT_ID: "app-id", EBAY_CLIENT_SECRET: "app-secret", EBAY_ENVIRONMENT: "sandbox" },
    fetchMock,
  );

  assert.equal(result.status, "credentials_valid");
  assert.equal(result.verificationLevel, "application_credentials");
  assert.match(result.message, /卖家 OAuth/);
  assert.equal(JSON.stringify(result).includes("v^1.1#token"), false);
});

test("unsupported connectors remain explicitly unsupported without external requests", async () => {
  let calls = 0;
  const fetchMock = (async () => {
    calls += 1;
    return Response.json({});
  }) as typeof fetch;
  const result = await runConnectorDiagnostic("tiktok_shop", {}, fetchMock);

  assert.equal(result.status, "unsupported");
  assert.equal(result.details.externalRequestAttempted, false);
  assert.equal(calls, 0);
});
