import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StudioBoundCaseRef } from "./standalone-image-studio.ts";
import type { VideoAspectRatio, VideoDurationSec, VideoTemplateId } from "./video-provider.ts";

const MAX_STANDALONE_VIDEOS = 500;
const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), ".data");
const MANIFEST_PATH = path.join(DATA_DIR, "standalone-video-studio.json");

export type StandaloneVideoAsset = {
  id: string;
  storageKey: string;
  fileUrl: string;
  originalName: string;
  mimeType: string;
  size: number;
  aspectRatio: VideoAspectRatio;
  durationSec: VideoDurationSec | number;
  templateId: VideoTemplateId | "stitched";
  provider: string;
  model: string;
  prompt: string;
  productName: string;
  actor: string;
  estimatedCostUsd: number;
  boundCases?: StudioBoundCaseRef[];
  createdAt: string;
};

let writeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  writeQueue = result.catch(() => undefined);
  return result;
}

export async function listStandaloneVideoAssets(): Promise<StandaloneVideoAsset[]> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StandaloneVideoAsset =>
        Boolean(item && typeof item === "object" && typeof (item as StandaloneVideoAsset).id === "string"),
    );
  } catch {
    return [];
  }
}

export async function getStandaloneVideoAsset(id: string): Promise<StandaloneVideoAsset | null> {
  const items = await listStandaloneVideoAssets();
  return items.find((item) => item.id === id) ?? null;
}

export async function saveStandaloneVideoAsset(record: StandaloneVideoAsset): Promise<void> {
  return serialized(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const existing = await listStandaloneVideoAssets();
    const next = [record, ...existing.filter((item) => item.id !== record.id)].slice(0, MAX_STANDALONE_VIDEOS);
    const tmp = `${MANIFEST_PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, MANIFEST_PATH);
  });
}

export async function deleteStandaloneVideoAsset(id: string): Promise<StandaloneVideoAsset | null> {
  return serialized(async () => {
    const existing = await listStandaloneVideoAssets();
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

export async function markStandaloneVideoBound(
  id: string,
  ref: { caseId: string; caseTitle: string },
): Promise<void> {
  return serialized(async () => {
    const existing = await listStandaloneVideoAssets();
    let changed = false;
    const next = existing.map((item) => {
      if (item.id !== id) return item;
      const current = Array.isArray(item.boundCases) ? item.boundCases : [];
      if (current.some((c) => c.caseId === ref.caseId)) return item;
      changed = true;
      return {
        ...item,
        boundCases: [...current, { caseId: ref.caseId, caseTitle: ref.caseTitle, boundAt: new Date().toISOString() }],
      };
    });
    if (!changed) return;
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${MANIFEST_PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, MANIFEST_PATH);
  });
}
