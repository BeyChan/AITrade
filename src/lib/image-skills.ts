import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  IMAGE_SLOT_LABELS,
  SUPPORTED_IMAGE_ASSET_TYPES,
  isSupportedImageSlot,
  normalizeAspectRatio,
  type ComposedImagePrompt,
  type ImageAspectRatio,
  type ImageAssetSlot,
  type ImagePromptContext,
  type ImageSkillDefinition,
} from "./image-skills-types.ts";

export {
  IMAGE_SLOT_LABELS,
  SUPPORTED_IMAGE_ASSET_TYPES,
  isSupportedImageSlot,
  normalizeAspectRatio,
  type ComposedImagePrompt,
  type ImageAspectRatio,
  type ImageAssetSlot,
  type ImagePromptContext,
  type ImageSkillDefinition,
};

export const BUILTIN_IMAGE_SKILLS: readonly ImageSkillDefinition[] = [
  {
    id: "amazon-main-white",
    name: "亚马逊纯白底主图",
    description: "纯白背景 RGB(255,255,255)、商品主体占比 ≥85%、棚拍柔光质感，严格去除一切文字与促销角标。",
    slot: "main_image",
    aspectRatio: "1:1",
    source: "builtin",
    bestFor: "Amazon / 平台首图合规上架",
    styleDirectives:
      "Commercial studio product photography on a seamless pure white background (#FFFFFF). Center the complete product cleanly occupying 85% of the frame, crisp natural contact shadow, softbox diffused studio lighting, sharp focus across materials and edges, true-to-life color accuracy.",
    negativeDirectives:
      "text, typography, badges, stickers, watermarks, promotional banners, price tags, brand logos not on the product, cluttered props, cropped product edges, dark or tinted background",
  },
  {
    id: "us-lifestyle-scene",
    name: "欧美生活场景图",
    description: "结合目标客群与北美/欧洲现代家居或户外实景，展示真实比例、使用状态与自然光氛围。",
    slot: "lifestyle_image",
    aspectRatio: "4:5",
    source: "builtin",
    bestFor: "副图生活代入 / 独立站主图",
    styleDirectives:
      "Authentic editorial lifestyle product photography in a warm, sunlit modern North American or European living environment matched to the target user. Show natural scale in context, shallow depth of field keeping the product crisp in foreground, clean lived-in textures without visual clutter.",
    negativeDirectives:
      "overly glossy CGI look, distorted hands or anatomy, floating objects, unreadable fake labels, promotional overlays, watermarks, exaggerated scale",
  },
  {
    id: "jp-minimal-detail",
    name: "日站极简细节图",
    description: "针对日本站点的柔和自然光与紧凑居家空间感，突出工艺材质、接口细节与精巧收纳。",
    slot: "feature_image",
    aspectRatio: "1:1",
    source: "builtin",
    bestFor: "JP 站主图/副图 · 工艺与材质特写",
    styleDirectives:
      "Japanese minimalist editorial product photography, soft morning window light, calm neutral wood and linen tones, compact tidy interior setting. Highlight fine surface texture, joints, tactile finishes, and precision engineering with restrained framing.",
    negativeDirectives:
      "neon colors, harsh flash shadows, crowded props, oversized English banners, fake certifications, low-res plastic glare",
  },
  {
    id: "painpoint-callout-base",
    name: "差评痛点反制留白底图",
    description: "针对竞品 TOP 差评痛点构图，在画幅一侧预留干净负空间，供后期人工叠加精准卖点文字，避免 AI 写错字。",
    slot: "feature_image",
    aspectRatio: "4:5",
    source: "builtin",
    bestFor: "A+ / 五点反制卖点底图（预留文字区）",
    styleDirectives:
      "Clean e-commerce infographic base photography with asymmetric composition: position the product sharply on the left or lower two-thirds while keeping at least 35% clean, smooth, uncluttered negative space on the opposite side for later typography placement. Emphasize the upgraded structural or functional feature visually.",
    negativeDirectives:
      "any rendered text, garbled letters, fake callout arrows, fake charts, percentage badges, certification seals, watermarks",
  },
  {
    id: "packaging-flatlay",
    name: "包装清单全家福",
    description: "按商品定义中的包装清单生成俯拍或 45° 规整陈列图，确保主机与配件数量清晰可核对。",
    slot: "packaging_image",
    aspectRatio: "1:1",
    source: "builtin",
    bestFor: "包装清单副图 · 减少配件误解退货",
    styleDirectives:
      "Organized 45-degree or top-down flatlay studio photography on a clean light neutral surface. Arrange the main unit alongside every included accessory neatly spaced and parallel so buyers can clearly count every item in the box.",
    negativeDirectives:
      "extra unmentioned accessories, tangled cables, text overlays, fake manual copy, overlapping hidden parts, dark muddy shadows",
  },
];

