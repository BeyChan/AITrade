import { expect, test } from "@playwright/test";

test.describe("AITrade MVP 核心闭环冒烟测试", () => {
  test("1. 无 Key 离线可用：核心页面与视觉工坊全部正常渲染", async ({ page }) => {
    test.setTimeout(120_000);
    const routes = [
      { path: "/", heading: /工作台|待办/ },
      { path: "/discover", heading: /选品/ },
      { path: "/cases", heading: /商品/ },
      { path: "/studio", heading: /视觉工坊/ },
      { path: "/sourcing", heading: /供应商/ },
      { path: "/import", heading: /导入/ },
      { path: "/settings?tab=general", heading: /常规设置/ },
      { path: "/settings?tab=models", heading: /大模型设置/ },
      { path: "/settings?tab=backup", heading: /数据与备份/ },
      { path: "/fx-rates", heading: /汇率/ },
      { path: "/audit-logs", heading: /日志|操作/ },
    ];

    for (const route of routes) {
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${route.path} 应返回 200`).toBe(200);
      await expect(page.locator("h1").first()).toContainText(route.heading);
    }
  });

  test("2. 首页立项主通道与视觉工坊导航完整保留", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("link", { name: "新建选品立项" })).toBeVisible();
    await expect(page.getByRole("link", { name: "导入竞品表" })).toBeVisible();
    await expect(page.locator("aside.sidebar").getByRole("link", { name: "视觉工坊" })).toBeVisible();
  });

  test("3. 立项战报 PDF 页面：两段式门禁、盈亏平衡 ACoS 与 18% 到岸上限清晰展示", async ({ page, request }) => {
    const optionsRes = await request.get("/api/cases/options");
    expect(optionsRes.status()).toBe(200);
    const optionsJson = (await optionsRes.json()) as {
      cases?: Array<{ id: string; asin: string }>;
      items?: Array<{ id: string; asin: string }>;
    };
    const cases = optionsJson.cases ?? optionsJson.items ?? [];
    expect(cases.length, "工作区应至少存在 1 个演示或真实案卷").toBeGreaterThan(0);

    const caseId = cases[0].id;
    const reportRes = await page.goto(`/cases/${caseId}/report`, { waitUntil: "domcontentloaded" });
    expect(reportRes?.status()).toBe(200);

    await expect(page.getByText("核心决策摘要（两段式立项门禁）")).toBeVisible();
    await expect(page.getByText("稳态净利率（18% 门禁）")).toBeVisible();
    await expect(page.getByText("盈亏平衡 ACoS（广告红线）")).toBeVisible();
    await expect(page.getByText("18% 门禁最高允许到岸成本")).toBeVisible();
  });

  test("4. 卖家精灵 CSV 原生导入与成本模型生成", async ({ request }) => {
    const csvContent = [
      "ASIN,商品标题,大类目,价格($),月销量(子体),评分数,星级,大类BSR,FBA费用($),卖家数",
      "B0E2ESMOKE1,E2E Silicone Pet Mat,Pet Supplies,$29.99,920,245,4.4,1850,$5.25,4",
    ].join("\n");

    const formData = new FormData();
    formData.set("kind", "candidates");
    formData.set("market", "US");
    formData.set("platform", "amazon");
    formData.set("csvText", csvContent);

    const res = await request.post("/api/ingestion", { multipart: { kind: "candidates", market: "US", platform: "amazon", csvText: csvContent } });
    expect(res.status()).toBe(200);
    const payload = (await res.json()) as { imported?: number; updated?: number; skipped?: number };
    expect((payload.imported ?? 0) + (payload.updated ?? 0) + (payload.skipped ?? 0)).toBeGreaterThanOrEqual(1);
  });

  test("5. 竞品采集缺失字段显性降级提示（不静默编造售价）", async ({ request }) => {
    const res = await request.post("/api/competitors/capture", {
      data: {
        marketCode: "US",
        platformCode: "amazon",
        currency: "USD",
        url: "https://www.amazon.com/dp/B0E2EMISS01",
        asin: "B0E2EMISS01",
        title: "E2E Missing Price Sample",
      },
    });
    expect(res.status()).toBe(200);
    const payload = (await res.json()) as {
      success?: boolean;
      missingPriceCount?: number;
      captureWarnings?: string[];
    };
    expect(payload.success).toBe(true);
    expect(payload.missingPriceCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(payload.captureWarnings)).toBe(true);
    expect(payload.captureWarnings?.length ?? 0).toBeGreaterThan(0);
  });

  test("6. 整库备份脱敏导出 → Dry-run 预检 → 事务安全恢复闭环", async ({ request }) => {
    const exportRes = await request.get("/api/settings/backup");
    expect(exportRes.status()).toBe(200);
    const rawText = await exportRes.text();
    expect(rawText).not.toMatch(/sk-[A-Za-z0-9]{16,}/);

    const backupJson = JSON.parse(rawText) as { schemaVersion?: number; tables?: Record<string, unknown[]> };
    expect(backupJson.schemaVersion).toBe(1);
    expect(backupJson.tables).toBeTruthy();

    const dryRunRes = await request.post("/api/settings/backup?dryRun=true", { data: backupJson });
    expect(dryRunRes.status()).toBe(200);
    const dryRunJson = (await dryRunRes.json()) as {
      ok?: boolean;
      dryRun?: boolean;
      totalRows?: number;
      containsSensitiveKeys?: boolean;
    };
    expect(dryRunJson.ok).toBe(true);
    expect(dryRunJson.dryRun).toBe(true);
    expect(dryRunJson.totalRows ?? 0).toBeGreaterThan(0);
    expect(dryRunJson.containsSensitiveKeys).toBe(false);

    const restoreRes = await request.post("/api/settings/backup", { data: backupJson });
    expect(restoreRes.status()).toBe(200);
    const restoreJson = (await restoreRes.json()) as { ok?: boolean; preRestoreSnapshot?: string | null };
    expect(restoreJson.ok).toBe(true);
    expect(restoreJson.preRestoreSnapshot).toBeTruthy();
  });
});
