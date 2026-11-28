import { getAISourcingBatch, recordSupplierCandidates } from "@/lib/ai-sourcing-repository";
import { apiError, ApiHttpError, corsHeaders, readJsonObject, stringField } from "@/lib/api-http";
import { getAppMode } from "@/lib/app-mode";


const CORS_OPTIONS = { methods: "POST, OPTIONS", maxAgeSeconds: 86400 } as const;

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request, CORS_OPTIONS) });
}

export async function POST(request: Request) {
  try {
    const mode = await getAppMode();
    const body = await readJsonObject(request);
    const runId = stringField(body, "runId", { required: true, maxLength: 120 });
    const hypothesisId = stringField(body, "hypothesisId", { required: true, maxLength: 120 });
    const query = stringField(body, "query", { required: true, maxLength: 500 });
    const actor = stringField(body, "actor", { required: true, maxLength: 80 });
    const payload = stringField(body, "payload", { required: true, maxLength: 300_000 });

    const batch = await getAISourcingBatch(runId, { mode });
    if (!batch) throw new ApiHttpError("研究批次不存在或已被删除", 404);
    if (!batch.hypotheses.some((hypothesis) => hypothesis.id === hypothesisId)) {
      throw new ApiHttpError("当前机会方向不属于这个研究批次", 400);
    }

    const outcome = await recordSupplierCandidates(
      {
        hypothesisId,
        query,
        payload,
        actor,
      },
      { mode },
    );
    const redirectUrl = `/ai-sourcing/${encodeURIComponent(runId)}?notice=${encodeURIComponent(
      outcome.newCount > 0
        ? `采集完成：新增 ${outcome.newCount} 个候选，已生成 TOP 10 待人工核验`
        : `采集完成：${outcome.parsedCount} 个候选均已存在，没有重复写入`,
    )}#hypothesis-${encodeURIComponent(hypothesisId)}`;

    return Response.json(
      {
        imported: outcome.newCount,
        parsed: outcome.parsedCount,
        duplicates: outcome.duplicateCount,
        top: outcome.topCount,
        redirectUrl,
      },
      { status: 201, headers: corsHeaders(request, CORS_OPTIONS) },
    );
  } catch (error) {
    return apiError(error, { headers: corsHeaders(request, CORS_OPTIONS) });
  }
}
