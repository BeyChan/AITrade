import { generateCategoryRecommendations } from "@/lib/ai-provider";
import { getSiteOptions } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: { marketCode?: unknown; platformCode?: unknown };
  try {
    payload = (await request.json()) as { marketCode?: unknown; platformCode?: unknown };
  } catch {
    return Response.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  }

  const marketCode = String(payload.marketCode ?? "").trim().toUpperCase();
  const platformCode = String(payload.platformCode ?? "").trim().toLowerCase();
  if (!marketCode || !platformCode) {
    return Response.json({ error: "缺少国家或平台代码" }, { status: 400 });
  }

  try {
    const options = await getSiteOptions();
    const market = options.markets.find((item) => item.code === marketCode);
    const platform = options.platforms.find((item) => item.code === platformCode);
    if (!market) return Response.json({ error: "当前国家不可用，请刷新后重试" }, { status: 400 });
    if (!platform) return Response.json({ error: "当前平台不可用，请刷新后重试" }, { status: 400 });

    const result = await generateCategoryRecommendations({
      marketCode: market.code,
      marketName: market.name,
      platformCode: platform.code,
      platformName: platform.name,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成类目推荐失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
