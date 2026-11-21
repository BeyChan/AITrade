import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const assetDirectory = path.resolve(process.cwd(), ".data", "aitrade-assets");

export type StorageProviderKind = "local" | "s3_compatible";

export type StorageProviderInfo = {
  provider: StorageProviderKind;
  bucket: string | null;
  publicBaseUrl: string | null;
};

export interface StorageProvider {
  readonly kind: StorageProviderKind;
  put(key: string, bytes: Buffer, mimeType: string): Promise<{ storageKey: string; publicUrl?: string }>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export function getStorageProviderInfo(): StorageProviderInfo {
  const configured = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  if (configured === "s3" || configured === "r2" || configured === "oss" || configured === "s3_compatible") {
    return {
      provider: "s3_compatible",
      bucket: process.env.STORAGE_BUCKET?.trim() || null,
      publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL?.trim() || null,
    };
  }
  return {
    provider: "local",
    bucket: null,
    publicBaseUrl: null,
  };
}

export type SavedImage = {
  storageKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  publicUrl?: string;
};

export async function saveImageUpload(file: File): Promise<SavedImage> {
  if (!file || file.size <= 0) throw new Error("请选择主图文件");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("主图不能超过 8 MB");

  const bytes = Buffer.from(await file.arrayBuffer());
  const detected = detectImageType(bytes);
  if (!detected) throw new Error("仅支持真实 JPG、PNG 或 WebP 图片文件");
  if (file.type && file.type !== detected.mimeType) throw new Error("文件扩展名或类型与图片内容不一致");

  return persistImageBytes(bytes, detected, file.name || `main-image.${detected.extension}`);
}

export async function saveImageBuffer(bytes: Buffer, originalName?: string): Promise<SavedImage> {
  if (!bytes || bytes.length <= 0) throw new Error("生成图片内容为空");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("图片大小不能超过 8 MB");

  const detected = detectImageType(bytes);
  if (!detected) throw new Error("仅支持真实 JPG、PNG 或 WebP 图片格式");

  return persistImageBytes(bytes, detected, originalName?.trim() || `generated-image.${detected.extension}`);
}

async function persistImageBytes(
  bytes: Buffer,
  detected: { extension: string; mimeType: string },
  originalName: string,
): Promise<SavedImage> {
  await mkdir(assetDirectory, { recursive: true });
  const storageKey = `${randomUUID()}.${detected.extension}`;
  await writeFile(path.join(assetDirectory, storageKey), bytes, { flag: "wx" });
  const dimensions = parseImageDimensions(bytes);
  return {
    storageKey,
    originalName,
    mimeType: detected.mimeType,
    size: bytes.length,
    ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
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

export type SavedVideo = {
  storageKey: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export function resolveStoredAssetPath(storageKey: string): string {
  const safeName = path.basename(storageKey);
  if (safeName !== storageKey) throw new Error("非法资源路径");
  return path.join(assetDirectory, safeName);
}

export function detectVideoType(bytes: Buffer): { extension: string; mimeType: string } | null {
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii");
    if (brand === "qt  ") return { extension: "mov", mimeType: "video/quicktime" };
    return { extension: "mp4", mimeType: "video/mp4" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { extension: "webm", mimeType: "video/webm" };
  }
  return null;
}

export async function saveVideoBuffer(bytes: Buffer, originalName?: string): Promise<SavedVideo> {
  if (!bytes || bytes.length <= 0) throw new Error("生成视频内容为空");
  if (bytes.length > MAX_VIDEO_BYTES) throw new Error("视频大小不能超过 100 MB");

  const detected = detectVideoType(bytes) ?? { extension: "mp4", mimeType: "video/mp4" };
  await mkdir(assetDirectory, { recursive: true });
  const storageKey = `${randomUUID()}.${detected.extension}`;
  await writeFile(path.join(assetDirectory, storageKey), bytes, { flag: "wx" });
  return {
    storageKey,
    originalName: originalName?.trim() || `product-video.${detected.extension}`,
    mimeType: detected.mimeType,
    size: bytes.length,
  };
}

export function detectImageType(bytes: Buffer) {
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

/** 零依赖解析 PNG / JPEG / WebP 头部像素宽高，供图片清晰度预检使用 */
export function parseImageDimensions(bytes: Buffer): { width: number; height: number } | null {
  const detected = detectImageType(bytes);
  if (!detected) return null;

  if (detected.extension === "png") {
    if (bytes.length < 24 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (detected.extension === "jpg") {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset]!;
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (offset + 1 >= bytes.length) break;
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && segmentLength >= 7) {
        const height = bytes.readUInt16BE(offset + 3);
        const width = bytes.readUInt16BE(offset + 5);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += segmentLength;
    }
    return null;
  }

  if (detected.extension === "webp" && bytes.length >= 30) {
    const chunk = bytes.subarray(12, 16).toString("ascii");
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = bytes.readUInt16LE(26) & 0x3fff;
      const height = bytes.readUInt16LE(28) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >>> 14) & 0x3fff) + 1;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === "VP8X" && bytes.length >= 30) {
      const width = bytes.readUIntLE(24, 3) + 1;
      const height = bytes.readUIntLE(27, 3) + 1;
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }
  return null;
}
