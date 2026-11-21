const DEFAULT_SERVER = "http://localhost:3000";

const siteBadge = document.getElementById("siteBadge");
const serverInput = document.getElementById("serverUrl");
const extraFieldWrap = document.getElementById("extraFieldWrap");
const hypothesisInput = document.getElementById("hypothesisId");
const captureBtn = document.getElementById("captureBtn");
const statusEl = document.getElementById("status");

let currentTab = null;
let mode = "unsupported"; // "amazon" | "1688" | "unsupported"

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
  const cleaned = String(text).replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
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

async function init() {
  const stored = await chrome.storage.local.get(["aitradeServerUrl", "aitradeHypothesisId"]);
  serverInput.value = stored.aitradeServerUrl || DEFAULT_SERVER;
  hypothesisInput.value = stored.aitradeHypothesisId || "";

  serverInput.addEventListener("change", () => {
    chrome.storage.local.set({ aitradeServerUrl: normalizeServer(serverInput.value) });
  });
  hypothesisInput.addEventListener("change", () => {
    chrome.storage.local.set({ aitradeHypothesisId: hypothesisInput.value.trim() });
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  const url = tab?.url || "";

  if (/https?:\/\/([^/]+\.)?amazon\./i.test(url)) {
    mode = "amazon";
    siteBadge.textContent = "Amazon 竞品";
    captureBtn.textContent = "一键采集当前 Amazon 页面到 AITrade";
    captureBtn.disabled = false;
    setStatus("支持单品详情页 (/dp/) 或搜索结果页 (/s?k=...) Top 20 采集。");
  } else if (/https?:\/\/([^/]+\.)?1688\.com/i.test(url)) {
    mode = "1688";
    siteBadge.textContent = "1688 工厂";
    extraFieldWrap.style.display = "block";
    captureBtn.textContent = "一键采集当前 1688 工厂卡片";
    captureBtn.disabled = false;
    setStatus("将采集当前可见的 1688 商品/工厂卡片，请先填写目标假设 ID。");
  } else {
    mode = "unsupported";
    siteBadge.textContent = "非支持站点";
    captureBtn.textContent = "请在 Amazon 或 1688 页面使用";
    captureBtn.disabled = true;
  }
}

captureBtn.addEventListener("click", async () => {
  if (!currentTab?.id || mode === "unsupported") return;
  const server = normalizeServer(serverInput.value);
  await chrome.storage.local.set({ aitradeServerUrl: server });

  captureBtn.disabled = true;
  setStatus("正在提取当前页面可见数据…");

  try {
    if (mode === "amazon") {
      const results = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        files: ["scraper-amazon.js"],
      });
      const extracted = results?.[0]?.result;
      if (!extracted) throw new Error("未提取到有效 Amazon 商品数据");

      let payload;
      if (extracted.mode === "serp") {
        const items = (extracted.items || []).map((it) => ({
          url: it.url,
          asin: it.asin,
          title: it.title,
          priceCents: parsePriceToCents(it.price),
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
      const hypothesisId = hypothesisInput.value.trim();
      if (!hypothesisId) throw new Error("请先填写目标研究假设 ID");
      await chrome.storage.local.set({ aitradeHypothesisId: hypothesisId });

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
        throw new Error("未提取到可见 1688 商品卡片，请先滚动页面让卡片加载完成");
      }

      setStatus(`已识别 ${extracted.candidates.length} 个工厂候选，正在推送至 AITrade…`);
      const resp = await fetch(`${server}/api/supplier-candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hypothesisId,
          payload: JSON.stringify(extracted),
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);

      setStatus(`采集成功！新增 ${json.imported ?? 0} 条，识别 ${json.parsed ?? extracted.candidates.length} 条。`, "ok");
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

init();
