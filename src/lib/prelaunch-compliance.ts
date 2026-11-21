/**
 * 立项前置合规红线与专利检索规则库（确定性规则，不依赖模型猜测）。
 */

export type ProductComplianceAttribute =
  | "battery"
  | "wireless"
  | "food_contact"
  | "children"
  | "plug_ac"
  | "liquid_cosmetic"
  | "laser_medical";

export type ComplianceAttributeOption = {
  id: ProductComplianceAttribute;
  label: string;
  hint: string;
};

export const COMPLIANCE_ATTRIBUTE_OPTIONS: ComplianceAttributeOption[] = [
  { id: "battery", label: "内置/配套锂电池", hint: "充电宝、无线吸尘器、电动宠物用品等" },
  { id: "wireless", label: "蓝牙 / Wi-Fi / 射频", hint: "App 联动、遥控、蓝牙音箱等" },
  { id: "food_contact", label: "食品/饮水直接接触", hint: "厨具、保温杯、宠物饮水机/食盆等" },
  { id: "children", label: "儿童 / 婴幼儿适用", hint: "12 岁以下玩具、母婴用品" },
  { id: "plug_ac", label: "交流电插头 / 适配器", hint: "直插墙插小家电、电源适配器" },
  { id: "liquid_cosmetic", label: "液体 / 膏体 / 接触皮肤", hint: "清洁液、精油、个护美妆" },
  { id: "laser_medical", label: "激光 / 红外 / 宣称理疗", hint: "筋膜枪、美容仪、激光逗猫笔" },
];

export type CertificationRequirement = {
  code: string;
  name: string;
  severity: "mandatory" | "recommended";
  estimatedCostUsd: number;
  leadWeeks: string;
  reason: string;
};

export type PatentSearchLink = {
  label: string;
  url: string;
  note: string;
};

export type PrelaunchComplianceAssessment = {
  marketCode: string;
  riskLevel: "low" | "medium" | "high";
  certifications: CertificationRequirement[];
  totalEstimatedCostUsd: number;
  patentLinks: PatentSearchLink[];
};

