/**
 * 多平台可配置半自动上架填表映射表与执行器。
 * 新增平台只需在 AITRADE_AUTOFILL_PROFILES 中增加一份 selector 配置，无需修改主逻辑。
 */
var AITRADE_AUTOFILL_PROFILES = {
  amazon: {
    label: "Amazon Seller Central",
    urlPattern: /sellercentral\.amazon\./i,
    fields: {
      title: [
        'input[name*="item_name"]',
        'input[id*="item_name"]',
        'textarea[name*="item_name"]',
        'input[aria-label*="Product Name" i]',
        'input[aria-label*="商品名称"]',
      ],
      brand: [
        'input[name*="brand"]',
        'input[id*="brand"]',
        'input[aria-label*="Brand Name" i]',
        'input[aria-label*="品牌"]',
      ],
      sku: [
        'input[name*="seller_sku"]',
        'input[name*="item_sku"]',
        'input[id*="sku"]',
        'input[aria-label*="SKU" i]',
      ],
      price: [
        'input[name*="standard_price"]',
        'input[name*="our_price"]',
        'input[id*="price"]',
        'input[aria-label*="Your Price" i]',
        'input[aria-label*="售价"]',
      ],
      description: [
        'textarea[name*="product_description"]',
        'textarea[id*="product_description"]',
        'textarea[aria-label*="Product Description" i]',
        'textarea[aria-label*="商品描述"]',
      ],
      searchTerms: [
        'input[name*="generic_keyword"]',
        'textarea[name*="generic_keyword"]',
        'input[aria-label*="Search Terms" i]',
        'input[aria-label*="搜索词"]',
      ],
      bullets: [
        'input[name*="bullet_point"], textarea[name*="bullet_point"]',
        'input[id*="bullet_point"], textarea[id*="bullet_point"]',
      ],
    },
  },
  shopify: {
    label: "Shopify Admin",
    urlPattern: /(?:admin\.shopify\.com|myshopify\.com\/admin)/i,
    fields: {
      title: ['input[name="title"]', 'input[placeholder*="Short sleeve" i]'],
      brand: ['input[name="vendor"]'],
      sku: ['input[name="sku"]'],
      price: ['input[name="price"]'],
      description: ['textarea[name="description"]', 'div[contenteditable="true"]'],
      searchTerms: ['input[name="tags"]'],
      bullets: [],
    },
  },
  tiktok_shop: {
    label: "TikTok Shop Seller",
    urlPattern: /seller[^/]*\.tiktok/i,
    fields: {
      title: ['input[placeholder*="Product Name" i]', 'input[placeholder*="商品名称"]'],
      brand: ['input[placeholder*="Brand" i]', 'input[placeholder*="品牌"]'],
      sku: ['input[placeholder*="SKU" i]'],
      price: ['input[placeholder*="Price" i]', 'input[placeholder*="价格"]'],
      description: ['textarea[placeholder*="Description" i]', 'div[contenteditable="true"]'],
      searchTerms: [],
      bullets: [],
    },
  },
};

function setNativeInputValue(el, value) {
  if (!el || value === undefined || value === null) return false;
  const text = String(value);
  if (el.isContentEditable) {
    el.focus();
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  const proto =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor && descriptor.set) {
    descriptor.set.call(el, text);
  } else {
    el.value = text;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
  return true;
}

function queryFirstVisible(selectors) {
  for (const sel of selectors || []) {
    const candidates = document.querySelectorAll(sel);
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && !el.disabled && !el.readOnly) {
        return el;
      }
    }
  }
  return null;
}