export async function listAvailableImageSkills(customDir?: string): Promise<ImageSkillDefinition[]> {
  const localSkills = await loadLocalImageSkills(customDir);
  const seen = new Set<string>(BUILTIN_IMAGE_SKILLS.map((skill) => skill.id));
  const merged: ImageSkillDefinition[] = [...BUILTIN_IMAGE_SKILLS];
  for (const skill of localSkills) {
    if (!seen.has(skill.id)) {
      seen.add(skill.id);
      merged.push(skill);
    }
  }
  return merged;
}

export async function getImageSkillById(skillId: string, customDir?: string): Promise<ImageSkillDefinition> {
  const skills = await listAvailableImageSkills(customDir);
  return skills.find((skill) => skill.id === skillId) ?? BUILTIN_IMAGE_SKILLS[0]!;
}

export function buildCustomImageSkill(input: {
  name?: string;
  slot?: string;
  aspectRatio?: string;
  styleDirectives: string;
  negativeDirectives?: string;
}): ImageSkillDefinition {
  const slot: ImageAssetSlot = input.slot && isSupportedImageSlot(input.slot) ? input.slot : "lifestyle_image";
  const aspectRatio = normalizeAspectRatio(input.aspectRatio, "1:1");
  const name = input.name?.trim() || "自定义视觉规范";
  const styleDirectives = input.styleDirectives.trim();
  if (!styleDirectives) {
    throw new Error("选择「自定义规范」时，请填写自定义风格与构图规范");
  }
  const negativeDirectives =
    input.negativeDirectives?.trim() ||
    "watermarks, garbled text, unverified certification badges, distorted product parts";

  return {
    id: "custom",
    name,
    description: "用户按本次商品拍摄与视觉需求定制的生图规范。",
    slot,
    aspectRatio,
    source: "custom",
    bestFor: "自定义风格与构图",
    styleDirectives,
    negativeDirectives,
  };
}

function resolveSkillsRoot(customDir?: string): string {
  return customDir ?? process.env.AITRADE_IMAGE_SKILLS_DIR ?? path.join(os.homedir(), ".agents", "skills");
}

function toSafeSkillSlug(displayName: string): string {
  const ascii = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  const hash = createHash("sha256").update(displayName).digest("hex").slice(0, 8);
  const hasNonAscii = /[^\x00-\x7f]/.test(displayName);
  let slug = ascii.length >= 3 && !hasNonAscii ? ascii : ascii ? `${ascii}-${hash}` : `custom-image-${hash}`;
  if (slug === "custom" || BUILTIN_IMAGE_SKILLS.some((item) => item.id === slug)) {
    slug = `custom-${slug}`.slice(0, 60);
  }
  return slug;
}

function yamlScalar(value: string): string {
  const normalized = value.replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim().replaceAll('"', '\\"');
  return `"${normalized}"`;
}

