import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VideoAspectRatio, VideoDurationSec } from "./video-provider.ts";

export type VideoSkillDefinition = {
  id: string;
  name: string;
  description: string;
  channelHint: string;
  aspectRatio: VideoAspectRatio;
  durationSec: VideoDurationSec;
  source: "builtin" | "local";
  motionDirectives: string;
  lightingDirectives: string;
  negativeDirectives: string;
};

export const BUILTIN_VIDEO_SKILLS: readonly VideoSkillDefinition[] = [
  {
    id: "amazon-hero-orbit",
    name: "亚马逊主图质感环绕",
    description: "20° 慢速棚拍弧线运镜 + 机身轮廓高光扫掠，锁定商品几何形状防畸变，适合 Amazon 第 7 槽首镜。",
    channelHint: "Amazon / Shopify 主图视频",
    aspectRatio: "16:9",
    durationSec: 5,
    source: "builtin",
    motionDirectives:
      "Slow, ultra-smooth 20-degree commercial studio dolly arc around the product, subtle specular highlight gliding cleanly across surfaces, locked product geometry with zero morphing or drift.",
    lightingDirectives:
      "Clean commercial studio softbox key light, crisp rim light defining product edges, soft grounded tabletop shadow, true-to-life color accuracy.",
    negativeDirectives:
      "text overlay, captions, watermarks, price badges, flickering, morphing geometry, melted edges, jerky camera, extra objects",
  },
  {
    id: "macro-craft-reveal",
    name: "微距材质与工艺推镜",
    description: "极慢线性推近特写，展现不锈钢/织物/按键/接口工艺质感，强化高端品质信任感。",
    channelHint: "Amazon A+ / 详情页品质特写",
    aspectRatio: "16:9",
    durationSec: 5,
    source: "builtin",
    motionDirectives:
      "Ultra-slow steady macro push-in (12% zoom) focusing sharply on material texture, seams, finish, and tactile craftsmanship details while keeping the entire silhouette stable.",
    lightingDirectives:
      "Directional studio raking light accentuating surface texture and metallic or fabric micro-details, shallow depth of field with creamy bokeh.",
    negativeDirectives:
      "blurry textures, plastic sheen distortion, flickering reflections, on-screen text, logos, watermarks, camera shake",
  },
  {
    id: "pain-point-proof",
    name: "痛点反制动态实测",
    description: "真实居家场景中近景稳态跟拍，直观演示核心改良功能（如静音运转、防漏、易拆洗）。",
    channelHint: "Amazon 卖点演示 / 转化核心镜",
    aspectRatio: "16:9",
    durationSec: 5,
    source: "builtin",
    motionDirectives:
      "Steady medium close-up pushing gently forward, demonstrating smooth, effortless, reliable real-world operation of the product in a clean home setting with clear functional proof.",
    lightingDirectives:
      "Bright natural daylight interior, editorial commercial color grading, crisp contrast on the hero product.",
    negativeDirectives:
      "exaggerated visual effects, fake sparks, broken physics, deformed hands, text banners, watermarks, cluttered background",
  },
  {
    id: "tiktok-ugc-hook",
    name: "TikTok / Reels 竖屏种草",
    description: "9:16 竖屏前 2 秒视觉抓手 + 轻量真实手持感，适配 TikTok Shop 与社媒信息流投放。",
    channelHint: "TikTok Shop / Reels / Shorts",
    aspectRatio: "9:16",
    durationSec: 5,
    source: "builtin",
    motionDirectives:
      "Dynamic yet controlled vertical reveal tilting smoothly up to the hero product in lively lifestyle action, natural subtle handheld authenticity without shake or shape distortion.",
    lightingDirectives:
      "Vibrant warm lifestyle daylight, punchy social-commerce contrast, inviting shallow depth of field.",
    negativeDirectives:
      "subtitles, stickers, emojis, TikTok UI overlays, watermarks, shaky blur, warped product proportions",
  },
  {
    id: "unboxing-flatlay",
    name: "开箱与全家福俯拍",
    description: "顶拍缓慢拉远展现商品主体、配件清单与精致包装，降低退货预期差。",
    channelHint: "Amazon 开箱展示 / 配件说明",
    aspectRatio: "16:9",
    durationSec: 5,
    source: "builtin",
    motionDirectives:
      "Smooth top-down overhead crane pull-back revealing the hero product neatly arranged beside its included accessories and clean packaging on a minimalist desk surface.",
    lightingDirectives:
      "Even overhead diffused daylight, soft uniform shadows, crisp editorial flat-lay clarity.",
    negativeDirectives:
      "missing parts, duplicated accessories, messy table, readable random text, watermarks, warping",
  },
  {
    id: "lifestyle-ambiance",
    name: "居家氛围光影慢镜",
    description: "自然窗光缓缓流动与浅景深呼吸感，适合品牌独立站首屏与高客单溢价氛围营造。",
    channelHint: "Shopify 独立站 / 品牌形象片",
    aspectRatio: "16:9",
    durationSec: 5,
    source: "builtin",
    motionDirectives:
      "Gentle cinematic slow-motion drift across a serene sunlit living space with the hero product anchored in the foreground, subtle ambient sunlight shifting softly across the scene.",
    lightingDirectives:
      "Golden-hour window light with soft dappled shadows, warm architectural tones, filmic dynamic range.",
    negativeDirectives:
      "harsh artificial glare, fast cuts, text overlays, watermarks, flickering shadows, product shape drift",
  },
] as const;

