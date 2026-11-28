import {
  listAutoPipelineRuns,
  listPlatformConfigs,
} from "@/lib/auto-pipeline/repository";
import { getAppMode } from "@/lib/app-mode";
import { AutoPipelineHistoryClient } from "./history-client";

export const dynamic = "force-dynamic";

export default async function AutoPipelineHistoryPage(props: {
  searchParams: Promise<{ platform?: string; market?: string }>;
}) {
  const searchParams = await props.searchParams;
  const mode = await getAppMode();
  const [configs, runs] = await Promise.all([
    listPlatformConfigs(),
    listAutoPipelineRuns({ limit: 100 }, { mode }),
  ]);

  const initialPlatform = searchParams.platform?.trim().toLowerCase() || "ALL";
  const initialMarket = searchParams.market?.trim().toUpperCase() || "ALL";

  return (
    <AutoPipelineHistoryClient
      initialConfigs={configs}
      initialRuns={runs}
      initialPlatform={initialPlatform}
      initialMarket={initialMarket}
    />
  );
}
