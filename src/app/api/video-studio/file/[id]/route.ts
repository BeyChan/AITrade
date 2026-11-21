import { recordAuditLog } from "@/lib/audit-logs";
import { deleteStandaloneVideoAsset, getStandaloneVideoAsset } from "@/lib/standalone-video-studio";
import { deleteStoredImage, readStoredImage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getStandaloneVideoAsset(id);
  if (!asset) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const filename = (asset.originalName || asset.storageKey).replaceAll('"', "");

  try {
    const bytes = await readStoredImage(asset.storageKey);
    const total = bytes.length;
    const rangeHeader = request.headers.get("range");
    const baseHeaders: Record<string, string> = {
      "Content-Type": asset.mimeType || "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    };
    if (download) {
      baseHeaders["Content-Disposition"] = `attachment; filename="${encodeURIComponent(filename)}"`;
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
  const deleted = await deleteStandaloneVideoAsset(id);
  if (!deleted) return Response.json({ error: "视频不存在" }, { status: 404 });
  if (deleted.storageKey) {
    await deleteStoredImage(deleted.storageKey);
  }
  await recordAuditLog({
    actor: deleted.actor || "本地操作员",
    action: "video_studio.asset_deleted",
    entityType: "studio_video",
    entityId: id,
    details: { productName: deleted.productName, fileName: deleted.originalName },
  }).catch(() => {});
  return Response.json({ ok: true, deletedId: id });
}
