import { isSupportedImageSlot } from "@/lib/image-skills";
import { getAssetRecord } from "@/lib/repository";
import { readStoredImage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAssetRecord(id);
  if (!asset || !isSupportedImageSlot(asset.asset_type)) {
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
    const headers: Record<string, string> = {
      "Content-Type": mimeType,
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    };
    if (download) {
      headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(originalName)}"`;
    }
    return new Response(new Uint8Array(bytes), { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
