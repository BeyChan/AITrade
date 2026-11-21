import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePrelaunchCompliance } from "./prelaunch-compliance.ts";

test("美站带电+无线商品自动输出 UN38.3、UL 与 FCC ID 强制清单", () => {
  const res = evaluatePrelaunchCompliance("US", ["battery", "wireless"], "cordless car vacuum");
  const codes = res.certifications.map((c) => c.code);
  assert.ok(codes.some((c) => c.includes("UN38.3")));
  assert.ok(codes.some((c) => c.includes("FCC")));
  assert.equal(res.riskLevel, "high");
  assert.ok(res.totalEstimatedCostUsd >= 3000);
  assert.equal(res.patentLinks.length, 3);
});

test("德国站默认附加包装法与欧代要求", () => {
  const res = evaluatePrelaunchCompliance("DE", ["food_contact"], "pet fountain");
  const codes = res.certifications.map((c) => c.code);
  assert.ok(codes.includes("LFGB"));
  assert.ok(codes.some((c) => c.includes("LUCID")));
});
