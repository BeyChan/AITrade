"use server";

import { getComparisonReports } from "./competitor-compare/storage.ts";
import { getDb } from "./db.ts";

export type SearchQuickLink = {
  label: string;
  href: string;
};

export type SearchResultItem = {
  id: string;
  type: "case" | "competitor" | "batch" | "supplier" | "command";
  typeLabel: string;
  title: string;
  subtitle: string;
  href: string;
  quickLinks?: SearchQuickLink[];
};

export type SpotlightInitialData = {
  recentCases: SearchResultItem[];
  quickCommands: SearchResultItem[];
};

type CommandDefinition = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  keywords: string[];
};

const QUICK_COMMANDS: CommandDefinition[] = [
  {
    id: "cmd-home",
    title: "工作台首页",
    subtitle: "站点时间、汇率换算、待办提醒与商品总览",
    href: "/",
    keywords: ["工作台", "首页", "总览", "home", "dashboard"],
  },
  {
    id: "cmd-discover",
    title: "3 步快速选品",
    subtitle: "输入类目或商品想法，快速生成选品立项方案",
    href: "/discover",
    keywords: ["选品", "快速选品", "选品雷达", "discover", "立项"],
  },
  {
    id: "cmd-competitors",
    title: "竞品对比研报",
    subtitle: "竞品价格分布、差评提取与 1688 同款回补",
    href: "/competitors",
    keywords: ["竞品", "研报", "价格带", "competitors", "差评"],
  },
  {
    id: "cmd-cases",
    title: "我的商品台账",
    subtitle: "查看全部候选与已立项商品的利润与进度",
    href: "/cases",
    keywords: ["商品", "案卷", "台账", "cases", "立项"],
  },
  {
    id: "cmd-studio-image",
    title: "视觉工坊 · AI 生图",
    subtitle: "白底主图、场景图、A+ 卖点图与素材入库",
    href: "/studio?tab=image",
    keywords: ["生图", "主图", "视觉", "图片", "studio", "image"],
  },
  {
    id: "cmd-studio-video",
    title: "视觉工坊 · AI 视频",
    subtitle: "图生视频（I2V）与多镜头短视频拼接",
    href: "/studio?tab=video",
    keywords: ["视频", "短视频", "video", "i2v", "视觉"],
  },
  {
    id: "cmd-sourcing",
    title: "供应商管理与 1688 寻源",
    subtitle: "工厂档案、多厂报价对比与人工定标",
    href: "/sourcing",
    keywords: ["供应商", "工厂", "1688", "寻源", "报价", "定标", "sourcing"],
  },
  {
    id: "cmd-operations",
    title: "实盘账本与 FBA 库存",
    subtitle: "Settlement V2 对账、SKU 成本映射与实盘偏差校准",
    href: "/operations",
    keywords: ["实盘", "账本", "对账", "fba", "库存", "校准", "operations", "settlement"],
  },
  {
    id: "cmd-settings-models",
    title: "大模型设置",
    subtitle: "配置文本、图片与视频模型 API 密钥与档案",
    href: "/settings?tab=models",
    keywords: ["大模型", "模型", "api", "key", "llm", "设置", "openai", "deepseek", "gemini"],
  },
  {
    id: "cmd-settings-backup",
    title: "数据与整库备份",
    subtitle: "导出脱敏业务 JSON 备份与合并恢复预检",
    href: "/settings?tab=backup",
    keywords: ["备份", "恢复", "导出", "backup", "json", "数据"],
  },
  {
    id: "cmd-fx",
    title: "实时汇率管理",
    subtitle: "查看与维护 8 种常用跨境结算汇率",
    href: "/fx-rates",
    keywords: ["汇率", "美元", "欧元", "日元", "fx", "currency"],
  },
  {
    id: "cmd-audit",
    title: "全链路操作日志",
    subtitle: "按模块与级别检索审计记录并导出 CSV",
    href: "/audit-logs",
    keywords: ["日志", "审计", "记录", "audit", "log"],
  },
];

function commandToResult(cmd: CommandDefinition): SearchResultItem {
  return {
    id: cmd.id,
    type: "command",
    typeLabel: "功能",
    title: cmd.title,
    subtitle: cmd.subtitle,
    href: cmd.href,
  };
}

export async function getSpotlightInitialData(): Promise<SpotlightInitialData> {
  const quickCommands = QUICK_COMMANDS.slice(0, 8).map(commandToResult);
  try {
    const db = await getDb();
    const casesRes = await db.query<{
      id: string;
      title: string;
      asin: string;
      category: string;
      marketplace: string;
    }>(
      `SELECT id, title, asin, category, marketplace
       FROM product_cases
       ORDER BY updated_at DESC
       LIMIT 4`,
    );

    const recentCases: SearchResultItem[] = casesRes.rows.map((c) => ({
      id: c.id,
      type: "case",
      typeLabel: "商品",
      title: c.title,
      subtitle: `${c.marketplace} · ASIN: ${c.asin} · ${c.category}`,
      href: `/cases/${c.id}`,
      quickLinks: [
        { label: "寻源", href: `/cases/${c.id}/sourcing` },
        { label: "文案", href: `/cases/${c.id}/content` },
        { label: "战报", href: `/cases/${c.id}/report` },
      ],
    }));

    return { recentCases, quickCommands };
  } catch {
    return { recentCases: [], quickCommands };
  }
}

