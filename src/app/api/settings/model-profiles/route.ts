import { revalidatePath } from "next/cache";
import { ApiInputError, readJsonObject, stringField, withApiRoute } from "@/lib/api-http";
import { getAppMode } from "@/lib/app-mode";
import { recordAuditLog } from "@/lib/audit-logs";
import {
  MODEL_VENDOR_PRESETS,
  listModelProfiles,
  saveModelProfile,
  type ModelServiceType,
} from "@/lib/model-profiles";


export const GET = withApiRoute(async (request: Request) => {
  const mode = await getAppMode();
  const profiles = await listModelProfiles({ mode });
  const { searchParams } = new URL(request.url);
  if (searchParams.get("export") === "1") {
      const payload = {
        schema: "aitrade.model_profiles.v1",
        exportedAt: new Date().toISOString(),
        note: "API Key 默认脱敏未导出；导入后如目标机器未保存对应 Key，可在编辑弹窗补填。",
        profiles: profiles.map((p) => ({
          name: p.name,
          serviceType: p.serviceType,
          vendor: p.vendor,
          protocol: p.protocol,
          baseUrl: p.baseUrl,
          models: p.models,
          defaultModel: p.defaultModel,
          submitEndpoint: p.submitEndpoint,
          queryEndpoint: p.queryEndpoint,
          supportsMultiImage: p.supportsMultiImage,
          isDefault: p.isDefault,
          apiKey: "",
        })),
      };
      await recordAuditLog({
        mode,
        actor: "本机管理员",
        action: "model_profile.exported",
        entityType: "model_profile",
        entityId: "all",
        details: { count: profiles.length, format: "json" },
      }).catch(() => {});
      return new Response(JSON.stringify(payload, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="aitrade-model-profiles-${new Date().toISOString().slice(0, 10)}.json"`,
          "Cache-Control": "no-store",
        },
      });
  }
  return Response.json({ profiles, presets: MODEL_VENDOR_PRESETS });
});

export const POST = withApiRoute(async (request: Request) => {
  const mode = await getAppMode();
  const body = await readJsonObject(request);
  const action = stringField(body, "action", { maxLength: 20 });

    if (action === "import") {
      const rawItems = Array.isArray(body.profiles) ? body.profiles : [];
      if (rawItems.length === 0) {
        throw new ApiInputError("导入文件中未找到有效的模型配置列表（profiles）", 400);
      }
      const existing = await listModelProfiles({ mode });
      let imported = 0;
      const skipped: string[] = [];

      for (const raw of rawItems) {
        if (!raw || typeof raw !== "object") continue;
        const rec = raw as Record<string, unknown>;
        const rawType = String(rec.serviceType ?? rec.service_type ?? rec.type ?? "text").toLowerCase();
        const serviceType: ModelServiceType =
          rawType.includes("video")
            ? "video"
            : rawType.includes("image") || rawType.includes("img")
              ? "image"
              : "text";
        const name = String(rec.name ?? "").trim();
        const baseUrl = String(rec.baseUrl ?? rec.base_url ?? "").trim();
        const protocol = String(rec.protocol ?? rec.provider ?? rec.vendor ?? "openai-compatible").trim();
        const vendor = String(rec.vendor ?? rec.provider ?? protocol).trim();
        const defaultModel = String(rec.defaultModel ?? rec.default_model ?? rec.model ?? "").trim();
        const models = Array.isArray(rec.models)
          ? rec.models.filter((m): m is string => typeof m === "string" && Boolean(m.trim()))
          : defaultModel
            ? [defaultModel]
            : [];
        const apiKey = String(rec.apiKey ?? rec.api_key ?? "").trim();
        if (!name || !baseUrl) {
          skipped.push(name || "未命名项");
          continue;
        }
        const matched = existing.find((e) => e.serviceType === serviceType && e.name === name);
        await saveModelProfile(
          {
            id: matched?.id,
            serviceType,
            vendor,
            protocol,
            name,
            baseUrl,
            apiKey: apiKey || undefined,
            models,
            defaultModel: defaultModel || models[0] || "",
            submitEndpoint: String(rec.submitEndpoint ?? rec.submit_endpoint ?? ""),
            queryEndpoint: String(rec.queryEndpoint ?? rec.query_endpoint ?? ""),
            supportsMultiImage: Boolean(rec.supportsMultiImage ?? rec.supports_multi_image),
            isDefault: Boolean(rec.isDefault ?? rec.is_default),
            actor: "JSON 导入",
          },
          { mode },
        );
        imported += 1;
      }

      await recordAuditLog({
        mode,
        actor: "JSON 导入",
        action: "model_profile.imported",
        entityType: "model_profile",
        entityId: "batch",
        details: { imported, skipped: skipped.length },
      }).catch(() => {});

      revalidatePath("/settings");
      revalidatePath("/image-studio");
      revalidatePath("/video-studio");
      revalidatePath("/content");
      return Response.json({
        ok: true,
        imported,
        skipped: skipped.length,
        message: `成功导入 ${imported} 条模型配置${skipped.length > 0 ? `（跳过 ${skipped.length} 条不完整记录）` : ""}。`,
      });
    }

    const id = stringField(body, "id", { maxLength: 120 }) || undefined;
    const rawType = stringField(body, "serviceType", { required: true, maxLength: 20 });
    const serviceType: ModelServiceType =
      rawType === "image" || rawType === "video" ? rawType : "text";
    const vendor = stringField(body, "vendor", { required: true, maxLength: 80 });
    const protocol = stringField(body, "protocol", { required: true, maxLength: 80 });
    const name = stringField(body, "name", { required: true, maxLength: 120 });
    const baseUrl = stringField(body, "baseUrl", { maxLength: 500 });
    const apiKey = stringField(body, "apiKey", { maxLength: 500 });
    const defaultModel = stringField(body, "defaultModel", { maxLength: 160 });
    const submitEndpoint = stringField(body, "submitEndpoint", { maxLength: 300 });
    const queryEndpoint = stringField(body, "queryEndpoint", { maxLength: 300 });
    const actor = stringField(body, "actor", { maxLength: 80 }) || "本机管理员";

    const modelsRaw = Array.isArray(body.models)
      ? body.models.filter((item): item is string => typeof item === "string")
      : typeof body.modelsText === "string"
        ? body.modelsText.split(/[\n,]+/)
        : [];

    if (!name.trim()) throw new ApiInputError("请填写配置名称", 400);

    const saved = await saveModelProfile(
      {
        id,
        serviceType,
        vendor,
        protocol,
        name,
        baseUrl,
        apiKey,
        models: modelsRaw,
        defaultModel,
        submitEndpoint,
        queryEndpoint,
        supportsMultiImage: Boolean(body.supportsMultiImage),
        isDefault: Boolean(body.isDefault),
        actor,
      },
      { mode },
    );

    await recordAuditLog({
      mode,
      actor,
      action: "model_profile.saved",
      entityType: "model_profile",
      entityId: saved.id,
      details: {
        name: saved.name,
        serviceType: saved.serviceType,
        vendor: saved.vendor,
        protocol: saved.protocol,
        defaultModel: saved.defaultModel,
        isDefault: saved.isDefault,
      },
    }).catch(() => {});

    revalidatePath("/settings");
    revalidatePath("/image-studio");
    revalidatePath("/video-studio");
    revalidatePath("/content");
  return Response.json({ ok: true, profile: saved });
});
