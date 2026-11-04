import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const assetDirectory = path.resolve(process.cwd(), ".data", "aitrade-assets");

export type SavedImage = {
  storageKey: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export async function saveImageUpload(file: File): Promise<SavedImage> {
  if (!file || file.size <= 0) throw new Error("请选择主图文件");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("主图不能超过 8 MB");

  const bytes = Buffer.from(await file.arrayBuffer());
  const detected = detectImageType(bytes);
  if (!detected) throw new Error("仅支持真实 JPG、PNG 或 WebP 图片文件");
  if (file.type && file.type !== detected.mimeType) throw new Error("文件扩展名或类型与图片内容不一致");

  await mkdir(assetDirectory, { recursive: true });
  const storageKey = `${randomUUID()}.${detected.extension}`;
  await writeFile(path.join(assetDirectory, storageKey), bytes, { flag: "wx" });
  return {
    storageKey,
    originalName: file.name || `main-image.${detected.extension}`,
    mimeType: detected.mimeType,
    size: bytes.length,
  };
}

export async function readStoredImage(storageKey: string) {
  const safeName = path.basename(storageKey);
  if (safeName !== storageKey) throw new Error("非法资源路径");
  return readFile(path.join(assetDirectory, safeName));
}

export async function deleteStoredImage(storageKey: string) {
  const safeName = path.basename(storageKey);
  if (safeName !== storageKey) return;
  await unlink(path.join(assetDirectory, safeName)).catch(() => undefined);
}

function detectImageType(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: "webp", mimeType: "image/webp" };
  }
  return null;
}