const VIDEO_SKILLS_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), ".data", "video-skills");

export async function listAvailableVideoSkills(): Promise<VideoSkillDefinition[]> {
  const customSkills = await loadLocalVideoSkills();
  return [...BUILTIN_VIDEO_SKILLS, ...customSkills];
}

export async function getVideoSkillById(id: string | undefined): Promise<VideoSkillDefinition> {
  const all = await listAvailableVideoSkills();
  return all.find((item) => item.id === id) ?? BUILTIN_VIDEO_SKILLS[0]!;
}

export async function saveLocalVideoSkill(input: {
  name: string;
  description?: string;
  channelHint?: string;
  aspectRatio: VideoAspectRatio;
  durationSec: VideoDurationSec;
  motionDirectives: string;
  lightingDirectives?: string;
  negativeDirectives?: string;
}): Promise<VideoSkillDefinition> {
  const displayName = input.name.trim();
  if (!displayName) throw new Error("请填写自定义视频 Skill 名称");
  const motion = input.motionDirectives.trim();
  if (!motion) throw new Error("请填写运镜与动作规范（Motion Directives）");

  const slug = toSafeSlug(displayName);
  const targetDir = path.join(VIDEO_SKILLS_DIR, slug);
  await mkdir(targetDir, { recursive: true });

  const skill: VideoSkillDefinition = {
    id: `local-${slug}`,
    name: displayName.slice(0, 80),
    description: (input.description?.trim() || "用户自定义电商视频运镜与光影规范").slice(0, 200),
    channelHint: (input.channelHint?.trim() || "自定义视频渠道").slice(0, 60),
    aspectRatio: input.aspectRatio,
    durationSec: input.durationSec,
    source: "local",
    motionDirectives: motion.slice(0, 1500),
    lightingDirectives: (input.lightingDirectives?.trim() || "Clean commercial daylight lighting, accurate product colors.").slice(0, 800),
    negativeDirectives: (input.negativeDirectives?.trim() || "text overlay, watermarks, flickering, morphing product shape").slice(0, 800),
  };

  const md = [
    "---",
    `id: ${skill.id}`,
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `channelHint: ${skill.channelHint}`,
    `aspectRatio: ${skill.aspectRatio}`,
    `durationSec: ${skill.durationSec}`,
    "---",
    "",
    "## Motion Directives",
    skill.motionDirectives,
    "",
    "## Lighting Directives",
    skill.lightingDirectives,
    "",
    "## Negative Directives",
    skill.negativeDirectives,
    "",
  ].join("\n");

  await writeFile(path.join(targetDir, "SKILL.md"), md, "utf8");
  return skill;
}

export async function deleteLocalVideoSkill(id: string): Promise<void> {
  if (!id.startsWith("local-")) {
    throw new Error("内置视频 Skill 不可删除");
  }
  const slug = id.replace(/^local-/, "").replace(/[^a-z0-9-]/gi, "");
  if (!slug) throw new Error("无效的视频 Skill ID");
  const targetDir = path.join(VIDEO_SKILLS_DIR, slug);
  await rm(targetDir, { recursive: true, force: true });
}

async function loadLocalVideoSkills(): Promise<VideoSkillDefinition[]> {
  let entries;
  try {
    entries = await readdir(VIDEO_SKILLS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: VideoSkillDefinition[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const content = await readFile(path.join(VIDEO_SKILLS_DIR, entry.name, "SKILL.md"), "utf8");
      const parsed = parseVideoSkillMd(entry.name, content);
      if (parsed) skills.push(parsed);
    } catch {
      // skip malformed folder
    }
  }
  return skills;
}

function parseVideoSkillMd(slug: string, raw: string): VideoSkillDefinition | null {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  const meta: Record<string, string> = {};
  if (fmMatch?.[1]) {
    for (const line of fmMatch[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
  }
  const section = (heading: string) => {
    const regex = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
    return raw.match(regex)?.[1]?.trim() || "";
  };
  const motionDirectives = section("Motion Directives");
  if (!motionDirectives) return null;

  const rawRatio = meta.aspectRatio;
  const aspectRatio: VideoAspectRatio = rawRatio === "9:16" || rawRatio === "1:1" ? rawRatio : "16:9";
  const durationSec: VideoDurationSec = Number(meta.durationSec) >= 8 ? 10 : 5;

  return {
    id: meta.id || `local-${slug}`,
    name: meta.name || slug,
    description: meta.description || "自定义视频规范",
    channelHint: meta.channelHint || "自定义渠道",
    aspectRatio,
    durationSec,
    source: "local",
    motionDirectives,
    lightingDirectives: section("Lighting Directives") || "Clean commercial lighting.",
    negativeDirectives: section("Negative Directives") || "text overlay, watermarks, morphing",
  };
}

function toSafeSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const hash = createHash("sha1").update(name).digest("hex").slice(0, 6);
  return ascii ? `${ascii}-${hash}` : `skill-${hash}`;
}
