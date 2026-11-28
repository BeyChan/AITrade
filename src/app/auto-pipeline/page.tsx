import {
  listAutoCandidates,
  listAutoPipelineRuns,
  listPlatformConfigs,
} from "@/lib/auto-pipeline/repository";
import { AutoPipelineClient } from "./auto-pipeline-client";

export const dynamic = "force-dynamic";

export default async function AutoPipelinePage(props: {
  searchParams: Promise<{ platform?: string; market?: string }>;
}) {
  const searchParams = await props.searchParams;
  const [configs, runs, candidates] = await Promise.all([
    listPlatformConfigs(),
    listAutoPipelineRuns(20),
    listAutoCandidates({ limit: 200 }),
  ]);

  const initialPlatform = (searchParams.platform || "amazon").toLowerCase();
  const initialMarket = (searchParams.market || "US").toUpperCase();

  return (
    <AutoPipelineClient
      initialConfigs={configs}
      initialRuns={runs}
      initialCandidates={candidates}
      initialPlatform={initialPlatform}
      initialMarket={initialMarket}
    />
  );
}
