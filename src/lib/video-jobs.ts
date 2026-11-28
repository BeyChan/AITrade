import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getDb } from "./db.ts";
import { resolveStoredAssetPath } from "./storage.ts";
import type { VideoAspectRatio, VideoDurationSec, VideoProviderId, VideoTemplateId } from "./video-provider.ts";

const execFileAsync = promisify(execFile);

export type VideoJobStatus = "queued" | "running" | "succeeded" | "failed";

export type VideoGenerationJob = {
  id: string;
  case_id: string;
  source_asset_id: string;
  template_id: VideoTemplateId;
  aspect_ratio: VideoAspectRatio;
  duration_sec: VideoDurationSec;
  provider: VideoProviderId;
  model: string;
  prompt: string;
  negative_prompt: string;
  status: VideoJobStatus;
  external_task_id: string;
  poll_url: string;
  result_asset_id: string | null;
  estimated_cost_usd: number;
  error_message: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export async function createVideoJob(input: {
  caseId: string;
  sourceAssetId: string;
  templateId: VideoTemplateId;
  aspectRatio: VideoAspectRatio;
  durationSec: VideoDurationSec;
  provider: VideoProviderId;
  model: string;
  prompt: string;
  negativePrompt: string;
  status: VideoJobStatus;
  externalTaskId: string;
  pollUrl: string;
  estimatedCostUsd: number;
  actor: string;
}): Promise<VideoGenerationJob> {
  const db = await getDb();
  const id = randomUUID();
  const result = await db.query<VideoGenerationJob>(
    `INSERT INTO video_generation_jobs (
      id, case_id, source_asset_id, template_id, aspect_ratio, duration_sec,
      provider, model, prompt, negative_prompt, status, external_task_id,
      poll_url, estimated_cost_usd, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *`,
    [
      id,
      input.caseId,
      input.sourceAssetId,
      input.templateId,
      input.aspectRatio,
      input.durationSec,
      input.provider,
      input.model,
      input.prompt,
      input.negativePrompt,
      input.status,
      input.externalTaskId,
      input.pollUrl,
      input.estimatedCostUsd,
      input.actor || "本机管理员",
    ],
  );
  return normalizeJobRow(result.rows[0]!);
}

export async function getVideoJob(jobId: string): Promise<VideoGenerationJob | null> {
  const db = await getDb();
  const result = await db.query<VideoGenerationJob>(`SELECT * FROM video_generation_jobs WHERE id = $1`, [jobId]);
  const row = result.rows[0];
  return row ? normalizeJobRow(row) : null;
}

export async function listVideoJobsForCase(caseId: string): Promise<VideoGenerationJob[]> {
  const db = await getDb();
  const result = await db.query<VideoGenerationJob>(
    `SELECT * FROM video_generation_jobs WHERE case_id = $1 ORDER BY created_at DESC LIMIT 30`,
    [caseId],
  );
  return result.rows.map(normalizeJobRow);
}

export async function updateVideoJob(
  jobId: string,
  patch: {
    status: VideoJobStatus;
    resultAssetId?: string | null;
    errorMessage?: string | null;
  },
): Promise<VideoGenerationJob | null> {
  const db = await getDb();
  const result = await db.query<VideoGenerationJob>(
    `UPDATE video_generation_jobs
     SET status = $2,
         result_asset_id = COALESCE($3, result_asset_id),
         error_message = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [jobId, patch.status, patch.resultAssetId ?? null, patch.errorMessage ?? null],
  );
  const row = result.rows[0];
  return row ? normalizeJobRow(row) : null;
}

export async function deleteVideoJob(jobId: string): Promise<void> {
  const db = await getDb();
  await db.query(`DELETE FROM video_generation_jobs WHERE id = $1`, [jobId]);
}

function normalizeJobRow(row: VideoGenerationJob): VideoGenerationJob {
  return {
    ...row,
    duration_sec: Number(row.duration_sec) >= 8 ? 10 : 5,
    estimated_cost_usd: Number(row.estimated_cost_usd || 0),
    created_at: typeof row.created_at === "string" ? row.created_at : new Date(row.created_at).toISOString(),
    updated_at: typeof row.updated_at === "string" ? row.updated_at : new Date(row.updated_at).toISOString(),
  };
}

export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

export async function stitchVideoClipsWithFfmpeg(input: {
  clipStorageKeys: string[];
  aspectRatio: VideoAspectRatio;
}): Promise<Buffer> {
  if (input.clipStorageKeys.length < 2) {
    throw new Error("多镜头合成至少需要选择 2 段视频片段");
  }
  if (input.clipStorageKeys.length > 5) {
    throw new Error("单次最多合成 5 段视频片段");
  }
  if (!(await isFfmpegAvailable())) {
    throw new Error("当前环境未检测到 ffmpeg，无法本地拼接多镜头成片（macOS 可执行 brew install ffmpeg 后重试）");
  }

  const [width, height] =
    input.aspectRatio === "9:16"
      ? [720, 1280]
      : input.aspectRatio === "1:1"
        ? [960, 960]
        : [1280, 720];

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-stitch-"));
  const outPath = path.join(tmpDir, "stitched.mp4");

  try {
    const args: string[] = ["-y"];
    for (const key of input.clipStorageKeys) {
      args.push("-i", resolveStoredAssetPath(key));
    }

    const filterParts: string[] = [];
    const concatInputs: string[] = [];
    for (let i = 0; i < input.clipStorageKeys.length; i += 1) {
      filterParts.push(
        `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p,setsar=1[v${i}]`,
      );
      concatInputs.push(`[v${i}]`);
    }
    const filterComplex = `${filterParts.join(";")};${concatInputs.join("")}concat=n=${input.clipStorageKeys.length}:v=1:a=0[vout]`;

    args.push(
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "21",
      "-movflags",
      "+faststart",
      outPath,
    );

    await execFileAsync("ffmpeg", args, { timeout: 120_000 });
    return await readFile(outPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