export async function saveLocalImageSkill(
  input: {
    name: string;
    description?: string;
    slot?: string;
    aspectRatio?: string;
    styleDirectives: string;
    negativeDirectives?: string;
  },
  customDir?: string,
): Promise<ImageSkillDefinition> {
  const displayName = input.name.trim().slice(0, 80);
  if (!displayName) throw new Error("请填写自定义规范名称后再保存");

  const built = buildCustomImageSkill({
    name: displayName,
    slot: input.slot,
    aspectRatio: input.aspectRatio,
    styleDirectives: input.styleDirectives,
    negativeDirectives: input.negativeDirectives,
  });

  const skillsRoot = path.resolve(/* turbopackIgnore: true */ resolveSkillsRoot(customDir));
  const slug = toSafeSkillSlug(displayName);
  const targetDir = path.join(/* turbopackIgnore: true */ skillsRoot, slug);
  const skillFile = path.join(/* turbopackIgnore: true */ targetDir, "SKILL.md");

  try {
    const existingRaw = await readFile(skillFile, "utf8");
    const existingParsed = parseLocalImageSkill(slug, existingRaw, skillFile);
    if (!existingParsed) {
      throw new Error(`目录 ${slug} 已存在且不是生图 Skill，请更换规范名称`);
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const description = input.description?.trim() || `自定义视觉规范：${displayName}（${IMAGE_SLOT_LABELS[built.slot]} · ${built.aspectRatio}）`;
  const markdown = [
    "---",
    `name: ${slug}`,
    `display_name: ${yamlScalar(displayName)}`,
    `description: ${yamlScalar(description)}`,
    "image_skill: true",
    `slot: ${built.slot}`,
    `aspect_ratio: ${built.aspectRatio}`,
    `best_for: ${yamlScalar(`自定义保存 · ${IMAGE_SLOT_LABELS[built.slot]}`)}`,
    "managed_by: aitrade",
    "---",
    "",
    `# ${displayName}`,
    "",
    "## Style Directives",
    "",
    built.styleDirectives,
    "",
    "## Negative Directives",
    "",
    built.negativeDirectives,
    "",
  ].join("\n");

  await mkdir(targetDir, { recursive: true });
  await writeFile(skillFile, markdown, "utf8");

  const parsed = parseLocalImageSkill(slug, markdown, skillFile);
  if (!parsed) throw new Error("保存自定义视觉规范失败");
  return parsed;
}

export async function deleteLocalImageSkill(skillId: string, customDir?: string): Promise<void> {
  const normalized = skillId.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized)) {
    throw new Error("非法的视觉规范标识");
  }
  if (normalized === "custom" || BUILTIN_IMAGE_SKILLS.some((item) => item.id === normalized)) {
    throw new Error("内置视觉规范不可删除");
  }

  const skillsRoot = path.resolve(/* turbopackIgnore: true */ resolveSkillsRoot(customDir));
  const targetDir = path.resolve(/* turbopackIgnore: true */ skillsRoot, normalized);
  if (path.dirname(targetDir) !== skillsRoot) {
    throw new Error("非法的视觉规范目录路径");
  }

  const skillFile = path.join(/* turbopackIgnore: true */ targetDir, "SKILL.md");
  let raw = "";
  try {
    raw = await readFile(skillFile, "utf8");
  } catch {
    throw new Error("未找到要删除的本地视觉规范");
  }

  const parsed = parseLocalImageSkill(normalized, raw, skillFile);
  if (!parsed) {
    throw new Error("只能删除带有 image_skill: true 标记的生图规范");
  }

  await rm(targetDir, { recursive: true, force: true });
}

async function loadLocalImageSkills(customDir?: string): Promise<ImageSkillDefinition[]> {
  const skillsRoot = resolveSkillsRoot(customDir);
  let entries;
  try {
    entries = await readdir(/* turbopackIgnore: true */ skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const discovered: ImageSkillDefinition[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillFile = path.join(/* turbopackIgnore: true */ skillsRoot, entry.name, "SKILL.md");
    try {
      const raw = await readFile(skillFile, "utf8");
      const parsed = parseLocalImageSkill(entry.name, raw, skillFile);
      if (parsed) discovered.push(parsed);
    } catch {
      // Ignore folders without a readable SKILL.md
    }
  }
  return discovered.sort((a, b) => a.id.localeCompare(b.id));
}

function parseLocalImageSkill(dirName: string, markdown: string, sourcePath: string): ImageSkillDefinition | null {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n([\s\S]*))?$/);
  if (!match) return null;
  const frontmatter = parseSimpleFrontmatter(match[1] ?? "");
  if (String(frontmatter.image_skill ?? "").toLowerCase() !== "true") {
    return null;
  }

  const id = (frontmatter.name || dirName).trim();
  const description = (frontmatter.description || "来自本地 ~/.agents/skills/ 的自定义电商生图 Skill").trim();
  const rawSlot = (frontmatter.slot || "").trim();
  const slot: ImageAssetSlot = isSupportedImageSlot(rawSlot) ? rawSlot : "lifestyle_image";
  const aspectRatio = normalizeAspectRatio(frontmatter.aspect_ratio, "4:5");
  const body = (match[2] ?? "").trim();

  const styleSection = extractMarkdownSection(body, /style\s*directives?|视觉规范|拍摄与构图/i);
  const negativeSection = extractMarkdownSection(body, /negative\s*directives?|禁止|红线/i);
  const styleDirectives =
    styleSection ||
    compactBodySnippet(body) ||
    "Commercial e-commerce product photography with accurate product proportions, natural studio lighting, and clean composition.";
  const negativeDirectives =
    negativeSection ||
    "watermarks, unverified certification badges, garbled text, distorted product parts";

  return {
    id,
    name: frontmatter.display_name?.trim() || `${id}（本地 Skill）`,
    description,
    slot,
    aspectRatio,
    source: "local",
    sourcePath,
    bestFor: frontmatter.best_for?.trim() || `本地 Skill · ${IMAGE_SLOT_LABELS[slot]}`,
    styleDirectives,
    negativeDirectives,
  };
}

