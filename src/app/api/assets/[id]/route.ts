import { recordAuditLog } from "@/lib/audit-logs";
import { isSupportedImageSlot } from "@/lib/image-skills";
import { deleteAssetRecord, getAssetRecord } from "@/lib/repository";
import { deleteStoredImage, readStoredImage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAssetRecord(id);
  if (!asset || (!isSupportedImageSlot(asset.asset_type) && asset.asset_type !== "product_video")) {
    return new Response("Not found", { status: 404 });
  }
  const storageKey = typeof asset.metadata.storageKey === "string" ? asset.metadata.storageKey : "";
  const mimeType = typeof asset.metadata.mimeType === "string" ? asset.metadata.mimeType : "application/octet-stream";
  if (!storageKey) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const originalName = typeof asset.metadata.originalName === "string" && asset.metadata.originalName.trim()
    ? asset.metadata.originalName.trim().replaceAll('"', "")
    : storageKey;

  try {
    const bytes = await readStoredImage(storageKey);
    const total = bytes.length;
    const rangeHeader = request.headers.get("range");
    const baseHeaders: Record<string, string> = {
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    };
    if (download) {
      baseHeaders["Content-Disposition"] = `attachment; filename="${encodeURIComponent(originalName)}"`;
    }

    if (rangeHeader && rangeHeader.startsWith("bytes=")) {
      const [startStr, endStr] = rangeHeader.replace(/^bytes=/, "").split("-");
      const start = startStr ? Number.parseInt(startStr, 10) : 0;
      const end = endStr ? Math.min(total - 1, Number.parseInt(endStr, 10)) : total - 1;
      if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= end && end < total) {
        const chunk = bytes.subarray(start, end + 1);
        return new Response(new Uint8Array(chunk), {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Content-Length": String(chunk.length),
          },
        });
      }
    }

    return new Response(new Uint8Array(bytes), {
      headers: {
        ...baseHeaders,
        "Content-Length": String(total),
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = await deleteAssetRecord(id);
  if (!deleted) return Response.json({ error: "素材不存在" }, { status: 404 });
  const storageKey = typeof deleted.metadata?.storageKey === "string" ? deleted.metadata.storageKey : "";
  if (storageKey) {
    await deleteStoredImage(storageKey);
  }
  await recordAuditLog({
    actor: "运营人员",
    action: "asset.deleted",
    entityType: "product_case",
    entityId: deleted.case_id,
    details: {
      assetId: id,
      assetType: deleted.asset_type,
      fileName: typeof deleted.metadata?.originalName === "string" ? deleted.metadata.originalName : "",
    },
  }).catch(() => {});
  return Response.json({ ok: true, deletedId: id });
}
