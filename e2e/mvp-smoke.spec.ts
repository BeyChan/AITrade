import { expect, test } from "@playwright/test";

test.describe("AITrade MVP 核心闭环冒烟测试", () => {
  test("1. 无 Key 离线可用：核心页面与视觉工坊全部正常渲染", async ({ page }) => {
    test.setTimeout(120_000);
    const routes = [
      { path: "/", heading: /工作台|待办/ },
      { path: "/auto-pipeline", heading: /选品初筛/ },
      { path: "/ai-sourcing", heading: /选品看板/ },
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
    expect(backupJson.schemaVersion).toBe(3);
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

  test("7. 选品初筛 → 采纳入选品看板 → 淘汰入统一避坑库闭环", async ({ page, request }) => {
    // Next.js 开发模式首次编译该路由可能超过默认 45 秒；提高本用例上限，但保留全部断言。
    test.setTimeout(120_000);

    // 1. 侧边栏精简校验：无独立「新建选品」二级菜单，含「选品初筛」与「选品看板」
    await page.goto("/auto-pipeline", { waitUntil: "domcontentloaded" });
    const sidebar = page.locator("aside.sidebar");
    await expect(sidebar.getByRole("link", { name: "选品初筛" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "选品看板" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "新建选品" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "上传 CSV 快筛" })).toBeVisible();

    // 2. 通过 CSV 跑批入池 → 采纳进推进看板 → 淘汰入统一避坑库
    const csv = [
      "ASIN,Title,Brand,Category,Price,MonthlySales,Reviews,Rating",
      "B0E2EPOOL1,E2E Folding Camp Kettle,CampPro,Outdoors,39.99,700,65,4.5",
      "B0E2EPOOL2,E2E Patented Pet Bowl,BigBrand,Pet Supplies,44.99,500,80,4.2",
    ].join("\n");
    const runRes = await request.post("/api/auto-pipeline", {
      data: { platformCode: "amazon", marketCode: "US", sourceType: "csv", sourceLabel: "e2e-pool.csv", csv },
    });
    expect(runRes.status()).toBe(200);
    const runJson = (await runRes.json()) as { candidates?: Array<{ id: string; externalId: string }> };
    const c1 = runJson.candidates?.find((c) => c.externalId === "B0E2EPOOL1");
    const c2 = runJson.candidates?.find((c) => c.externalId === "B0E2EPOOL2");
    expect(c1?.id).toBeTruthy();
    expect(c2?.id).toBeTruthy();

    const adoptRes = await request.post("/api/auto-pipeline/candidates/adopt", {
      data: { candidateIds: [c1!.id] },
    });
    expect(adoptRes.status()).toBe(200);
    const adoptJson = (await adoptRes.json()) as { ok?: boolean; adoptedCount?: number; reusedCount?: number };
    expect(adoptJson.ok).toBe(true);
    expect((adoptJson.adoptedCount ?? 0) + (adoptJson.reusedCount ?? 0)).toBe(1);

    const elimRes = await request.post("/api/auto-pipeline/candidates/eliminate", {
      data: { candidateIds: [c2!.id], reason: "专利/品牌垄断", note: "E2E 验证避坑闭环" },
    });
    expect(elimRes.status()).toBe(200);
    const elimJson = (await elimRes.json()) as { ok?: boolean; eliminatedCount?: number };
    expect(elimJson.ok).toBe(true);
    expect(elimJson.eliminatedCount).toBe(1);
  });
});
