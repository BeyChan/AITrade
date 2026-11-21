import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_IMAGE_HOSTS = [
  /(^|\.)media-amazon\.com$/i,
  /(^|\.)ssl-images-amazon\.com$/i,
  /(^|\.)images-amazon\.com$/i,
  /(^|\.)alicdn\.com$/i,
];

function isAllowedImageUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!ALLOWED_IMAGE_HOSTS.some((re) => re.test(parsed.hostname))) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 安全下载商品主图到本地，方便直接拖入 1688 相机图标「以图搜款」 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = (searchParams.get("url") || "").trim();
  const rawName = (searchParams.get("name") || "product").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40) || "product";

  const target = isAllowedImageUrl(rawUrl);
  if (!target) {
    return NextResponse.json({ error: "不支持的图片来源域名" }, { status: 400 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: `主图拉取失败 (HTTP ${upstream.status})` }, { status: 502 });
    }
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "目标链接不是有效图片" }, { status: 400 });
    }
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const filename = rawName.endsWith(`.${ext}`) ? rawName : `${rawName}.${ext}`;
    const bytes = await upstream.arrayBuffer();

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "主图下载超时或网络不可达" }, { status: 502 });
  }
}
