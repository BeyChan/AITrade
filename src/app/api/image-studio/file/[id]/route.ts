import { getStandaloneStudioAsset } from "@/lib/standalone-image-studio";
import { readStoredImage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getStandaloneStudioAsset(id);
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
