const DEFAULT_SERVER = "http://localhost:1688";
const BASKET_KEY = "aitradeCompareBasket";

const siteBadge = document.getElementById("siteBadge");
const serverInput = document.getElementById("serverUrl");
const extraFieldWrap = document.getElementById("extraFieldWrap");
const caseSelect = document.getElementById("caseSelect");
const previewBox = document.getElementById("previewBox");
const addBasketBtn = document.getElementById("addBasketBtn");
const pushAutoPoolBtn = document.getElementById("pushAutoPoolBtn");
const captureBtn = document.getElementById("captureBtn");
const autofillPlatform = document.getElementById("autofillPlatform");
const autofillCaseSelect = document.getElementById("autofillCaseSelect");
const autofillBtn = document.getElementById("autofillBtn");
const statusEl = document.getElementById("status");
const basketCard = document.getElementById("basketCard");
const basketTitle = document.getElementById("basketTitle");
const basketList = document.getElementById("basketList");
const clearBasketBtn = document.getElementById("clearBasketBtn");
const sendBasketBtn = document.getElementById("sendBasketBtn");

let currentTab = null;
let mode = "unsupported"; // "amazon" | "1688" | "unsupported"
let preExtractedAmazon = null;
let basket = [];

function setStatus(msg, kind = "") {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`.trim();
}

function normalizeServer(raw) {
  return (raw || DEFAULT_SERVER).trim().replace(/\/+$/, "");
}

function firstNumber(text) {
  if (!text) return null;
  const matched = String(text).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!matched) return null;
  const value = Number(matched[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parsePriceToCents(text) {
  if (!text) return null;
  // 1. 兼容 Amazon 某些页面把 "$19.99" 渲染为 "$19 99"（空格分隔元与分）的情况
  const spaced = String(text).trim().replace(/(\d)\s+(\d{2})(?!\d)/g, "$1.$2");
  // 2. 只提取第一个独立价格数字，避免 "$19.99 $29.99" 被拼成异常大数
  const tokenMatch = spaced.match(/\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/);
  if (!tokenMatch) return null;
  const cleaned = tokenMatch[0];
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized;
  if (lastComma > lastDot) {
    normalized = cleaned.slice(lastComma + 1).length <= 2
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/[.,]/g, "");
  } else if (lastDot >= 0) {
    normalized = cleaned.slice(lastDot + 1).length <= 2
      ? cleaned.replace(/,/g, "")
      : cleaned.replace(/[.,]/g, "");
  } else {
    normalized = cleaned.replace(/[.,]/g, "");
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function formatCents(cents, currency) {
  if (!cents || cents <= 0) return "未采到售价";
  return `${(cents / 100).toFixed(2)} ${currency || "USD"}`;
}

async function saveBasket(nextBasket) {
  basket = nextBasket.slice(0, 20);
  await chrome.storage.local.set({ [BASKET_KEY]: basket });
  renderBasket();
}

function renderBasket() {
  if (basket.length === 0) {
    basketCard.style.display = "none";
    return;
  }
  basketCard.style.display = "block";
  basketTitle.textContent = `竞品对比篮子（已攒 ${basket.length} 款）`;
  sendBasketBtn.disabled = false;
  sendBasketBtn.textContent = `一键推送这 ${basket.length} 款生成对比研报`;

  basketList.innerHTML = "";
  for (const item of basket) {
    const row = document.createElement("div");
    row.className = "basket-item";

    const info = document.createElement("div");
    info.className = "basket-item-info";

    const title = document.createElement("div");
    title.className = "basket-item-title";
    title.textContent = `${item.asin} · ${item.title || "未命名商品"}`;

    const meta = document.createElement("div");
    meta.className = "basket-item-meta";
    meta.textContent = `${formatCents(item.priceCents, item.currency)} · ★${item.rating || "-"} · ${item.reviewCount || 0} 评 · ${(item.criticalReviews || []).length} 条差评`;

    info.appendChild(title);
    info.appendChild(meta);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "mini-btn";
    removeBtn.textContent = "移除";
    removeBtn.addEventListener("click", () => {
      saveBasket(basket.filter((x) => x.asin !== item.asin));
    });

    row.appendChild(info);
    row.appendChild(removeBtn);
    basketList.appendChild(row);
  }
}

async function extractAmazonPage(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ["scraper-amazon.js"],
  });
  return results?.[0]?.result || null;
}

async function loadCaseOptions(server, selectedId) {
  try {
    const [casesResp, targetsResp] = await Promise.all([
      fetch(`${server}/api/cases/options`).catch(() => null),
      fetch(`${server}/api/competitors/sourcing-target`).catch(() => null),
    ]);
    const casesJson = casesResp ? await casesResp.json().catch(() => ({})) : {};
    const targetsJson = targetsResp ? await targetsResp.json().catch(() => ({})) : {};
    const list = Array.isArray(casesJson.cases) ? casesJson.cases : [];
    const targets = Array.isArray(targetsJson.targets) ? targetsJson.targets : [];

    caseSelect.innerHTML = "";
    // 1. 优先置顶「待回补进价的竞品研报商品」：永远默认选中最新一条（targets[0]），防止旧的 aitradeSelectedCaseId 覆盖回老研报！
    const hasRecentTarget = targets.length > 0;
    if (hasRecentTarget) {
      const grp = document.createElement("optgroup");
      grp.label = "回补竞品研报进价（最新优先）";
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const opt = document.createElement("option");
        const val = `report:${t.reportId}:${t.asin}`;
        opt.value = val;
        const kindTag = (t.competitorCount || 1) <= 1 ? "单品" : `${t.competitorCount}款`;
        const cap = t.targetMaxCny > 0 ? ` · 上限≤¥${t.targetMaxCny}` : "";
        opt.textContent = `[回补·${kindTag}] ${t.asin}${cap} · ${(t.title || "").slice(0, 16)}`;
        if (i === 0) opt.selected = true;
        grp.appendChild(opt);
      }
      caseSelect.appendChild(grp);
    }

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "仅存入 1688 全局工厂库（不绑定商品）";
    caseSelect.appendChild(defaultOpt);

    if (list.length > 0) {
      const caseGrp = document.createElement("optgroup");
      caseGrp.label = "绑定到已立项商品案卷";
      for (const c of list) {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `[${c.marketplace}] ${c.asin} · ${(c.title || "").slice(0, 24)}`;
        if (!hasRecentTarget && selectedId && c.id === selectedId) opt.selected = true;
        caseGrp.appendChild(opt);
      }
      caseSelect.appendChild(caseGrp);
    }
  } catch {
    // 服务未响应时保留默认“仅存工厂库”选项
  }
}

async function loadAutofillCases(server) {
  if (!autofillCaseSelect) return;
  try {
    const resp = await fetch(`${server}/api/cases/options`);
    const json = await resp.json().catch(() => ({}));
    const list = Array.isArray(json.cases) ? json.cases : [];
    autofillCaseSelect.innerHTML = "";
    if (list.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "暂无可上架商品案卷";
      autofillCaseSelect.appendChild(opt);
      return;
    }
    for (const c of list) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `[${c.marketplace}] ${c.asin} · ${(c.title || "").slice(0, 22)}`;
      autofillCaseSelect.appendChild(opt);
    }
  } catch {
    autofillCaseSelect.innerHTML = '<option value="">未连接到 AITrade 服务</option>';
  }
}

async function init() {
  const stored = await chrome.storage.local.get(["aitradeServerUrl", "aitradeSelectedCaseId", BASKET_KEY]);
  serverInput.value = stored.aitradeServerUrl || DEFAULT_SERVER;
  basket = Array.isArray(stored[BASKET_KEY]) ? stored[BASKET_KEY] : [];
  renderBasket();
  loadAutofillCases(normalizeServer(serverInput.value));

  serverInput.addEventListener("change", () => {
    const next = normalizeServer(serverInput.value);
    chrome.storage.local.set({ aitradeServerUrl: next });
    loadAutofillCases(next);
    if (mode === "1688") loadCaseOptions(next, caseSelect.value);
  });
  caseSelect.addEventListener("change", () => {
    chrome.storage.local.set({ aitradeSelectedCaseId: caseSelect.value });
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  const url = tab?.url || "";

  if (autofillPlatform) {
    if (/sellercentral\.amazon\./i.test(url)) autofillPlatform.value = "amazon";
    else if (/(?:admin\.shopify\.com|myshopify\.com\/admin)/i.test(url)) autofillPlatform.value = "shopify";
    else if (/seller[^/]*\.tiktok/i.test(url)) autofillPlatform.value = "tiktok_shop";
  }

  if (/https?:\/\/([^/]+\.)?amazon\./i.test(url) && !/sellercentral\.amazon\./i.test(url)) {
    mode = "amazon";
    try {
      preExtractedAmazon = await extractAmazonPage(tab.id);
    } catch (extractErr) {
      preExtractedAmazon = null;
      setStatus(`页面读取失败：${extractErr instanceof Error ? extractErr.message : String(extractErr)}`, "err");
    }

    if (preExtractedAmazon?.mode === "serp") {
      const count = preExtractedAmazon.items?.length || 0;
      siteBadge.textContent = `Amazon 搜索页 · ${count} 款`;
      previewBox.style.display = "block";
      previewBox.textContent = `已识别搜索词「${preExtractedAmazon.keyword || "当前页"}」下 ${count} 款可见竞品（含真实售价、评分、评论数）。`;
      captureBtn.textContent = `采集生成格局研报 (${count})`;
      captureBtn.className = "secondary";
      captureBtn.disabled = count === 0;
      if (pushAutoPoolBtn) {
        pushAutoPoolBtn.style.display = count > 0 ? "block" : "none";
        pushAutoPoolBtn.disabled = count === 0;
      }
      addBasketBtn.style.display = "none";
    } else if (preExtractedAmazon?.asin) {
      const pCents = parsePriceToCents(preExtractedAmazon.price);
      const rVal = firstNumber(preExtractedAmazon.rating);
      const rCnt = firstNumber(preExtractedAmazon.reviewCount);
      siteBadge.textContent = `Amazon 单品 · ${preExtractedAmazon.asin}`;
      previewBox.style.display = "block";
      const salesTag = preExtractedAmazon.boughtPastMonth ? ` · 月销 ${preExtractedAmazon.boughtPastMonth}+` : "";
      const couponTag = preExtractedAmazon.couponText ? ` · 券 ${preExtractedAmazon.couponText}` : "";
      const shipTag = preExtractedAmazon.shippingCents ? ` + 运费 ${formatCents(preExtractedAmazon.shippingCents, preExtractedAmazon.currency)}` : "";
      previewBox.innerHTML = `
        <div><strong>${(preExtractedAmazon.title || preExtractedAmazon.asin).slice(0, 62)}</strong></div>
        <div style="margin-top:4px;color:#52635a;">
          售价：<strong>${formatCents(pCents, preExtractedAmazon.currency)}</strong>${shipTag}${couponTag} · 评分：${rVal || "—"} · 评论：${rCnt || "—"}${salesTag} · 差评：${(preExtractedAmazon.criticalReviews || []).length} 条
        </div>
      `;
      addBasketBtn.style.display = "block";
      addBasketBtn.disabled = false;
      captureBtn.className = "secondary";
      captureBtn.textContent = "仅分析当前单品";
      captureBtn.disabled = false;
      setStatus("想对比多款商品？点「+ 加入对比篮子」，再切到下个商品继续加入，最后一键推送对比！");
    } else {
      siteBadge.textContent = "Amazon 页面";
      captureBtn.textContent = "一键采集当前 Amazon 页面";
      captureBtn.disabled = false;
    }
  } else if (/https?:\/\/([^/]+\.)?1688\.com/i.test(url)) {
    mode = "1688";
    siteBadge.textContent = "1688 工厂";
    extraFieldWrap.style.display = "block";
    captureBtn.textContent = "一键采集当前 1688 工厂与报价";
    captureBtn.disabled = false;
    setStatus("正在读取你的商品列表… 在 1688 搜索页点下方按钮即可一键采集工厂和人民币报价。");
    await loadCaseOptions(normalizeServer(serverInput.value), stored.aitradeSelectedCaseId || "");
    setStatus("选好要归属的商品（或不选仅存工厂库），点击按钮一键导入 1688 工厂与报价。");
  } else {
    mode = "unsupported";
    siteBadge.textContent = "非支持站点";
    captureBtn.textContent = "请在 Amazon 或 1688 页面使用";
    captureBtn.disabled = true;
  }
}

addBasketBtn.addEventListener("click", async () => {
  if (!preExtractedAmazon?.asin) return;
  const entry = {
    url: preExtractedAmazon.url,
    asin: preExtractedAmazon.asin,
    title: preExtractedAmazon.title || preExtractedAmazon.asin,
    brand: preExtractedAmazon.brand || "",
    marketCode: preExtractedAmazon.marketCode || "US",
    currency: preExtractedAmazon.currency || "USD",
    priceCents: parsePriceToCents(preExtractedAmazon.price),
    shippingCents: preExtractedAmazon.shippingCents || null,
    listPriceCents: parsePriceToCents(preExtractedAmazon.listPrice),
    couponText: preExtractedAmazon.couponText || "",
    boughtPastMonth: preExtractedAmazon.boughtPastMonth || null,
    imageUrl: preExtractedAmazon.imageUrl || "",
    fulfillmentType: preExtractedAmazon.fulfillmentType || "unknown",
    dateFirstAvailable: preExtractedAmazon.dateFirstAvailable || "",
    dimensionsText: preExtractedAmazon.dimensionsText || "",
    ratingDistribution: preExtractedAmazon.ratingDistribution || null,
    rating: firstNumber(preExtractedAmazon.rating),
    reviewCount: firstNumber(preExtractedAmazon.reviewCount),
    bullets: preExtractedAmazon.bullets || [],
    criticalReviews: preExtractedAmazon.criticalReviews || [],
  };
  const next = [...basket.filter((x) => x.asin !== entry.asin), entry];
  await saveBasket(next);
  setStatus(`已将 ${entry.asin}（${formatCents(entry.priceCents, entry.currency)}）加入对比篮子，当前共 ${next.length} 款！`, "ok");
});

clearBasketBtn.addEventListener("click", async () => {
  await saveBasket([]);
  setStatus("已清空对比篮子。");
});

sendBasketBtn.addEventListener("click", async () => {
  if (basket.length === 0) return;
  const server = normalizeServer(serverInput.value);
  await chrome.storage.local.set({ aitradeServerUrl: server });

  sendBasketBtn.disabled = true;
  setStatus(`正在打包推送篮子内 ${basket.length} 款真实竞品至 AITrade（约 5–15 秒）…`);
  try {
    const first = basket[0];
    const resp = await fetch(`${server}/api/competitors/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "serp",
        keyword: `多品深度对比 (${basket.map((b) => b.asin).join(", ")})`,
        marketCode: first.marketCode || "US",
        platformCode: "amazon",
        currency: first.currency || "USD",
        items: basket,
      }),
    });
    const json = await resp.json();
    if (!resp.ok || !json.success) {
      throw new Error(json.error || `HTTP ${resp.status}`);
    }
    const count = json.competitorCount ?? basket.length;
    await saveBasket([]);
    setStatus(`对比研报生成成功（${count} 款真实样本），已自动清空篮子，正在打开…`, "ok");
    const targetUrl = json.redirectUrl ? `${server}${json.redirectUrl}` : `${server}/competitors`;
    chrome.tabs.create({ url: targetUrl });
  } catch (err) {
    setStatus(`推送失败：${err instanceof Error ? err.message : String(err)}`, "err");
  } finally {
    sendBasketBtn.disabled = false;
  }
});

