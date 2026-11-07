var previewBox = document.getElementById("preview");
var captureBtn = document.getElementById("captureBtn");
var copyBtn = document.getElementById("copyBtn");
var statusBox = document.getElementById("status");

var currentData = null;
var API_URL = "http://localhost:3000/api/competitors/capture";

function setStatus(msg, type) {
  statusBox.textContent = msg;
  statusBox.className = "status " + type;
}

async function init() {
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs[0];
    if (!tab || !tab.url) {
      previewBox.innerHTML = "<div style='color: #a13d39;'>无法获取当前标签页</div>";
      return;
    }

    if (!tab.url.includes("amazon.")) {
      previewBox.innerHTML = "<div style='color: #a96610;'>请先在浏览器打开任意亚马逊商品详情页（如 amazon.com 或 amazon.com.au 的 /dp/ 页面）</div>";
      return;
    }

    var results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["scraper.js"],
    });

    if (!results || !results[0] || !results[0].result) {
      previewBox.innerHTML = "<div style='color: #a13d39;'>未能从页面提取到商品数据</div>";
      return;
    }

    currentData = results[0].result;

    if (!currentData.asin && !currentData.title) {
      previewBox.innerHTML = "<div style='color: #a96610;'>当前页面可能不是商品详情页，未检测到 ASIN 或商品标题</div>";
      return;
    }

    // 渲染预览
    var html = [];
    if (currentData.asin) {
      html.push("<div><span class='badge'>" + currentData.marketCode + " · " + currentData.asin + "</span></div>");
    }
    if (currentData.category) {
      html.push("<div><strong style='color: #1f7a55;'>类目:</strong> " + currentData.category + "</div>");
    }
    if (currentData.brand) {
      html.push("<div><strong>品牌:</strong> " + currentData.brand + "</div>");
    }
    html.push("<div><strong>商品:</strong> " + (currentData.title.slice(0, 70) + (currentData.title.length > 70 ? "…" : "")) + "</div>");
    if (currentData.price) {
      html.push("<div><strong>售价:</strong> " + currentData.price + " | <strong>评分:</strong> " + (currentData.rating || "暂无") + "</div>");
    }
    if (currentData.bullets && currentData.bullets.length > 0) {
      html.push("<div style='color: #647169; font-size: 11px; margin-top: 4px;'>已提取 " + currentData.bullets.length + " 条五点描述及 " + currentData.criticalReviews.length + " 条真实评价</div>");
    }

    previewBox.innerHTML = html.join("");
    captureBtn.disabled = false;
    copyBtn.style.display = "block";
  } catch (err) {
    previewBox.innerHTML = "<div style='color: #a13d39;'>初始化失败: " + err.message + "</div>";
  }
}

captureBtn.addEventListener("click", async function () {
  if (!currentData) return;
  captureBtn.disabled = true;
  setStatus("正在推送至 AITrade 并执行智能分析…", "success");

  try {
    var rawText = [
      currentData.bullets && currentData.bullets.length > 0 ? "五点描述:\n" + currentData.bullets.join("\n") : "",
      currentData.criticalReviews && currentData.criticalReviews.length > 0 ? "买家差评:\n" + currentData.criticalReviews.join("\n") : "",
    ].filter(Boolean).join("\n\n");

    var response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: currentData.url,
        asin: currentData.asin,
        title: currentData.title,
        brand: currentData.brand,
        category: currentData.category,
        marketCode: currentData.marketCode,
        platformCode: "amazon",
        currency: currentData.currency,
        rawText: rawText,
      }),
    });

    var resJson = await response.json();
    if (response.ok && resJson.success) {
      setStatus("✅ 采集成功！正在打开 AITrade 竞品对比…", "success");
      setTimeout(function () {
        chrome.tabs.create({ url: "http://localhost:3000/competitors" });
      }, 800);
    } else {
      throw new Error(resJson.error || "服务端返回异常");
    }
  } catch (err) {
    captureBtn.disabled = false;
    setStatus("推送失败: " + err.message + " (请确认 AITrade 服务已在 localhost:3000 启动)", "error");
  }
});

copyBtn.addEventListener("click", function () {
  if (!currentData) return;
  var text = [
    currentData.url,
    "ASIN: " + currentData.asin,
    "Title: " + currentData.title,
    "Category: " + currentData.category,
    "Price: " + currentData.price,
  ].join("\n");

  navigator.clipboard.writeText(text).then(function () {
    setStatus("已复制到剪贴板！可以直接粘贴到 AITrade 竞品对比输入框", "success");
  });
});

init();