export function evaluatePrelaunchCompliance(
  marketCode: string,
  attributes: ProductComplianceAttribute[],
  productKeyword: string,
): PrelaunchComplianceAssessment {
  const code = (marketCode || "US").toUpperCase();
  const attrs = new Set(attributes);
  const certs: CertificationRequirement[] = [];

  if (attrs.has("battery")) {
    certs.push({
      code: "UN38.3 + MSDS",
      name: "航空/海运锂电池运输鉴定 + 危险品审核",
      severity: "mandatory",
      estimatedCostUsd: 450,
      leadWeeks: "1–2 周",
      reason: "Amazon FBA 危险品（Hazmat）必填，缺少 UN38.3 无法创建货件或入仓被扣。",
    });
    if (code === "US") {
      certs.push({
        code: "UL 2054 / UL 62133",
        name: "美国锂电池安全测试报告",
        severity: "mandatory",
        estimatedCostUsd: 1200,
        leadWeeks: "2–3 周",
        reason: "美站带电消费品高发审核项，需 ISO 17025 实验室出具。",
      });
    }
  }

  if (attrs.has("wireless")) {
    if (code === "US") {
      certs.push({
        code: "FCC ID",
        name: "美国联邦通信委员会射频认证",
        severity: "mandatory",
        estimatedCostUsd: 1500,
        leadWeeks: "3–4 周",
        reason: "含蓝牙/Wi-Fi 发射模块必须在包装与后台申报 FCC ID。",
      });
    } else if (code === "DE" || code === "GB") {
      certs.push({
        code: code === "GB" ? "UKCA-RED" : "CE-RED",
        name: "无线电设备指令认证",
        severity: "mandatory",
        estimatedCostUsd: 1400,
        leadWeeks: "3–4 周",
        reason: "欧盟/英国无线电合规强检。",
      });
    } else if (code === "JP") {
      certs.push({
        code: "TELEC (技适)",
        name: "日本无线电技适认证",
        severity: "mandatory",
        estimatedCostUsd: 1800,
        leadWeeks: "4–6 周",
        reason: "日本站无技适标志的无线设备属违法销售。",
      });
    }
  }

  if (attrs.has("food_contact")) {
    if (code === "US") {
      certs.push({
        code: "FDA 21 CFR",
        name: "美国食品接触材料检测",
        severity: "mandatory",
        estimatedCostUsd: 500,
        leadWeeks: "1–2 周",
        reason: "不锈钢/硅胶/塑料接触食物或饮水需留存材质合规检测报告（切忌文案写 FDA Approved）。",
      });
    } else if (code === "DE") {
      certs.push({
        code: "LFGB",
        name: "德国食品接触材料测试",
        severity: "mandatory",
        estimatedCostUsd: 650,
        leadWeeks: "2 周",
        reason: "德国站厨具/饮水类核心准入门槛。",
      });
    }
  }

  if (attrs.has("children")) {
    if (code === "US") {
      certs.push({
        code: "CPC + ASTM F963",
        name: "美国儿童产品证书与 CPSIA 铅/邻苯测试",
        severity: "mandatory",
        estimatedCostUsd: 950,
        leadWeeks: "2–3 周",
        reason: "美站儿童类目直接强制卡审，无 CPC 无法上架。",
      });
    } else if (code === "DE" || code === "GB") {
      certs.push({
        code: "EN71 + CE/UKCA",
        name: "欧英玩具安全指令测试",
        severity: "mandatory",
        estimatedCostUsd: 900,
        leadWeeks: "2–3 周",
        reason: "欧洲/英国儿童商品强制要求。",
      });
    }
  }

  if (attrs.has("plug_ac")) {
    if (code === "JP") {
      certs.push({
        code: "PSE + METI 备案",
        name: "日本电气用品安全认证与经济产业省备案",
        severity: "mandatory",
        estimatedCostUsd: 1600,
        leadWeeks: "4–5 周",
        reason: "日本站带交流插头/适配器产品强制要求。",
      });
    } else if (code === "AU") {
      certs.push({
        code: "RCM",
        name: "澳大利亚电气安全合规标志",
        severity: "mandatory",
        estimatedCostUsd: 1100,
        leadWeeks: "3 周",
        reason: "澳洲站交流电设备强制注册。",
      });
    } else if (code === "US") {
      certs.push({
        code: "UL / ETL",
        name: "北美电源适配器与整机安规认证",
        severity: "mandatory",
        estimatedCostUsd: 1200,
        leadWeeks: "3 周",
        reason: "优先要求工厂提供已过 UL 的现成电源适配器以大幅省费。",
      });
    }
  }

  if (attrs.has("liquid_cosmetic")) {
    certs.push({
      code: "SDS / COA",
      name: "化学品安全技术说明书与成分分析",
      severity: "mandatory",
      estimatedCostUsd: 350,
      leadWeeks: "1 周",
      reason: "液体/膏体入仓必查防漏测试与成分安全声明。",
    });
  }

  if (attrs.has("laser_medical")) {
    certs.push({
      code: code === "US" ? "FDA 激光/器械分级核查" : "医疗器械边界核查",
      name: "严控宣称边界（避免触发二类医疗器械下架）",
      severity: "mandatory",
      estimatedCostUsd: 600,
      leadWeeks: "1–2 周",
      reason: "Listing 与包装严禁出现 cure/treat/medical grade 等疗效词。",
    });
  }

  // 欧洲站通用刚需：EPR + 欧代
  if (code === "DE") {
    certs.push({
      code: "德国包装法 LUCID + WEEE + 欧代",
      name: "欧盟生产者责任延伸与合规负责人",
      severity: "mandatory",
      estimatedCostUsd: 420,
      leadWeeks: "1–2 周",
      reason: "德国站全品类强制登记包装法，带电品必须额外注册 WEEE。",
    });
  }

  const totalEstimatedCostUsd = certs.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
  const riskLevel: PrelaunchComplianceAssessment["riskLevel"] =
    certs.length >= 3 || totalEstimatedCostUsd >= 2000
      ? "high"
      : certs.length >= 1
        ? "medium"
        : "low";

  const q = encodeURIComponent((productKeyword || "product").trim().slice(0, 80));
  const patentLinks: PatentSearchLink[] = [
    {
      label: "Google Patents 全球外观/发明检索",
      url: `https://patents.google.com/?q=${q}`,
      note: "重点核对结构卡扣、外观轮廓与 1688 公模是否撞专利",
    },
    {
      label: "USPTO 美国商标局检索",
      url: `https://tmsearch.uspto.gov/`,
      note: "核查标题关键词与自有品牌名是否已被抢注",
    },
    {
      label: "EUIPO 欧盟外观专利库",
      url: `https://www.tmdn.org/tmdsview-web/#/dsview`,
      note: "欧洲站防外观投诉（DesignView）",
    },
  ];

  return {
    marketCode: code,
    riskLevel,
    certifications: certs,
    totalEstimatedCostUsd,
    patentLinks,
  };
}
