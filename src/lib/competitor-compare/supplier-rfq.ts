import { generateStructuredJSON } from "../ai-provider.ts";
import { loadAIProviderConfig } from "../app-settings.ts";
import type { CompetitorComparisonReport } from "./types.ts";

export type SupplierRfqDraft = {
  productName: string; // 询价品名
  targetPriceRmb: number; // 目标采购单价 (元)
  suggestedMoq: string; // 首单建议 MOQ (如 "首批试单 500-1000 套")
  specificationRequirements: string[]; // 核心规格与配件配置
  criticalImprovements: Array<{
    component: string; // 改良部件 (如 "折叠转轴机构", "拖布背胶")
    painPointTargeted: string; // 对应的买家差评痛点
    manufacturingStandard: string; // 工业制造与材质工艺要求
  }>;
  qualityStandard: string[]; // 验货与打样测试标准 (如电商跌落、疲劳测试)
  formattedText: string; // 可直接复制粘贴到 1688 旺旺的专业询价话术
};

export async function generateSupplierRfqFromCompetitors(
  report: CompetitorComparisonReport,
): Promise<SupplierRfqDraft> {
  const brand = report.competitors[0]?.brand || "海外标杆";
  const category = report.hypothesisBridge?.category || report.title;
  const weaknesses = report.summary.commonWeaknesses;
  const attackVector = report.summary.attackVector;
  const targetCostRmb = Number(((report.sourcingAction.suggestedCostCents || 2800) / 100).toFixed(2));
  const conceptName = report.hypothesisBridge?.concept || `${category} (跨境改良升级款)`;

  const config = await loadAIProviderConfig();

  if (config.provider !== "template") {
    try {
      const systemPrompt = `你是一位有10年跨境电商供应链采购经验的供应链专家与工业品工程师。
请基于用户提供的【竞品对比差评痛点】与【目标采购成本】，生成一份向 1688 工厂发起的专业定制改良询价单 (RFQ)。
核心原则：
1. 将海外买家对竞品的感性吐槽，专业转化为工厂生产听得懂的【材质、模具、公差、表面工艺与测试标准】。
2. 语言必须具备专业采购水准，让工厂一眼看出是懂行的大买家，避免工厂虚报高价或使用劣质回收塑料。
3. 生成格式整洁、可直接复制到 1688 阿里旺旺的专业沟通话术。

只输出合法 JSON，格式如下：
{
  "productName": "专业采购品名",
  "targetPriceRmb": 28.5,
  "suggestedMoq": "首批试单 500-1000 套，后续月翻单 2000-5000 套",
  "specificationRequirements": ["规格配置要求1", "配置2"],
  "criticalImprovements": [
    {
      "component": "改良部件名称 (如：主轴受力关节)",
      "painPointTargeted": "对应的海外买家高频差评痛点 (如：长期推拉反复受力易断裂)",
      "manufacturingStandard": "给工厂的工业制造要求 (如：要求将普通回收PP改为PA66加纤或加厚不锈钢轴销，抗剪切力强度需达XX)"
    }
  ],
  "qualityStandard": ["打样与验货标准1", "标准2"],
  "formattedText": "直接可发给工厂旺旺的完整问询话术"
}`;

      const aiResponse = await generateStructuredJSON({
        systemPrompt,
        userPrompt: JSON.stringify({
          category,
          conceptName,
          weaknessesToAddress: weaknesses,
          attackVector,
          targetPriceRmb: targetCostRmb,
          marketCode: report.marketCode,
        }),
        timeoutMs: 30_000,
        maxTokens: 3_000,
      });

      const parsed = JSON.parse(aiResponse.content) as SupplierRfqDraft;
      if (parsed.productName && Array.isArray(parsed.criticalImprovements) && parsed.criticalImprovements.length > 0) {
        return parsed;
      }
    } catch (err) {
      console.warn("AI 生成 1688 RFQ 失败，回退到高精度工程模板:", err);
    }
  }

  // 确定性高质量工业询价模板（免 Key / 回退保底）
  const improvements: SupplierRfqDraft["criticalImprovements"] = weaknesses.map((w, idx) => {
    if (/断|轴|松|破|卡扣|关节|塑料/i.test(w)) {
      return {
        component: "主受力关节 / 连接传动结构",
        painPointTargeted: w,
        manufacturingStandard: "严禁使用回收二手塑料；主受力铰链建议升级为 PA66 尼龙加纤 30% 或内嵌 1.2mm 加厚不锈钢销钉，确保 30,000 次疲劳往复推拉无变形与旷量。",
      };
    }
    if (/洗|布|脱|胶|水|粘/i.test(w)) {
      return {
        component: "易损件接触面 / 粘贴锁扣工艺",
        painPointTargeted: w,
        manufacturingStandard: "底板与功能件连接需采用耐水解超声波高频热熔焊接或机械倒扣固定，严禁普通胶水贴合，防止泡水后受潮脱落。",
      };
    }
    return {
      component: `核心功能部件 (工程项 ${idx + 1})`,
      painPointTargeted: w,
      manufacturingStandard: "加强配合公差精度（控制在 ±0.05mm 内），活动导轨做圆角去毛刺处理，确保装配顺滑度且长途海运无散架风险。",
    };
  });

  if (improvements.length === 0) {
    improvements.push({
      component: "整体结构件与受力点",
      painPointTargeted: "常规公模塑料件强度不足与毛刺缺陷",
      manufacturingStandard: "采用新料注塑，关键受力部位加强筋加固，表面做哑光防刮细砂纹处理。",
    });
  }

  const specs = [
    "包装标准：加厚 5 层瓦楞电商独立防摔纸盒（通过 1A 单跌落测试）",
    "配件清单：主体主机 + 标配 3 套可水洗替换耗材配件 + 英文说明书",
    "外贸认证要求：符合跨境合规基础（如 CE / RoHS / 环保材质检测证明）",
  ];

  const qualityStandards = [
    "首样要求：打样后寄送实物样品进行实测负荷检验",
    "大货公差：关键卡位配合公差控制在 ±0.05mm 以内",
    "疲劳寿命：推拉/震动疲劳测试合格后方可放行出厂",
  ];

  const formattedLines = [
    `【1688 跨境电商定制改良采购问询单】`,
    `老板您好！我们是专注海外（${report.marketCode} 站点）的跨境品牌卖家，正在寻找优质源头实力工厂长期合作。`,
    ``,
    `【询价品类】：${conceptName}`,
    `【目标采购单价】：¥${targetCostRmb.toFixed(2)} / 套（含税出厂价）`,
    `【首单试单量】：首批 500～1000 套，质检合格后每月稳定翻单 2000～5000 套`,
    ``,
    `【核心定制改良要求（针对海外竞品高频售后差评特别指定）】：`,
    ...improvements.map((imp, i) => `${i + 1}. 【${imp.component}】：针对海外竞品“${imp.painPointTargeted}”的严重问题，要求：${imp.manufacturingStandard}`),
    ``,
    `【包装与品控】：`,
    ...specs.map((s) => `• ${s}`),
    ``,
    `请问贵厂是否有类似私模或支持加固改良的公模？方便的话发一下贵厂现有类似爆款的画册、报价梯队及打样周期，非常感谢！`,
  ];

  return {
    productName: conceptName,
    targetPriceRmb: targetCostRmb,
    suggestedMoq: "首批试单 500-1000 套（后续月返单 2000-5000 套）",
    specificationRequirements: specs,
    criticalImprovements: improvements,
    qualityStandard: qualityStandards,
    formattedText: formattedLines.join("\n"),
  };
}
