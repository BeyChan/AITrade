"use client";

import { useState } from "react";

type ExtractedFields = {
  supplierName?: string;
  supplierPlatform?: string;
  supplierUrl?: string;
  contact?: string;
  country?: string;
  unitPrice?: string;
  freightPerUnit?: string;
  dutyRate?: string;
  moq?: string;
  leadTimeDays?: string;
  sampleFee?: string;
  incoterm?: string;
  paymentTerms?: string;
  certifications?: string;
  supplierNotes?: string;
};

/**
 * 确定性规则与自然语言快速抽取（无需离开当前页，0 延迟）
 */
function extractFromText(raw: string): { fields: ExtractedFields; count: number } {
  const fields: ExtractedFields = {};
  let count = 0;

  // 1. URL 网址（1688 / 独立站）
  const urlMatch = raw.match(/https?:\/\/[^\s，,;；]+/i);
  if (urlMatch) {
    fields.supplierUrl = urlMatch[0];
    count++;
    if (urlMatch[0].includes("1688.com")) {
      fields.supplierPlatform = "1688";
    } else if (urlMatch[0].includes("alibaba.com")) {
      fields.supplierPlatform = "Alibaba";
    }
  }

  // 2. 供应商名称
  const supplierMatch = raw.match(/(?:供应商|工厂|厂家|公司|抬头|商户|主体)[名称|全称]*[\s:：]*([^\n,，;；]{2,40})/i);
  if (supplierMatch) {
    fields.supplierName = supplierMatch[1].trim();
    count++;
  } else {
    // 启发式匹配带后缀的公司名
    const companyMatch = raw.match(/([^\s,，;；\n]{2,20}(?:有限公司|制品厂|塑料厂|五金厂|工艺品厂|实业厂|科技厂|工厂|商行|实业))/);
    if (companyMatch) {
      fields.supplierName = companyMatch[1].trim();
      count++;
    }
  }

  // 3. 采购单价
  const priceMatch = raw.match(/(?:单价|采购价|拿货价|出厂价|价格|报价|单只|单件|unit\s*price|price)[\s:：¥$￥]*([0-9]+(?:\.[0-9]+)?)/i)
    || raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:元|USD|\$|rmb|块)\s*(?:单价|每件|每只|\/件|\/个)/i);
  if (priceMatch) {
    fields.unitPrice = priceMatch[1];
    count++;
  }

  // 4. 单件运费
  const freightMatch = raw.match(/(?:单件运费|单只运费|运费|头程|物流费|freight|shipping)[\s:：¥$￥]*([0-9]+(?:\.[0-9]+)?)/i);
  if (freightMatch) {
    fields.freightPerUnit = freightMatch[1];
    count++;
  }

  // 5. 起订量 / MOQ
  const moqMatch = raw.match(/(?:起订量|最小起订|起订|最低订购|MOQ|moq)[\s:：]*([0-9]+)/i)
    || raw.match(/([0-9]+)\s*(?:个|件|套|只|pcs)\s*(?:起订|起批|起做)/i);
  if (moqMatch) {
    fields.moq = moqMatch[1];
    count++;
  }

  // 6. 交期
  const leadMatch = raw.match(/(?:交期|生产周期|出货周期|做货时间|工期|lead\s*time)[\s:：]*([0-9]+)\s*(?:天|工作日|day|days)?/i);
  if (leadMatch) {
    fields.leadTimeDays = leadMatch[1];
    count++;
  }

  // 7. 样品费
  const sampleMatch = raw.match(/(?:打样费|样品费|拿样费|样品|sample\s*fee)[\s:：¥$￥]*([0-9]+(?:\.[0-9]+)?)/i);
  if (sampleMatch) {
    fields.sampleFee = sampleMatch[1];
    count++;
  }

  // 8. 关税率
  const dutyMatch = raw.match(/(?:关税率|关税|tariff|duty\s*rate)[\s:：]*([0-9]+(?:\.[0-9]+)?)\s*%/i);
  if (dutyMatch) {
    fields.dutyRate = dutyMatch[1];
    count++;
  }

  // 9. 贸易条款
  const incotermMatch = raw.match(/\b(EXW|FOB|DDP|CIF|DAP|FCA)\b/i);
  if (incotermMatch) {
    fields.incoterm = incotermMatch[1].toUpperCase();
    count++;
  }

  // 10. 付款条件
  const paymentMatch = raw.match(/(?:付款条件|付款方式|支付方式|定金)[\s:：]*([^\n;；]{3,40})/i);
  if (paymentMatch) {
    fields.paymentTerms = paymentMatch[1].trim();
    count++;
  } else if (/30%定金|70%尾款|全款|现结|账期/i.test(raw)) {
    const matchedPart = raw.match(/(?:30%定金[^\n,，;；]*|全款发货|现结|发货前付清)/);
    if (matchedPart) {
      fields.paymentTerms = matchedPart[0].trim();
      count++;
    }
  }

  // 11. 联系人与联系方式
  const contactMatch = raw.match(/(?:联系人|对接人|业务员|电话|手机|微信|wx|wechat|contact)[\s:：]*([^\n,，;；]{2,30})/i);
  if (contactMatch) {
    fields.contact = contactMatch[1].trim();
    count++;
  }

  // 12. 认证
  const certs: string[] = [];
  const certPatterns = ["CE", "RoHS", "FDA", "FCC", "UL", "REACH", "BPA Free", "ISO9001"];
  for (const p of certPatterns) {
    if (new RegExp(`\\b${p}\\b`, "i").test(raw)) certs.push(p);
  }
  if (certs.length > 0) {
    fields.certifications = certs.join(", ");
    count++;
  }

  return { fields, count };
}

