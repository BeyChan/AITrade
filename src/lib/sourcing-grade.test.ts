import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSourcingGrade } from "./sourcing-grade.ts";

test("resolveSourcingGrade assigns unified S / A / B / HOLD / ELIMINATED tiers", () => {
  assert.equal(
    resolveSourcingGrade({
      hardFail: true,
      hasRealEvidence: true,
      marketStatus: "pass",
      marginRate: 0.3,
      score: 90,
    }),
    "ELIMINATED",
  );

  assert.equal(
    resolveSourcingGrade({
      hardFail: false,
      hasRealEvidence: false,
      marketStatus: "pass",
      marginRate: 0.3,
      score: 90,
    }),
    "HOLD",
  );

  assert.equal(
    resolveSourcingGrade({
      hardFail: false,
      hasRealEvidence: true,
      marketStatus: "pass",
      marginRate: 0.28,
      score: 80,
    }),
    "S",
  );

  assert.equal(
    resolveSourcingGrade({
      hardFail: false,
      hasRealEvidence: true,
      marketStatus: "pass",
      marginRate: 0.2,
      score: 65,
    }),
    "A",
  );

  assert.equal(
    resolveSourcingGrade({
      hardFail: false,
      hasRealEvidence: true,
      marketStatus: "hold",
      marginRate: 0.22,
      score: 70,
    }),
    "B",
  );

  assert.equal(
    resolveSourcingGrade({
      hardFail: false,
      hasRealEvidence: true,
      marketStatus: "pass",
      marginRate: null,
      score: 68,
    }),
    "B",
  );

  assert.equal(
    resolveSourcingGrade({
      hardFail: false,
      hasRealEvidence: true,
      marketStatus: "pending",
      marginRate: 0.15,
      score: 50,
    }),
    "HOLD",
  );
});