function parseSimpleFrontmatter(raw: string): Record<string, string> {
  const lines = raw.split(/\r?\n/);
  const result: Record<string, string> = {};
  let currentKey = "";
  let multiline = false;

  for (const line of lines) {
    if (multiline && /^\s+/.test(line)) {
      result[currentKey] = `${result[currentKey] ? `${result[currentKey]} ` : ""}${line.trim()}`.trim();
      continue;
    }
    multiline = false;
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    currentKey = kv[1]!;
    const value = kv[2]!.trim();
    if (value === ">" || value === "|") {
      result[currentKey] = "";
      multiline = true;
    } else {
      result[currentKey] = value.replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

function extractMarkdownSection(body: string, headingRegex: RegExp): string {
  const lines = body.split(/\r?\n/);
  let capturing = false;
  const collected: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      if (capturing) break;
      if (headingRegex.test(heading[1]!)) {
        capturing = true;
      }
      continue;
    }
    if (capturing) collected.push(line.trim());
  }

  return collected.filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 500);
}

function compactBodySnippet(body: string): string {
  return body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
}

export function composeImagePrompt(
  skill: ImageSkillDefinition,
  context: ImagePromptContext,
): ComposedImagePrompt {
  const slot = context.slot && isSupportedImageSlot(context.slot) ? context.slot : skill.slot;
  const aspectRatio = normalizeAspectRatio(context.aspectRatio, skill.aspectRatio);
  const productName = context.productName.trim() || "Consumer product";
  const marketplace = (context.marketplace || "US").trim().toUpperCase();
  const painPoints = (context.topPainPoints ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 3);
  const claimsToAvoid = (context.claimsToAvoid ?? "").trim();

  const sections: string[] = [
    `[Skill: ${skill.name} | Slot: ${slot} | Aspect Ratio: ${aspectRatio}]`,
    skill.styleDirectives,
    `Product Subject: ${productName}.`,
  ];

  if (context.hasReferenceImage) {
    sections.push(
      "Reference Anchor Fidelity: Strictly preserve the physical shape, proportions, materials, port layout, buttons, and color from the provided reference image. Only adjust background, lighting, camera angle, and environment context without inventing unverified accessories.",
    );
  } else {
    sections.push(
      "Concept Exploration Mode (No Reference Photo): Generate a clean industrial/product concept visualization suitable for early supplier alignment; avoid fake brand marks.",
    );
  }

  if (context.specifications?.trim()) {
    sections.push(`Verified Specifications & Materials: ${context.specifications.trim()}`);
  }
  if (context.coreDifferentiator?.trim()) {
    sections.push(`Visual Differentiator to Emphasize: ${context.coreDifferentiator.trim()}`);
  }
  if (context.targetCustomer?.trim()) {
    sections.push(`Target Buyer Context (${marketplace} market): ${context.targetCustomer.trim()}`);
  }
  if (slot === "packaging_image" && context.packageContents?.trim()) {
    sections.push(`Exact Included Items to Display: ${context.packageContents.trim()}`);
  }
  if (painPoints.length > 0 && (slot === "feature_image" || slot === "lifestyle_image")) {
    sections.push(`Competitor Pain Points Visually Addressed: ${painPoints.join("; ")}`);
  }
  if (context.customInstruction?.trim()) {
    sections.push(`Additional Art Direction: ${context.customInstruction.trim()}`);
  }

  const negativeParts = [skill.negativeDirectives];
  if (claimsToAvoid) {
    negativeParts.push(`forbidden claims or badges: ${claimsToAvoid}`);
  }

  const complianceNotes: string[] = [
    context.hasReferenceImage
      ? "已绑定参考底图：要求模型锁定实物轮廓、比例与接口，避免结构变形。"
      : "未选参考底图（纯文生图概念模式）：生成图仅作概念/构图参考，不可直接充当真实大货图。",
    `已注入「${skill.name}」构图约束（目标槽位：${IMAGE_SLOT_LABELS[slot]}，比例 ${aspectRatio}）。`,
  ];
  if (claimsToAvoid) {
    complianceNotes.push(`已将商品定义中的禁用声明（${claimsToAvoid.slice(0, 60)}）自动转为画面负向约束。`);
  }
  if (painPoints.length > 0 && (slot === "feature_image" || slot === "lifestyle_image")) {
    complianceNotes.push(`已带入竞品差评痛点（${painPoints.length} 项）引导画面卖点表现。`);
  }

  return {
    skillId: skill.id,
    skillName: skill.name,
    slot,
    aspectRatio,
    prompt: sections.join("\n"),
    negativePrompt: negativeParts.filter(Boolean).join(", "),
    complianceNotes,
  };
}