export function QuoteSmartPaste({ disabled }: { disabled?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleApply = () => {
    if (!pasteText.trim()) {
      setStatusMsg("⚠️ 请先粘贴报价文本或聊天记录");
      return;
    }

    const { fields, count } = extractFromText(pasteText);
    if (count === 0) {
      setStatusMsg("⚠️ 未能识别出典型字段，请检查是否包含单价、起订量、交期或供应商名称");
      return;
    }

    // 自动定位并填入 DOM 表单字段
    const fieldMap: Record<keyof ExtractedFields, string> = {
      supplierName: "supplierName",
      supplierPlatform: "supplierPlatform",
      supplierUrl: "supplierUrl",
      contact: "contact",
      country: "country",
      unitPrice: "unitPrice",
      freightPerUnit: "freightPerUnit",
      dutyRate: "dutyRate",
      moq: "moq",
      leadTimeDays: "leadTimeDays",
      sampleFee: "sampleFee",
      incoterm: "incoterm",
      paymentTerms: "paymentTerms",
      certifications: "certifications",
      supplierNotes: "supplierNotes",
    };

    const filledNames: string[] = [];

    for (const [key, elementId] of Object.entries(fieldMap) as Array<[keyof ExtractedFields, string]>) {
      const val = fields[key];
      if (val !== undefined) {
        const el = document.getElementById(elementId) as HTMLInputElement | HTMLTextAreaElement | null;
        if (el) {
          el.value = val;
          // 触发 input/change 事件以便绑定的监听器生效
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          filledNames.push(key);
        }
      }
    }

    // 将原始文本追加进核验记录，留作证据备查
    const notesEl = document.getElementById("supplierNotes") as HTMLTextAreaElement | null;
    if (notesEl && !notesEl.value.includes(pasteText.slice(0, 30))) {
      const current = notesEl.value.trim();
      notesEl.value = current ? `${current}\n\n[聊天记录/报价原始文本]:\n${pasteText}` : `[聊天记录/报价原始文本]:\n${pasteText}`;
      notesEl.dispatchEvent(new Event("input", { bubbles: true }));
    }

    setStatusMsg(`✓ 成功就地识别并填入 ${count} 个字段（含单价、MOQ、交期、供应商等）。请在下方表单核对后点击保存！`);
  };

  const handlePresetExample = () => {
    setPasteText("供应商：义乌市星火塑胶实业有限公司\n业务员：张经理 13800138000\n采购单价：3.20 USD\n单件海运运费：0.45 USD\n起订量 MOQ：1000 件\n交货周期：20 天\n样品费：30 USD\n贸易条款：FOB Ningbo\n付款条件：30% 定金，70% 验货后见提单付清\n通过认证：CE, RoHS, BPA Free");
    setStatusMsg(null);
  };

  return (
    <div
      style={{
        background: "#f8fafc",
        border: "1px dashed #cbd5e1",
        borderRadius: "8px",
        padding: "12px 16px",
        marginBottom: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "15px" }}>✨</span>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>
            智能识别：快速粘贴报价单 / 微信沟通记录
          </span>
          <span
            style={{
              fontSize: "11px",
              padding: "2px 8px",
              background: "#e0f2fe",
              color: "#0369a1",
              borderRadius: "4px",
              fontWeight: 600,
            }}
          >
            就地免切页
          </span>
        </div>
        <button
          type="button"
          className="button secondary"
          style={{ padding: "4px 10px", fontSize: "12px", height: "auto" }}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen((prev) => !prev);
          }}
        >
          {isOpen ? "收起" : "展开识别工具"}
        </button>
      </div>

      {isOpen && (
        <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)", lineHeight: 1.5 }}>
            直接粘贴供应商在微信、邮件、钉钉或 1688 发来的报价片段，AI 与规则引擎会自动提取单价、运费、起订量、交期与付款条件并填入表单，无需手动逐项手敲。
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => {
              setPasteText(e.target.value);
              setStatusMsg(null);
            }}
            placeholder="在此粘贴聊天记录或单据，例如：义乌星火厂，单价 3.2 USD，运费 0.45 USD，起订量 1000 个，交期 20 天，打样费 30，30% 定金 70% 尾款..."
            rows={4}
            disabled={disabled}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: "13px",
              borderRadius: "6px",
              border: "1px solid var(--line)",
              fontFamily: "inherit",
              resize: "vertical",
              background: "#ffffff",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="button primary"
                onClick={handleApply}
                disabled={disabled || !pasteText.trim()}
                style={{ fontSize: "12px", padding: "6px 14px", height: "auto" }}
              >
                ⚡ 一键解析并填入下方表单
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setPasteText("");
                  setStatusMsg(null);
                }}
                disabled={disabled || !pasteText}
                style={{ fontSize: "12px", padding: "6px 10px", height: "auto" }}
              >
                清空
              </button>
            </div>
            <button
              type="button"
              onClick={handlePresetExample}
              style={{
                background: "none",
                border: "none",
                color: "var(--green)",
                fontSize: "12px",
                cursor: "pointer",
                textDecoration: "underline",
                padding: "2px",
              }}
            >
              填入样板示例
            </button>
          </div>

          {statusMsg && (
            <div
              style={{
                fontSize: "12px",
                padding: "8px 12px",
                borderRadius: "6px",
                background: statusMsg.startsWith("✓") ? "#ecfdf5" : "#fffbeb",
                color: statusMsg.startsWith("✓") ? "#065f46" : "#92400e",
                border: `1px solid ${statusMsg.startsWith("✓") ? "#a7f3d0" : "#fde68a"}`,
                fontWeight: 600,
              }}
            >
              {statusMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
