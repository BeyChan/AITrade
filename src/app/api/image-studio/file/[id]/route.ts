import { recordAuditLog } from "@/lib/audit-logs";
import { getAppMode } from "@/lib/app-mode";
import { deleteStandaloneStudioAsset, getStandaloneStudioAsset } from "@/lib/standalone-image-studio";
import { deleteStoredImage, readStoredImage } from "@/lib/storage";


export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mode = await getAppMode();
  const asset = await getStandaloneStudioAsset(id, { mode });
  if (!asset) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const filename = (asset.originalName || asset.storageKey).replaceAll('"', "");

  try {
    const bytes = await readStoredImage(asset.storageKey);
    const headers: Record<string, string> = {
      "Content-Type": asset.mimeType || "image/png",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    };
    if (download) {
      headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(filename)}"`;
    }
    return new Response(new Uint8Array(bytes), { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mode = await getAppMode();
  const deleted = await deleteStandaloneStudioAsset(id, { mode });
  if (!deleted) return Response.json({ error: "图片不存在" }, { status: 404 });
  if (deleted.storageKey) {
    await deleteStoredImage(deleted.storageKey);
  }
  await recordAuditLog({
    mode,
    actor: deleted.actor || "本地操作员",
    action: "image_studio.asset_deleted",
    entityType: "studio_image",
    entityId: id,
    details: { productName: deleted.productName, fileName: deleted.originalName },
  }).catch(() => {});
  return Response.json({ ok: true, deletedId: id });
}
