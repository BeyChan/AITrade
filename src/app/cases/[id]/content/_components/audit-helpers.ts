export function auditLabel(action: string) {
  const labels: Record<string, string> = {
    "case.seeded": "创建演示商品",
    "case.imported": "导入候选品并生成成本模型",
    "cost_model.created": "保存新的成本模型版本",
    "case.approved": "确认商品立项",
    "case.rejected": "否决商品立项",
    "supplier.created": "创建供应商记录",
    "rfq.created": "创建询价记录",
    "quote.created": "录入供应商报价",
    "supplier.selected": "人工选定供应商并回写成本",
    "content_profile.updated": "保存商品定义",
    "asset.main_image_uploaded": "上传图片素材",
    "asset.ai_image_generated": "AI 生图生成草稿",
    "asset.main_image_reviewed": "通过图片人工检查",
    "listing.draft_saved": "保存 Listing 版本并运行预检",
    "listing.content_approved": "人工确认 Listing 内容",
    "channel.target_created": "创建渠道目标",
    "channel.listing_version_saved": "保存渠道版本并预检",
    "channel.content_approved": "人工确认渠道内容",
  };
  return labels[action] ?? action;
}

export function auditSummary(action: string, details: Record<string, unknown>) {
  if (action === "supplier.selected") return details.supplierName ? ` · ${String(details.supplierName)}` : "";
  if (action === "asset.main_image_uploaded" || action === "asset.ai_image_generated") {
    return details.originalName ? ` · ${String(details.originalName)}` : "";
  }
  if (action === "listing.draft_saved") {
    return ` · v${String(details.version ?? "—")} · 预检 ${String(details.preflightScore ?? "—")} 分`;
  }
  if (action === "listing.content_approved") return ` · v${String(details.version ?? "—")} · 未外部发布`;
  return "";
}
