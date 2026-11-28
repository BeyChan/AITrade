import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ApiHttpError,
  ApiInputError,
  apiError,
  corsHeaders,
  readJsonObject,
  withApiRoute,
} from "./api-http.ts";

describe("API HTTP helpers", () => {
  it("maps input and explicit HTTP errors to their status codes", async () => {
    const inputResponse = apiError(new ApiInputError("参数错误", 422));
    assert.equal(inputResponse.status, 422);
    assert.deepEqual(await inputResponse.json(), { error: "参数错误" });

    const conflictResponse = apiError(new ApiHttpError("版本冲突", 409));
    assert.equal(conflictResponse.status, 409);
    assert.deepEqual(await conflictResponse.json(), { error: "版本冲突" });
  });

  it("maps unknown errors to 500 and redacts credentials", async () => {
    const response = apiError(new Error("upstream failed api_key=super-secret-token"));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "upstream failed api_key=[REDACTED]" });
  });

  it("wraps successful and failed handlers without changing success responses", async () => {
    const ok = withApiRoute(async (request: Request) => {
      assert.equal(request.url, "http://localhost/test");
      return Response.json({ ok: true }, { status: 201 });
    });
    const okResponse = await ok(new Request("http://localhost/test"));
    assert.equal(okResponse.status, 201);
    assert.deepEqual(await okResponse.json(), { ok: true });

    const failed = withApiRoute(async (_request: Request) => {
      throw new ApiHttpError("找不到资源", 404);
    });
    const failedResponse = await failed(new Request("http://localhost/test"));
    assert.equal(failedResponse.status, 404);
  });

  it("builds origin-aware CORS headers with a configurable method contract", () => {
    const request = new Request("http://localhost/test", {
      headers: { origin: "chrome-extension://example" },
    });
    assert.deepEqual(
      corsHeaders(request, { methods: "POST, OPTIONS", maxAgeSeconds: 86400 }),
      {
        "Access-Control-Allow-Origin": "chrome-extension://example",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    );
    assert.equal(
      corsHeaders(new Request("http://localhost/test"), { methods: "GET, OPTIONS" })[
        "Access-Control-Allow-Origin"
      ],
      "*",
    );
  });

  it("rejects malformed JSON bodies as input errors", async () => {
    await assert.rejects(
      () => readJsonObject(new Request("http://localhost/test", { method: "POST", body: "[]" })),
      (error: unknown) => error instanceof ApiInputError && error.status === 400,
    );
  });
});
