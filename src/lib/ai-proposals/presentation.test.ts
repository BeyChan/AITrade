import assert from "node:assert/strict";
import { test } from "node:test";
import { generationLabel } from "./presentation.ts";

test("generation labels distinguish model, template and manual sources", () => {
  assert.equal(
    generationLabel({ source: "model", provider: "openai-compatible", model: "gpt-test" }),
    "模型生成 · gpt-test",
  );
  assert.equal(
    generationLabel({ source: "model", provider: "openai-compatible" }),
    "模型生成 · openai-compatible",
  );
  assert.equal(
    generationLabel({ source: "template", provider: "template" }),
    "确定性模板生成",
  );
  assert.equal(
    generationLabel({ source: "template", provider: "template", fallback: true }),
    "模板兜底 · 模型调用失败",
  );
  assert.equal(
    generationLabel({ source: "manual" }),
    "人工触发采集 · 确定性规则评分",
  );
});
