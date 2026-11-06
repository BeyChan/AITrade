var configInput = document.getElementById("config");
var saveButton = document.getElementById("save");
var captureButton = document.getElementById("capture");
var currentBox = document.getElementById("current");
var statusBox = document.getElementById("status");

var currentConfig = null;

function setStatus(message, kind) {
  statusBox.textContent = message;
  statusBox.className = "status" + (kind ? " " + kind : "");
}

function renderConfig(config) {
  currentConfig = config;
  if (!config) {
    currentBox.textContent = "尚未配置研究批次";
    return;
  }
  currentBox.textContent = "研究批次：" + config.runId + "\n方向 ID：" + config.hypothesisId + "\n搜索词：" + config.query;
}

function parseConfig(text) {
  var parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("配置必须是 JSON 对象");
  ["apiBase", "appOrigin", "runId", "hypothesisId", "query", "actor"].forEach(function (key) {
    if (!parsed[key] || typeof parsed[key] !== "string") throw new Error("缺少配置字段：" + key);
  });
  return parsed;
}

async function loadConfig() {
  var stored = await chrome.storage.local.get("aitradeSupplierConfig");
  var config = stored.aitradeSupplierConfig || null;
  if (config) configInput.value = JSON.stringify(config, null, 2);
  renderConfig(config);
}

async function saveConfig() {
  try {
    var config = parseConfig(configInput.value);
    await chrome.storage.local.set({ aitradeSupplierConfig: config });
    renderConfig(config);
    setStatus("配置已保存，可以打开 1688 搜索结果页采集", "success");
  } catch (error) {
    setStatus("配置保存失败：" + error.message, "error");
  }
}

async function captureCurrentPage() {
  if (!currentConfig) {
    setStatus("请先把 AITrade 页面复制的配置粘贴到上方并保存", "error");
    return;
  }

  captureButton.disabled = true;
  setStatus("正在读取当前页可见商品卡…");
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs[0];
    if (!tab || !tab.id || !tab.url || !/^https:\/\/[^/]*1688\.com\//i.test(tab.url)) {
      throw new Error("请在 1688 搜索结果页打开扩展");
    }

    var execution = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractVisible1688Candidates,
    });
    var payload = execution[0] && execution[0].result;
    if (!payload || !Array.isArray(payload.candidates) || payload.candidates.length === 0) {
      throw new Error("当前页没有识别到商品卡，请确认商品已显示并滚动到当前页面");
    }

    setStatus("已识别 " + payload.candidates.length + " 个候选，正在写入 AITrade…");
    var response = await fetch(currentConfig.apiBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: currentConfig.runId,
        hypothesisId: currentConfig.hypothesisId,
        query: currentConfig.query,
        actor: currentConfig.actor,
        payload: JSON.stringify(payload),
      }),
    });
    var result = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(result.error || "AITrade 写入失败");

    var targetUrl = new URL(result.redirectUrl, currentConfig.appOrigin).toString();
    await chrome.tabs.create({ url: targetUrl });
    setStatus("导入成功：新增 " + result.imported + " 个，识别 " + result.parsed + " 个，正在打开 AITrade", "success");
  } catch (error) {
    setStatus("采集失败：" + (error && error.message ? error.message : "未知错误"), "error");
  } finally {
    captureButton.disabled = false;
  }
}

saveButton.addEventListener("click", saveConfig);
captureButton.addEventListener("click", captureCurrentPage);
loadConfig().catch(function (error) {
  setStatus("读取配置失败：" + error.message, "error");
});
