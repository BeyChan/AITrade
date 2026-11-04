import { getAssetRecord } from "@/lib/repository";
import { readStoredImage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAssetRecord(id);
  if (!asset || asset.asset_type !== "main_image") {
    return new Response("Not found", { status: 404 });
  }
  const storageKey = typeof asset.metadata.storageKey === "string" ? asset.metadata.storageKey : "";
  const mimeType = typeof asset.metadata.mimeType === "string" ? asset.metadata.mimeType : "application/octet-stream";
  if (!storageKey) return new Response("Not found", { status: 404 });

  try {
    const bytes = await readStoredImage(storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
