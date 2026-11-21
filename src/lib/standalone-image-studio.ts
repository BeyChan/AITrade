import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageAspectRatio, ImageAssetSlot } from "./image-skills.ts";

const MAX_STANDALONE_ASSETS = 50;
const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), ".data");
const MANIFEST_PATH = path.join(DATA_DIR, "standalone-image-studio.json");

export type StandaloneStudioAsset = {
  id: string;
  storageKey: string;
  fileUrl: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  slot: ImageAssetSlot;
  aspectRatio: ImageAspectRatio;
  skillId: string;
  skillName: string;
  provider: string;
  model: string;
  prompt: string;
  negativePrompt: string;
  productName: string;
  marketplace: string;
  actor: string;
  parentAssetId?: string | null;
  createdAt: string;
};

let writeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  writeQueue = result.catch(() => undefined);
  return result;
}

export async function listStandaloneStudioAssets(): Promise<StandaloneStudioAsset[]> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StandaloneStudioAsset =>
        Boolean(item && typeof item === "object" && typeof (item as StandaloneStudioAsset).id === "string"),
    );
  } catch {
    return [];
  }
}

export async function getStandaloneStudioAsset(id: string): Promise<StandaloneStudioAsset | null> {
  const items = await listStandaloneStudioAssets();
  return items.find((item) => item.id === id) ?? null;
}

export async function saveStandaloneStudioAsset(record: StandaloneStudioAsset): Promise<void> {
  return serialized(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const existing = await listStandaloneStudioAssets();
    const next = [record, ...existing.filter((item) => item.id !== record.id)].slice(0, MAX_STANDALONE_ASSETS);
    const tmp = `${MANIFEST_PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, MANIFEST_PATH);
  });
}

export async function deleteStandaloneStudioAsset(id: string): Promise<StandaloneStudioAsset | null> {
  return serialized(async () => {
    const existing = await listStandaloneStudioAssets();
    const target = existing.find((item) => item.id === id) ?? null;
    if (!target) return null;
    const next = existing.filter((item) => item.id !== id);
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${MANIFEST_PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, MANIFEST_PATH);
    return target;
  });
}