export async function searchGlobal(rawQuery: string): Promise<SearchResultItem[]> {
  const query = rawQuery.trim();
  if (!query) return [];

  const qLower = query.toLowerCase();
  const db = await getDb();
  const pattern = `%${query}%`;

  try {
    const [casesRes, batchesRes, suppliersRes, comparisonReports] = await Promise.all([
      db.query<{ id: string; title: string; asin: string; category: string; marketplace: string }>(
        `SELECT id, title, asin, category, marketplace
         FROM product_cases
         WHERE title ILIKE $1 OR asin ILIKE $1 OR category ILIKE $1
         ORDER BY updated_at DESC
         LIMIT 6`,
        [pattern],
      ),
      db.query<{ id: string; category: string; brief: string; market_code: string; platform_code: string }>(
        `SELECT id, category, brief, market_code, platform_code
         FROM ai_sourcing_batches
         WHERE category ILIKE $1 OR brief ILIKE $1
         ORDER BY created_at DESC
         LIMIT 4`,
        [pattern],
      ).catch(() => ({ rows: [] })),
      db.query<{ id: string; name: string; category: string; contact: string }>(
        `SELECT id, name, category, contact
         FROM suppliers
         WHERE name ILIKE $1 OR category ILIKE $1 OR contact ILIKE $1
         ORDER BY name ASC
         LIMIT 5`,
        [pattern],
      ).catch(() => ({ rows: [] })),
      getComparisonReports().catch(() => []),
    ]);

    const results: SearchResultItem[] = [];

    // 1. 全站页面与快捷指令匹配
    const matchedCommands = QUICK_COMMANDS.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(qLower) ||
        cmd.subtitle.toLowerCase().includes(qLower) ||
        cmd.keywords.some((kw) => kw.toLowerCase().includes(qLower)),
    ).slice(0, 4);
    for (const cmd of matchedCommands) {
      results.push(commandToResult(cmd));
    }

    // 2. 商品案卷（附带寻源 / 文案 / 战报快捷入口）
    for (const c of casesRes.rows) {
      results.push({
        id: c.id,
        type: "case",
        typeLabel: "商品",
        title: c.title,
        subtitle: `${c.marketplace} · ASIN: ${c.asin} · ${c.category}`,
        href: `/cases/${c.id}`,
        quickLinks: [
          { label: "寻源", href: `/cases/${c.id}/sourcing` },
          { label: "文案", href: `/cases/${c.id}/content` },
          { label: "战报", href: `/cases/${c.id}/report` },
        ],
      });
    }

    // 3. 竞品对比研报
    const matchedReports = comparisonReports
      .filter((r) => {
        if (r.title.toLowerCase().includes(qLower)) return true;
        if (r.marketCode.toLowerCase().includes(qLower)) return true;
        return r.competitors.some(
          (comp) =>
            (comp.asin || "").toLowerCase().includes(qLower) ||
            (comp.title || "").toLowerCase().includes(qLower),
        );
      })
      .slice(0, 4);

    for (const report of matchedReports) {
      results.push({
        id: report.id,
        type: "competitor",
        typeLabel: "竞品研报",
        title: report.title,
        subtitle: `${report.marketCode} · ${report.competitors.length} 款竞品 · 已采实价 ${report.priceStats.verifiedSampleCount} 条`,
        href: `/competitors?id=${encodeURIComponent(report.id)}`,
      });
    }

    // 4. AI 选品批次
    for (const b of batchesRes.rows) {
      results.push({
        id: b.id,
        type: "batch",
        typeLabel: "选品批次",
        title: `${b.category} · 选品研究`,
        subtitle: `${b.market_code} / ${b.platform_code.toUpperCase()} · ${b.brief}`,
        href: `/ai-sourcing/${b.id}`,
      });
    }

    // 5. 供应商工厂（修复原 /suppliers 404 死链 -> /sourcing）
    for (const s of suppliersRes.rows) {
      results.push({
        id: s.id,
        type: "supplier",
        typeLabel: "供应商",
        title: s.name,
        subtitle: `${s.category || "未分类"} · ${s.contact || "1688 工厂库"}`,
        href: `/sourcing`,
      });
    }

    return results;
  } catch (err) {
    console.error("searchGlobal error:", err);
    return [];
  }
}
