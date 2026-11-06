(function () {
  var config = Object.freeze(__AITRADE_CONFIG__);
  var offerPattern = /\/offer\/(\d+)\.html/i;
  var seen = Object.create(null);
  var candidates = [];
  var anchors = document.querySelectorAll('a[href*="/offer/"]');

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function absoluteUrl(value) {
    if (!value) return "";
    try { return new URL(value, location.href).toString(); } catch (_) { return ""; }
  }

  function findCard(anchor) {
    var current = anchor;
    var best = anchor.parentElement;
    for (var depth = 0; current && depth < 8; depth += 1) {
      current = current.parentElement;
      if (!current) break;
      var text = clean(current.innerText);
      if (text.length >= 30 && text.length <= 4000) best = current;
      if (text.length > 4000) break;
    }
    return best || anchor;
  }

  function extractCard(anchor, offerId) {
    var card = findCard(anchor);
    var cardText = clean(card.innerText).slice(0, 1800);
    var alt = card.querySelector("img[alt]");
    var titleNode = card.querySelector("h2, h3, [class*='title'], [class*='subject']");
    var anchorText = clean(anchor.innerText || anchor.getAttribute("title"));
    var title = clean(
      (alt && alt.getAttribute("alt")) ||
      (titleNode && titleNode.textContent) ||
      anchor.getAttribute("title") ||
      anchorText ||
      cardText.split(/[。；\n]/)[0]
    ).slice(0, 500);

    var offerUrl = absoluteUrl(anchor.getAttribute("href"));
    var supplierUrl = "";
    var supplierName = "";
    var shopAnchors = card.querySelectorAll('a[href]');
    for (var index = 0; index < shopAnchors.length; index += 1) {
      var href = absoluteUrl(shopAnchors[index].getAttribute("href"));
      if (!href || /\/offer\//i.test(href)) continue;
      if (/1688\.com/i.test(href) && /(shop|company|winport)/i.test(href)) {
        supplierUrl = href;
        supplierName = clean(shopAnchors[index].innerText || shopAnchors[index].getAttribute("title"));
        if (supplierName) break;
      }
    }
    if (!supplierName) {
      var lines = cardText.split(/[\n|]/).map(clean).filter(Boolean);
      supplierName = lines.find(function (line) {
        return /(工厂|公司|商行|店铺|经营部|企业)/.test(line) && line.length <= 80;
      }) || "1688 待核验供应商";
    }

    var priceMatch = cardText.match(/[¥￥]\s*[0-9]+(?:\.[0-9]+)?(?:\s*[-~—]\s*[0-9.]+)?/);
    if (!priceMatch) priceMatch = cardText.match(/[0-9]+\.[0-9]{2}(?:\s*[-~—]\s*[0-9.]+)?/);
    var moqMatch = cardText.match(/[0-9]+\s*(?:件|个|套|箱|只|双|台)\s*起(?:批|订)?/);
    var locationMatch = cardText.match(/(?:广东|浙江|江苏|福建|山东|河南|河北|湖北|湖南|安徽|江西|四川|重庆|上海|北京|天津|广西|辽宁|吉林|黑龙江|陕西|山西|云南|贵州|海南)(?:\s*[·\s]\s*[\u4e00-\u9fa5]{2,8})?/);
    var leadTimeMatch = cardText.match(/([0-9]+)\s*(?:天|小时)内?发货/);
    var badgeNames = ["超级工厂", "实力商家", "实力工厂", "深度验厂", "诚信通", "1688严选", "48小时发货", "源头工厂"];
    var badges = badgeNames.filter(function (badge) { return cardText.indexOf(badge) !== -1; });

    if (!offerId || !title || !offerUrl) return null;
    return {
      title: title,
      supplierName: supplierName.slice(0, 180),
      offerUrl: offerUrl,
      supplierUrl: supplierUrl,
      price: priceMatch ? priceMatch[0] : "",
      moq: moqMatch ? moqMatch[0] : "",
      badges: badges,
      location: locationMatch ? clean(locationMatch[0]) : "",
      leadTimeDays: leadTimeMatch ? Number(leadTimeMatch[1]) : null,
      sourceText: cardText,
    };
  }

  for (var index = 0; index < anchors.length; index += 1) {
    var match = String(anchors[index].getAttribute("href") || "").match(offerPattern);
    if (!match || seen[match[1]]) continue;
    seen[match[1]] = true;
    var candidate = extractCard(anchors[index], match[1]);
    if (candidate) candidates.push(candidate);
  }

  if (!candidates.length) {
    window.alert("没有识别到当前页商品。请确认已打开 1688 搜索结果页，并让商品卡出现在当前可见页面。");
    return;
  }

  var payload = {
    source: "1688_visible_page",
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    candidates: candidates.slice(0, 60),
  };
  var appUrl = config.appOrigin + "/ai-sourcing/" + encodeURIComponent(config.runId)
    + "?capture=clipboard&hypothesisId=" + encodeURIComponent(config.hypothesisId)
    + "#hypothesis-" + encodeURIComponent(config.hypothesisId);
  var popup = window.open("about:blank", "aitrade_supplier_capture");

  function openAITrade() {
    if (popup && !popup.closed) popup.location.href = appUrl;
    else window.location.href = appUrl;
  }

  navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(function () {
    openAITrade();
  }).catch(function () {
    if (popup && !popup.closed) popup.close();
    window.prompt("自动复制失败，请复制以下候选数据，再回到 AITrade 粘贴：", JSON.stringify(payload, null, 2));
  });
})();
