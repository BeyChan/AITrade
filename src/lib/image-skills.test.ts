import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BUILTIN_IMAGE_SKILLS,
  buildCustomImageSkill,
  composeImagePrompt,
  deleteLocalImageSkill,
  listAvailableImageSkills,
  saveLocalImageSkill,
} from "./image-skills.ts";

test("BUILTIN_IMAGE_SKILLS provides 5 cross-border studio skills", () => {
  assert.equal(BUILTIN_IMAGE_SKILLS.length, 5);
  assert.deepEqual(
    BUILTIN_IMAGE_SKILLS.map((item) => item.id),
    [
      "amazon-main-white",
      "us-lifestyle-scene",
      "jp-minimal-detail",
      "painpoint-callout-base",
      "packaging-flatlay",
    ],
  );
});

test("listAvailableImageSkills discovers local image skills and ignores non-image skills", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aitrade-img-skills-"));
  try {
    await mkdir(path.join(tempRoot, "custom-studio"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "custom-studio", "SKILL.md"),
      `---
name: custom-studio
display_name: 自定义棚拍 Skill
description: 专属产品金属质感棚拍规范
image_skill: true
slot: feature_image
aspect_ratio: 16:9
---

## Style Directives
Brushed aluminum studio lighting with subtle rim highlight.

## Negative Directives
plastic glare, fake badges
`,
      "utf8",
    );

    await mkdir(path.join(tempRoot, "unrelated-skill"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "unrelated-skill", "SKILL.md"),
      `---
name: unrelated-skill
description: Not an image skill
---
# Ignore me
`,
      "utf8",
    );

    const skills = await listAvailableImageSkills(tempRoot);
    assert.equal(skills.length, 6);
    const local = skills.find((s) => s.id === "custom-studio");
    assert.ok(local);
    assert.equal(local.source, "local");
    assert.equal(local.slot, "feature_image");
    assert.equal(local.aspectRatio, "16:9");
    assert.match(local.styleDirectives, /Brushed aluminum/);
    assert.match(local.negativeDirectives, /plastic glare/);
    assert.equal(skills.some((s) => s.id === "unrelated-skill"), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("listAvailableImageSkills falls back to builtin skills if directory is missing", async () => {
  const skills = await listAvailableImageSkills("/nonexistent/aitrade-skills-path");
  assert.equal(skills.length, BUILTIN_IMAGE_SKILLS.length);
});

test("composeImagePrompt injects reference fidelity, pain points, and claimsToAvoid guardrails", () => {
  const skill = BUILTIN_IMAGE_SKILLS.find((item) => item.id === "painpoint-callout-base")!;
  const composed = composeImagePrompt(skill, {
    productName: "Quiet Stainless Pet Fountain",
    targetCustomer: "Cat owners sensitive to motor noise",
    coreDifferentiator: "Brushless quiet pump & tool-free disassembly",
    specifications: "2.5L 304 stainless steel, 5V USB pump",
    packageContents: "Fountain body, pump, 3 filters, USB cable",
    claimsToAvoid: "FDA approved, 100% silent",
    marketplace: "US",
    topPainPoints: ["pump noise at night", "hard to clean corners"],
    hasReferenceImage: true,
    customInstruction: "Soft warm kitchen counter light",
  });

  assert.equal(composed.slot, "feature_image");
  assert.equal(composed.aspectRatio, "4:5");
  assert.match(composed.prompt, /Reference Anchor Fidelity/);
  assert.match(composed.prompt, /pump noise at night/);
  assert.match(composed.prompt, /Soft warm kitchen counter light/);
  assert.match(composed.negativePrompt, /FDA approved, 100% silent/);
  assert.equal(composed.complianceNotes.length, 4);
});

test("buildCustomImageSkill constructs a custom skill and compiles prompt cleanly", () => {
  const custom = buildCustomImageSkill({
    name: "户外露营冷色调",
    slot: "lifestyle_image",
    aspectRatio: "16:9",
    styleDirectives: "Nordic pine forest campsite at dawn, subtle mist, crisp anodized metal reflections.",
    negativeDirectives: "neon lights, plastic toy look",
  });
  assert.equal(custom.id, "custom");
  assert.equal(custom.source, "custom");
  assert.equal(custom.slot, "lifestyle_image");
  assert.equal(custom.aspectRatio, "16:9");

  const composed = composeImagePrompt(custom, {
    productName: "Titanium Camping Kettle",
    hasReferenceImage: false,
    claimsToAvoid: "unbreakable",
  });
  assert.match(composed.prompt, /户外露营冷色调/);
  assert.match(composed.prompt, /Nordic pine forest campsite/);
  assert.match(composed.negativePrompt, /neon lights, plastic toy look/);
  assert.match(composed.negativePrompt, /unbreakable/);
});

test("saveLocalImageSkill and deleteLocalImageSkill persist and remove local SKILL.md safely", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aitrade-save-skill-"));
  try {
    const saved = await saveLocalImageSkill(
      {
        name: "极简北欧厨房自然光",
        slot: "lifestyle_image",
        aspectRatio: "4:5",
        styleDirectives: "Sunlit Nordic marble kitchen counter, warm morning shadows, natural textures.",
        negativeDirectives: "watermarks, fake logos",
      },
      tempRoot,
    );

    assert.equal(saved.source, "local");
    assert.equal(saved.name, "极简北欧厨房自然光");
    assert.equal(saved.slot, "lifestyle_image");
    assert.equal(saved.aspectRatio, "4:5");

    const listed = await listAvailableImageSkills(tempRoot);
    assert.ok(listed.some((item) => item.id === saved.id && item.name === "极简北欧厨房自然光"));

    await assert.rejects(() => deleteLocalImageSkill("../escape", tempRoot));
    await assert.rejects(() => deleteLocalImageSkill("amazon-main-white", tempRoot));

    await mkdir(path.join(tempRoot, "non-image-skill"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "non-image-skill", "SKILL.md"),
      "---\nname: non-image-skill\ndescription: keep me\n---\n",
      "utf8",
    );
    await assert.rejects(() => deleteLocalImageSkill("non-image-skill", tempRoot));

    await deleteLocalImageSkill(saved.id, tempRoot);
    const afterDelete = await listAvailableImageSkills(tempRoot);
    assert.equal(afterDelete.some((item) => item.id === saved.id), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
