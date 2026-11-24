import { PageHeader, QueryNotices } from "@/components/ui";
import {
  getCostSheet,
  listConfirmedCostSheets,
  listCostSheets,
} from "@/lib/cost-sheets-repository";
import { getDb } from "@/lib/db";
import { getSiteOptions } from "@/lib/repository";
import { CostingClient, type CostFormState } from "./costing-client";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    id?: string;
    hypothesisId?: string;
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

export default async function CostingPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const [options, sheets, confirmedSheets, requestedSheet] = await Promise.all([
    getSiteOptions(),
    listCostSheets(),
    listConfirmedCostSheets(),
    query.id ? getCostSheet(query.id) : Promise.resolve(null),
  ]);

  const defaultMarket =
    options.markets.find((market) => market.code === requestedSheet?.marketCode) ??
    options.markets.find((market) => market.code === "US") ??
    options.markets[0];
  const defaultPlatform =
    options.platforms.find((platform) => platform.code === requestedSheet?.platformCode) ??
    options.platforms.find((platform) => platform.code === "amazon") ??
    options.platforms[0];

  const hypothesisId = query.hypothesisId || requestedSheet?.hypothesisId || null;
  let hypothesis: { id: string; concept: string; runId: string } | null = null;
  if (hypothesisId) {
    const db = await getDb();
    const result = await db.query<{ id: string; concept: string; run_id: string }>(
      "SELECT id, concept, run_id FROM opportunity_hypotheses WHERE id = $1",
      [hypothesisId],
    );
    const row = result.rows[0];
    if (row) hypothesis = { id: row.id, concept: row.concept, runId: row.run_id };
  }

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "选品", href: "/ai-sourcing" },
          { label: "成本核算" },
        ]}
        eyebrow="独立核算 · 18% 硬门禁"
        title="成本核算"
        description="用可追溯的售价、采购、物流、平台费率和风险假设建立核算单。草稿可迭代；人工确认后的版本作为候选 GO 与正式立项的唯一成本依据。"
        actions={<a href="/discover?entry=sourcing" className="button secondary">从已确认核算单建立候选</a>}
      />

      <QueryNotices notice={query.notice} error={query.error} />

      <CostingClient
        key={requestedSheet?.id ?? `new-${hypothesisId ?? "standalone"}`}
        sheet={requestedSheet}
        hypothesis={hypothesis}
        markets={options.markets}
        platforms={options.platforms}
        initialForm={emptyForm(
          defaultMarket?.code ?? "US",
          defaultPlatform?.code ?? "amazon",
          defaultMarket?.currency ?? "USD",
        )}
        sheets={sheets}
        confirmedSheets={confirmedSheets}
        actor="选品负责人"
      />
    </div>
  );
}
