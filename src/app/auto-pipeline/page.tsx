import {
  listAutoCandidates,
  listAutoPipelineRuns,
  listPlatformConfigs,
} from "@/lib/auto-pipeline/repository";
import { AutoPipelineClient } from "./auto-pipeline-client";

export const dynamic = "force-dynamic";

export default async function AutoPipelinePage(props: {
  searchParams: Promise<{ platform?: string; market?: string; runId?: string }>;
}) {
  const searchParams = await props.searchParams;
  const initialPlatform = (searchParams.platform || "amazon").toLowerCase();
  const initialMarket = (searchParams.market || "US").toUpperCase();

  const [configs, runs] = await Promise.all([
    listPlatformConfigs(),
    listAutoPipelineRuns({ limit: 50 }),
  ]);

  const platformRuns = runs.filter(
    (r) => r.platformCode === initialPlatform && r.marketCode === initialMarket,
  );
  const requestedRunId = searchParams.runId?.trim();
  const initialRunId =
    requestedRunId && runs.some((r) => r.id === requestedRunId)
      ? requestedRunId
      : (platformRuns[0]?.id ?? "");

  const candidates = initialRunId
    ? await listAutoCandidates({
        platformCode: initialPlatform,
        marketCode: initialMarket,
        runId: initialRunId,
        limit: 500,
      })
    : [];

  return (
    <AutoPipelineClient
      initialConfigs={configs}
      initialRuns={runs}
      initialCandidates={candidates}
      initialPlatform={initialPlatform}
      initialMarket={initialMarket}
      initialRunId={initialRunId}
    />
  );
}