captureBtn.addEventListener("click", async () => {
  if (!currentTab?.id || mode === "unsupported") return;
  const server = normalizeServer(serverInput.value);
  await chrome.storage.local.set({ aitradeServerUrl: server });

  captureBtn.disabled = true;
  setStatus("正在提取当前页面可见数据…");

  try {
    if (mode === "amazon") {
      const extracted = preExtractedAmazon || (await extractAmazonPage(currentTab.id));
      if (!extracted) throw new Error("未提取到有效 Amazon 商品数据");

      let payload;
      if (extracted.mode === "serp") {
        const items = (extracted.items || []).map((it) => ({
          url: it.url,
          asin: it.asin,
          brand: it.brand || "",
          title: it.title,
          priceCents: parsePriceToCents(it.price),
          shippingCents: it.shippingCents || null,
          listPriceCents: parsePriceToCents(it.listPrice),
          couponText: it.couponText || "",
          boughtPastMonth: it.boughtPastMonth || null,
          isSponsored: Boolean(it.isSponsored),
          imageUrl: it.imageUrl || "",
          rating: firstNumber(it.rating),
          reviewCount: firstNumber(it.reviewCount),
        }));
        if (items.length === 0) throw new Error("当前搜索页未检测到有效商品卡片");
        payload = {
          mode: "serp",
          url: extracted.url,
          keyword: extracted.keyword || "",
          marketCode: extracted.marketCode || "US",
          platformCode: "amazon",
          currency: extracted.currency || "USD",
          items,
        };
        setStatus(`已提取 ${items.length} 款竞品，正在推送并分析（约 5–15 秒）…`);
      } else {
        const rawText = [
          extracted.bullets?.length ? `五点描述:\n${extracted.bullets.join("\n")}` : "",
          extracted.criticalReviews?.length ? `买家差评:\n${extracted.criticalReviews.join("\n")}` : "",
        ].filter(Boolean).join("\n\n");
        payload = {
          mode: "detail",
          url: extracted.url,
          asin: extracted.asin,
          title: extracted.title,
          brand: extracted.brand,
          category: extracted.category,
          marketCode: extracted.marketCode || "US",
          platformCode: "amazon",
          currency: extracted.currency || "USD",
          rawText,
          priceCents: parsePriceToCents(extracted.price),
          shippingCents: extracted.shippingCents || null,
          listPriceCents: parsePriceToCents(extracted.listPrice),
          couponText: extracted.couponText || "",
          boughtPastMonth: extracted.boughtPastMonth || null,
          imageUrl: extracted.imageUrl || "",
          fulfillmentType: extracted.fulfillmentType || "unknown",
          dateFirstAvailable: extracted.dateFirstAvailable || "",
          dimensionsText: extracted.dimensionsText || "",
          ratingDistribution: extracted.ratingDistribution || null,
          rating: firstNumber(extracted.rating),
          reviewCount: firstNumber(extracted.reviewCount),
          bullets: extracted.bullets || [],
          criticalReviews: extracted.criticalReviews || [],
        };
        setStatus(`已提取 ${extracted.asin || "当前商品"}，正在推送并分析（约 5–15 秒）…`);
      }

      const resp = await fetch(`${server}/api/competitors/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        throw new Error(json.error || `HTTP ${resp.status}`);
      }

      setStatus(`采集成功（${json.competitorCount ?? 1} 款）！正在打开 AITrade 研报…`, "ok");
      const targetUrl = json.redirectUrl
        ? `${server}${json.redirectUrl}`
        : json.reportId
          ? `${server}/competitors?id=${encodeURIComponent(json.reportId)}`
          : `${server}/competitors`;
      chrome.tabs.create({ url: targetUrl });
    } else if (mode === "1688") {
      const selectedCaseId = caseSelect.value || "";
      await chrome.storage.local.set({ aitradeSelectedCaseId: selectedCaseId });

      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        files: ["scraper-1688.js"],
      });
      const results = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: () => (typeof extractVisible1688Candidates === "function" ? extractVisible1688Candidates() : null),
      });
      const extracted = results?.[0]?.result;
      if (!extracted || !Array.isArray(extracted.candidates) || extracted.candidates.length === 0) {
        throw new Error("未提取到可见 1688 商品卡片，请先向下滚动页面让商品加载出来再点");
      }

      setStatus(`已识别 ${extracted.candidates.length} 家 1688 工厂，正在写入 AITrade…`);
      const resp = await fetch(`${server}/api/sourcing/capture-1688`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: selectedCaseId || undefined,
          candidates: extracted.candidates,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) throw new Error(json.error || `HTTP ${resp.status}`);

      setStatus(
        json.backfilledCompetitor
          ? `回补成功！已将 1688 实采中位进价 ¥${json.backfilledActualCny} 写回竞品研报（入库 ${json.importedSuppliers ?? 0} 家新厂），正在打开…`
          : `采集成功！入库 ${json.importedSuppliers ?? 0} 家新工厂${json.importedQuotes ? `、生成 ${json.importedQuotes} 条比价报价` : ""}，正在打开…`,
        "ok",
      );
      if (json.redirectUrl) {
        chrome.tabs.create({ url: `${server}${json.redirectUrl}` });
      }
    }
  } catch (err) {
    setStatus(`采集失败：${err instanceof Error ? err.message : String(err)}`, "err");
  } finally {
    captureBtn.disabled = false;
  }
});

if (pushAutoPoolBtn) {
  pushAutoPoolBtn.addEventListener("click", async () => {
    if (!currentTab?.id || !preExtractedAmazon || preExtractedAmazon.mode !== "serp") return;
    const server = normalizeServer(serverInput.value);
    await chrome.storage.local.set({ aitradeServerUrl: server });

    const items = (preExtractedAmazon.items || []).map((it) => ({
      externalId: it.asin,
      asin: it.asin,
      title: it.title,
      brand: it.brand || "",
      url: it.url || "",
      currency: preExtractedAmazon.currency || "USD",
      priceCents: parsePriceToCents(it.price),
      boughtPastMonth: it.boughtPastMonth || null,
      reviewCount: firstNumber(it.reviewCount),
      rating: firstNumber(it.rating),
      isSponsored: Boolean(it.isSponsored),
    }));
    if (items.length === 0) {
      setStatus("当前页未识别到有效商品卡片", "err");
      return;
    }

    pushAutoPoolBtn.disabled = true;
    setStatus(`正在将 ${items.length} 款真实样本推送至自动选品池并自动算账分级…`);
    try {
      const resp = await fetch(`${server}/api/auto-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformCode: "amazon",
          marketCode: preExtractedAmazon.marketCode || "US",
          sourceType: "extension",
          sourceLabel: preExtractedAmazon.keyword || "Amazon 搜索页",
          items,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${resp.status}`);
      }
      setStatus(
        `已自动入池 ${json.run?.totalSeeds ?? items.length} 款（S:${json.run?.sCount ?? 0} / A:${json.run?.aCount ?? 0} / 淘汰:${json.run?.eliminatedCount ?? 0}），正在打开选品池…`,
        "ok",
      );
      chrome.tabs.create({ url: `${server}${json.redirectUrl || "/auto-pipeline"}` });
    } catch (err) {
      setStatus(`推送自动选品池失败：${err instanceof Error ? err.message : String(err)}`, "err");
    } finally {
      pushAutoPoolBtn.disabled = false;
    }
  });
}

if (autofillBtn) {
  autofillBtn.addEventListener("click", async () => {
    if (!currentTab?.id) return;
    const caseId = autofillCaseSelect?.value;
    const platform = autofillPlatform?.value || "amazon";
    if (!caseId) {
      setStatus("请先选择一个已完成内容终审的商品案卷", "err");
      return;
    }
    const server = normalizeServer(serverInput.value);
    await chrome.storage.local.set({ aitradeServerUrl: server });

    autofillBtn.disabled = true;
    setStatus(`正在从 AITrade 拉取 ${platform.toUpperCase()} 标准化上架文案…`);
    try {
      const resp = await fetch(
        `${server}/api/cases/${encodeURIComponent(caseId)}/listing-payload?platform=${encodeURIComponent(platform)}`,
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${resp.status}`);
      }

      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        files: ["autofill-profiles.js"],
      });
      const execResults = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: (payload, platformCode) =>
          typeof runConfigurableAutofill === "function"
            ? runConfigurableAutofill(payload, platformCode)
            : null,
        args: [json.payload, platform],
      });
      const res = execResults?.[0]?.result;
      if (!res?.ok) {
        throw new Error("未能在当前页面注入填表脚本");
      }
      setStatus(
        `已在 ${res.profile} 自动填入 ${res.filledKeys.length} 个字段，并打开右下角悬浮复制助手！请核对并上传图片后人工发布。`,
        "ok",
      );
    } catch (err) {
      setStatus(`半自动填表失败：${err instanceof Error ? err.message : String(err)}`, "err");
    } finally {
      autofillBtn.disabled = false;
    }
  });
}

init();
