import { getAISourcingBatch, recordSupplierCandidates } from "@/lib/ai-sourcing-repository";
import { apiError, readJsonObject, stringField } from "@/app/api/ai-inbox/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const runId = stringField(body, "runId", { required: true, maxLength: 120 });
    const hypothesisId = stringField(body, "hypothesisId", { required: true, maxLength: 120 });
    const query = stringField(body, "query", { required: true, maxLength: 500 });
    const actor = stringField(body, "actor", { required: true, maxLength: 80 });
    const payload = stringField(body, "payload", { required: true, maxLength: 300_000 });

    const batch = await getAISourcingBatch(runId);
    if (!batch) throw new Error("研究批次不存在或已被删除");
    if (!batch.hypotheses.some((hypothesis) => hypothesis.id === hypothesisId)) {
      throw new Error("当前机会方向不属于这个研究批次");
    }

    const outcome = await recordSupplierCandidates({
      hypothesisId,
      query,
      payload,
      actor,
    });
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
      { status: 201, headers: CORS_HEADERS },
    );
  } catch (error) {
    const response = apiError(error);
    for (const [key, value] of Object.entries(CORS_HEADERS)) response.headers.set(key, value);
    return response;
  }
}
