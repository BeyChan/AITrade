export const SUPPORTED_IMAGE_ASSET_TYPES = [
  "main_image",
  "lifestyle_image",
  "feature_image",
  "packaging_image",
  "reference_image",
] as const;

export type ImageAssetSlot = (typeof SUPPORTED_IMAGE_ASSET_TYPES)[number];
export type ImageAspectRatio = "1:1" | "4:5" | "16:9";

export const IMAGE_SLOT_LABELS: Record<ImageAssetSlot, string> = {
  main_image: "纯白底主图",
  lifestyle_image: "使用场景图",
  feature_image: "卖点/细节图",
  packaging_image: "包装全家福",
  reference_image: "实拍参考底图",
};

export type ImageSkillDefinition = {
  id: string;
  name: string;
  description: string;
  slot: ImageAssetSlot;
  aspectRatio: ImageAspectRatio;
  source: "builtin" | "local" | "custom";
  sourcePath?: string;
  bestFor: string;
  styleDirectives: string;
  negativeDirectives: string;
};

export type ImagePromptContext = {
  productName: string;
  targetCustomer?: string;
  coreDifferentiator?: string;
  specifications?: string;
  packageContents?: string;
  claimsToAvoid?: string;
  marketplace?: string;
  topPainPoints?: string[];
  hasReferenceImage: boolean;
  customInstruction?: string;
  slot?: ImageAssetSlot;
  aspectRatio?: ImageAspectRatio;
};

export type ComposedImagePrompt = {
  skillId: string;
  skillName: string;
  slot: ImageAssetSlot;
  aspectRatio: ImageAspectRatio;
  prompt: string;
  negativePrompt: string;
  complianceNotes: string[];
};

export function isSupportedImageSlot(value: string): value is ImageAssetSlot {
  return (SUPPORTED_IMAGE_ASSET_TYPES as readonly string[]).includes(value);
}

export function normalizeAspectRatio(value: string | undefined, fallback: ImageAspectRatio = "1:1"): ImageAspectRatio {
  if (value === "1:1" || value === "4:5" || value === "16:9") return value;
  return fallback;
}