function renderAutofillHelperOverlay(payload, filledKeys, profileLabel) {
  const existing = document.getElementById("aitrade-autofill-overlay");
  if (existing) existing.remove();

  const f = payload.fields || {};
  const panel = document.createElement("div");
  panel.id = "aitrade-autofill-overlay";
  panel.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;max-height:70vh;overflow:auto;background:#10251c;color:#f5f7f5;border:1px solid #2b5240;border-radius:12px;padding:12px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;font-size:12px;box-shadow:0 12px 32px rgba(0,0,0,0.35);";

  const copyItems = [
    { key: "title", label: "标题 Title", value: f.title },
    { key: "brand", label: "品牌 Brand", value: f.brand },
    { key: "sku", label: "SKU", value: f.sku },
    { key: "price", label: `售价 (${f.currency})`, value: f.price },
    ...(f.bullets || []).filter(Boolean).map((b, i) => ({
      key: `bullet_${i + 1}`,
      label: `五点 #${i + 1}`,
      value: b,
    })),
    { key: "description", label: "商品描述", value: f.description },
    { key: "searchTerms", label: "后台搜索词", value: f.searchTerms },
    { key: "specifications", label: "核心规格", value: f.specifications },
    { key: "packageContents", label: "包装清单", value: f.packageContents },
  ].filter((x) => x.value);

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong>AITrade 半自动上架助手 (${profileLabel})</strong>
      <button id="aitrade-overlay-close" style="background:transparent;border:1px solid #4c7361;color:#fff;border-radius:6px;padding:2px 7px;cursor:pointer;font-size:11px;">关闭</button>
    </div>
    <div style="font-size:11px;color:#b8d4c5;margin-bottom:8px;">
      已自动填入 ${filledKeys.length} 项。未命中或动态类目属性可点下方一键复制；主图请从导出的 media-pack ZIP 手动上传后人工确认发布。
    </div>
    <div id="aitrade-copy-list" style="display:flex;flex-direction:column;gap:6px;"></div>
  `;

  document.body.appendChild(panel);
  panel.querySelector("#aitrade-overlay-close")?.addEventListener("click", () => panel.remove());

  const listEl = panel.querySelector("#aitrade-copy-list");
  for (const item of copyItems) {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;background:#19362a;border:1px solid #2b5240;";
    const isFilled = filledKeys.includes(item.key);
    const label = document.createElement("div");
    label.style.cssText = "min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    label.textContent = `${isFilled ? "✓ " : ""}${item.label}: ${String(item.value).slice(0, 32)}`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "复制";
    btn.style.cssText =
      "background:#1f7a55;color:#fff;border:none;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;flex-shrink:0;";
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(String(item.value));
        btn.textContent = "已复制";
        setTimeout(() => {
          btn.textContent = "复制";
        }, 1200);
      } catch {
        btn.textContent = "复制失败";
      }
    });

    row.appendChild(label);
    row.appendChild(btn);
    listEl?.appendChild(row);
  }
}

function runConfigurableAutofill(payload, platformCode) {
  const profile =
    AITRADE_AUTOFILL_PROFILES[platformCode] ||
    Object.values(AITRADE_AUTOFILL_PROFILES).find((p) => p.urlPattern.test(location.href)) ||
    AITRADE_AUTOFILL_PROFILES.amazon;

  const fields = payload.fields || {};
  const filledKeys = [];

  for (const key of ["title", "brand", "sku", "price", "description", "searchTerms"]) {
    const val = fields[key];
    if (!val) continue;
    const el = queryFirstVisible(profile.fields[key]);
    if (el && setNativeInputValue(el, val)) {
      filledKeys.push(key);
    }
  }

  const bullets = Array.isArray(fields.bullets) ? fields.bullets.filter(Boolean) : [];
  if (bullets.length > 0 && profile.fields.bullets?.length) {
    const bulletInputs = [];
    for (const sel of profile.fields.bullets) {
      document.querySelectorAll(sel).forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && !el.disabled && !bulletInputs.includes(el)) {
          bulletInputs.push(el);
        }
      });
    }
    bullets.forEach((b, idx) => {
      if (bulletInputs[idx] && setNativeInputValue(bulletInputs[idx], b)) {
        filledKeys.push(`bullet_${idx + 1}`);
      }
    });
  }

  renderAutofillHelperOverlay(payload, filledKeys, profile.label);
  return { ok: true, profile: profile.label, filledKeys };
}
