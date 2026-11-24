import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, QueryNotices } from "@/components/ui";
import { getAppMode } from "@/lib/app-mode";
import {
  getCostSheet,
  listConfirmedCostSheets,
  listCostSheets,
} from "@/lib/cost-sheets-repository";
import { getDb } from "@/lib/db";
import { getSiteOptions } from "@/lib/repository";
import { CostingClient, type CostFormState, type CostingCandidateContext } from "./costing-client";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    id?: string;
    hypothesisId?: string;
    market?: string;
    platform?: string;
    notice?: string;
    error?: string;
  }>;
};

function emptyForm(marketCode: string, platformCode: string, currency: string): CostFormState {
  return {
    title: "",
    productTitle: "",
    marketCode,
    platformCode,
    currency,
    salePrice: "",
    purchasePrice: "",
    freightPerUnit: "0",
    dutyRate: "0",
    fbaFee: "0",
    referralRate: "15",
    adRate: "10",
    returnRate: "5",
    returnProcessing: "0",
    returnRecoveryRate: "50",
    coupon: "0",
    storage: "0",
    otherCost: "0",
    oneTimeFixedCost: "0",
    initialOrderUnits: "500",
  };
}

function matchesCandidateScope(
  sheet: { marketCode: string; platformCode: string; currency: string },
  hypothesis: CostingCandidateContext,
) {
  return sheet.marketCode.toUpperCase() === hypothesis.marketCode.toUpperCase()
    && sheet.platformCode.toLowerCase() === hypothesis.platformCode.toLowerCase()
    && sheet.currency.toUpperCase() === hypothesis.currency.toUpperCase();
}

export default async function CostingPage({ searchParams }: PageProps) {
  const [query, appMode] = await Promise.all([searchParams, getAppMode()]);
  const demoMode = appMode === "sandbox";
  const [options, sheets, confirmedSheets, rawRequestedSheet] = await Promise.all([
    getSiteOptions(),
    listCostSheets(),
    listConfirmedCostSheets(),
    query.id ? getCostSheet(query.id) : Promise.resolve(null),
  ]);

  const hypothesisId = query.hypothesisId || rawRequestedSheet?.hypothesisId || null;
  let hypothesis: CostingCandidateContext | null = null;
  if (hypothesisId) {
    const db = await getDb();
    const result = await db.query<{
      id: string;
      concept: string;
      run_id: string;
      market_code: string;
      platform_code: string;
      currency: string;
      cost_sheet_id: string | null;
    }>(
      `SELECT h.id, h.concept, h.run_id, b.market_code, b.platform_code, b.currency,
              h.cost_sheet_id
       FROM opportunity_hypotheses h
       JOIN ai_sourcing_runs r ON r.id = h.run_id
       JOIN sourcing_briefs b ON b.id = r.brief_id
       WHERE h.id = $1`,
      [hypothesisId],
    );
    const row = result.rows[0];
    if (row) {
      hypothesis = {
        id: row.id,
        concept: row.concept,
        runId: row.run_id,
        marketCode: row.market_code,
        platformCode: row.platform_code,
        currency: row.currency,
        costSheetId: row.cost_sheet_id,
      };
    }
  }

  if (
    hypothesis
    && (
      query.market?.trim().toUpperCase() !== hypothesis.marketCode.toUpperCase()
      || query.platform?.trim().toLowerCase() !== hypothesis.platformCode.toLowerCase()
    )
  ) {
    const params = new URLSearchParams();
    if (query.id) params.set("id", query.id);
    params.set("hypothesisId", hypothesis.id);
    params.set("market", hypothesis.marketCode);
    params.set("platform", hypothesis.platformCode);
    if (query.notice) params.set("notice", query.notice);
    if (query.error) params.set("error", query.error);
    redirect(`/costing?${params.toString()}`);
  }

  const requestedSheet = rawRequestedSheet && (!hypothesis || matchesCandidateScope(rawRequestedSheet, hypothesis))
    ? rawRequestedSheet
    : null;
  const candidateScopeError = rawRequestedSheet && hypothesis && !matchesCandidateScope(rawRequestedSheet, hypothesis)
    ? "该核算单的站点、平台或币种与当前候选不一致，已停止加载。"
    : null;
  const visibleSheets = hypothesis
    ? sheets.filter((sheet) => matchesCandidateScope(sheet, hypothesis))
    : sheets;
  const visibleConfirmedSheets = hypothesis
    ? confirmedSheets.filter((sheet) => matchesCandidateScope(sheet, hypothesis))
    : confirmedSheets;

  const defaultMarket =
    options.markets.find((market) => market.code === hypothesis?.marketCode) ??
    options.markets.find((market) => market.code === requestedSheet?.marketCode) ??
    options.markets.find((market) => market.code === query.market?.trim().toUpperCase()) ??
    options.markets.find((market) => market.code === "US") ??
    options.markets[0];
  const defaultPlatform =
    options.platforms.find((platform) => platform.code === hypothesis?.platformCode) ??
    options.platforms.find((platform) => platform.code === requestedSheet?.platformCode) ??
    options.platforms.find((platform) => platform.code === query.platform?.trim().toLowerCase()) ??
    options.platforms.find((platform) => platform.code === "amazon") ??
    options.platforms[0];

  const returnSearch = hypothesis
    ? new URLSearchParams({ tab: "profit", hypothesisId: hypothesis.id }).toString()
    : "";

  return (
    <div className="page">
      <PageHeader
        backLink={hypothesis ? {
          label: "返回当前候选",
          href: `/ai-sourcing/${encodeURIComponent(hypothesis.runId)}?${returnSearch}#hypothesis-${encodeURIComponent(hypothesis.id)}`,
          meta: hypothesis.concept,
        } : undefined}
        breadcrumbs={[
          { label: "选品", href: "/ai-sourcing" },
          { label: "成本核算" },
        ]}
        eyebrow={hypothesis ? "候选证据补齐 · 18% 硬门禁" : "独立核算 · 18% 硬门禁"}
        title="成本核算"
        description={hypothesis
          ? demoMode
            ? `正在为候选「${hypothesis.concept}」核算成本。演示模式可保存后一键确认并绑定；站点、平台和币种仍按候选锁定。`
            : `正在为候选「${hypothesis.concept}」核算成本。新建或选择核算单，人工确认后绑定；完成后返回候选继续补齐选厂证据。`
          : "用可追溯的售价、采购、物流、平台费率和风险假设建立核算单。草稿可迭代；人工确认后的版本作为候选 GO 与正式立项的唯一成本依据。"}
        actions={!hypothesis ? (
          <Link href="/discover?entry=sourcing" className="button secondary">用核算单建立候选</Link>
        ) : undefined}
      />

      <QueryNotices notice={query.notice} error={candidateScopeError ?? query.error} />

      <CostingClient
        key={requestedSheet?.id ?? `new-${hypothesisId ?? "standalone"}`}
        sheet={requestedSheet}
        hypothesis={hypothesis}
        markets={options.markets}
        platforms={options.platforms}
        initialForm={emptyForm(
          hypothesis?.marketCode ?? defaultMarket?.code ?? "US",
          hypothesis?.platformCode ?? defaultPlatform?.code ?? "amazon",
          hypothesis?.currency ?? defaultMarket?.currency ?? "USD",
        )}
        sheets={visibleSheets}
        confirmedSheets={visibleConfirmedSheets}
        actor="选品负责人"
        demoMode={demoMode}
      />
    </div>
  );
}
