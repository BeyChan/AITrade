import { FxRatesManager } from "@/components/fx-rates-manager";
import { PageHeader } from "@/components/ui";
import { getAppMode } from "@/lib/app-mode";
import { getFxRatesSnapshot } from "@/lib/fx-rates";

export const dynamic = "force-dynamic";

export default async function FxRatesPage() {
  const mode = await getAppMode();
  const fxSnapshot = await getFxRatesSnapshot({ mode });

  return (
    <div className="page fx-rates-page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "实时汇率" },
        ]}
        eyebrow="汇率基准 · 实时同步与手动锁定"
        title="实时汇率管理"
        description="集中管理跨境常用币种对人民币的实时汇率与自定义锁定值；修改后会同步生效于顶栏、选品换算、成本测算与供应商报价。"
      />

      <FxRatesManager initialSnapshot={fxSnapshot} />
    </div>
  );
}
