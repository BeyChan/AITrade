import test from "node:test";
import assert from "node:assert/strict";
import { calculateEconomics } from "./economics.ts";
import {
  evaluateFlatFileExportGate,
  evaluateMediaPackExportGate,
} from "./export-gates.ts";
import { assertSourcingGateAllowed } from "./repo/sourcing.ts";
import { buildWorkContextCaseItem, filterCasesForWorkContextScope } from "./work-context.ts";
import type { CostModelRow, EnrichedCase, ProductCaseRow } from "./types.ts";

function makeCase(overrides: Partial<ProductCaseRow> = {}): ProductCaseRow {
  return {
    id: "case-1",
    asin: "B0TEST0001",
    marketplace: "US",
    category: "家居",
    title: "测试商品",
    url: null,
    status: "approved",
    competitor_price_cents: 3999,
    monthly_sales_estimate: 1200,
    review_count: 300,
    rating: 4.4,
    notes: "",
    owner: "运营",
    evidence_score: 70,
    is_demo: false,
    source_code: "manual",
    source_record_id: null,
    source_observed_at: null,
    currency: "USD",
    monthly_sales_min: null,
    monthly_sales_max: null,
    bsr: null,
    keyword: null,
    keyword_search_volume: null,
    seller_count: null,
    variation_count: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCostModel(salePriceCents: number, landedCostCents: number): CostModelRow {
  const assumptions = {
    currency: "USD",
    salePriceCents,
    landedCostCents,
    fbaFeeCents: 500,
    referralRate: 0.15,
    adRate: 0.12,
    returnRate: 0.05,
    returnProcessingCents: 300,
    returnRecoveryRate: 0.3,
    couponCents: 0,
    storageCents: 45,
    otherCostCents: 50,
  };
  return {
    id: "cm-1",
    case_id: "case-1",
    version: 1,
    assumptions,
    results: calculateEconomics(assumptions),
    created_by: "test",
    created_at: new Date().toISOString(),
  };
}

test("导出门禁：未终审时 Flat File 与素材包均返回 409", () => {
  const flatDraft = evaluateFlatFileExportGate({
    caseStatus: "approved",
    hasSelection: true,
    hasListing: true,
    listingStatus: "draft",
  });
  assert.equal(flatDraft.allowed, false);
  if (!flatDraft.allowed) {
    assert.equal(flatDraft.status, 409);
    assert.equal(flatDraft.error, "内容尚未通过人工终审，当前不能导出正式交付包");
  }

  const flatPublished = evaluateFlatFileExportGate({
    caseStatus: "approved",
    hasSelection: true,
    hasListing: true,
    listingStatus: "published",
  });
  assert.equal(flatPublished.allowed, true);

  const packNoMedia = evaluateMediaPackExportGate({
    caseStatus: "approved",
    hasSelection: true,
    hasListing: true,
    listingStatus: "content_approved",
    approvedMainImageCount: 0,
    boundMediaCount: 0,
  });
  assert.equal(packNoMedia.allowed, false);
  if (!packNoMedia.allowed) assert.equal(packNoMedia.status, 409);

  const packOk = evaluateMediaPackExportGate({
    caseStatus: "approved",
    hasSelection: true,
    hasListing: true,
    listingStatus: "content_approved",
    approvedMainImageCount: 1,
    boundMediaCount: 0,
  });
  assert.equal(packOk.allowed, true);
});

test("询价与定标门禁：NO-GO 拦截，NO-GO 例外通过放行，HOLD 允许继续询价", () => {
  const nogoCost = makeCostModel(2000, 1400);
  const pendingCase = makeCase({ status: "review_pending" });

  assert.throws(
    () =>
      assertSourcingGateAllowed({
        productCase: pendingCase,
        costModel: nogoCost,
        hasNoGoException: false,
        action: "quote",
      }),
    /NO-GO/,
  );

  assert.doesNotThrow(() =>
    assertSourcingGateAllowed({
      productCase: pendingCase,
      costModel: nogoCost,
      hasNoGoException: true,
      action: "quote",
    }),
  );

  const goodCost = makeCostModel(4500, 700);
  assert.doesNotThrow(() =>
    assertSourcingGateAllowed({
      productCase: pendingCase,
      costModel: goodCost,
      hasNoGoException: false,
      action: "select",
    }),
  );
});

test("顶部对象条站点隔离：AU 站点不混入 US 案卷，且阶段统一走 deriveCaseWorkflowSnapshot", () => {
  const usCase: EnrichedCase = {
    ...makeCase({ id: "us-1", marketplace: "US", title: "美站宠物饮水器" }),
    costModel: makeCostModel(3999, 800),
    opportunityScore: 78,
    recommendation: "GO",
    quoteCount: 2,
    hasSupplierSelection: false,
    hasApprovedContent: false,
  };
  const auCase: EnrichedCase = {
    ...makeCase({ id: "au-1", marketplace: "AU", title: "澳站除臭猫砂盆" }),
    costModel: makeCostModel(5999, 1200),
    opportunityScore: 75,
    recommendation: "GO",
    quoteCount: 0,
    hasSupplierSelection: false,
    hasApprovedContent: false,
  };

  const auOnly = filterCasesForWorkContextScope([usCase, auCase], {
    marketCode: "AU",
    platformCode: "amazon",
    mode: "sandbox",
  });
  assert.equal(auOnly.length, 1);
  assert.equal(auOnly[0].id, "au-1");

  const usItem = buildWorkContextCaseItem(usCase);
  assert.match(usItem.stage, /人工定标/);
  assert.equal(usItem.nextLabel, "对比并定标");
});
