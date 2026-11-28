import {
  listAutoCandidates,
  listAutoPipelineRuns,
  listPlatformConfigs,
} from "@/lib/auto-pipeline/repository";
import { listEliminatedHypotheses } from "@/lib/ai-sourcing-repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";
import { getAppMode } from "@/lib/app-mode";
import { AutoPipelineClient } from "./auto-pipeline-client";

export const dynamic = "force-dynamic";

export default async function AutoPipelinePage(props: {
  searchParams: Promise<{ platform?: string; market?: string; runId?: string; action?: string }>;
}) {
  const searchParams = await props.searchParams;
  const mode = await getAppMode();
  const scope = await resolvePersistedSiteScope(searchParams.market, searchParams.platform);
  const initialPlatform = scope.platformCode;
  const initialMarket = scope.marketCode;

  const [configs, runs, eliminatedHistory] = await Promise.all([
    listPlatformConfigs(),
    listAutoPipelineRuns({ limit: 50 }, { mode }),
    listEliminatedHypotheses(undefined, { mode }),
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
      }, { mode })
    : [];

  return (
    <AutoPipelineClient
      key={`${mode}:${initialPlatform}:${initialMarket}:${initialRunId}`}
      initialConfigs={configs}
      initialRuns={runs}
      initialCandidates={candidates}
      initialEliminatedHistory={eliminatedHistory}
      initialPlatform={initialPlatform}
      initialMarket={initialMarket}
      initialRunId={initialRunId}
      initialAction={searchParams.action}
    />
  );
}
