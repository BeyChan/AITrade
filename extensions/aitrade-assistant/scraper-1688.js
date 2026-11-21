function extractVisible1688Candidates() {
  var offerPattern = /\/offer\/(\d+)\.html/i;
  var seen = Object.create(null);
  var candidates = [];

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function absoluteUrl(value) {
    if (!value) return "";
    try { return new URL(value, location.href).toString(); } catch (_) { return ""; }
  }

  // 0. 单品详情页直采模式（detail.1688.com/offer/xxxx.html）
  var detailMatch = location.href.match(offerPattern);
  if (detailMatch) {
    var bodyText = clean(document.body ? document.body.innerText : "").slice(0, 6000);
    var h1 = document.querySelector("h1, .title-text, [class*='title-content'], [class*='offer-title']");
    var detailTitle = clean((h1 && h1.textContent) || document.title.replace(/[-_—].*1688.*$/i, "")).slice(0, 300);

    var shopNode = document.querySelector(
      "[class*='company-name'], [class*='shop-name'], [class*='shopName'], a[href*='winport'], a[href*='.1688.com/page/']"
    );
    var detailSupplier = clean(shopNode && shopNode.textContent);
    var detailSupplierUrl = shopNode && shopNode.getAttribute("href") ? absoluteUrl(shopNode.getAttribute("href")) : "";
    if (!detailSupplier) {
      var textLines = (document.body ? document.body.innerText : "").split(/\n+/).map(clean).filter(Boolean);
      detailSupplier = textLines.find(function (line) {
        return /(有限公司|工厂|商行|经营部|制造厂|工艺厂|贸易行)/.test(line) && line.length <= 50;
      }) || "1688 源头工厂";
    }

    var priceNode = document.querySelector("[class*='price-text'], [class*='price-num'], [class*='priceContent'], .price-info");
    var priceSource = clean(priceNode && priceNode.textContent) + " " + bodyText.slice(0, 1500);
    var dPriceMatch = priceSource.match(/[¥￥]\s*[0-9]+(?:\.[0-9]+)?/) || priceSource.match(/\b([0-9]+\.[0-9]{1,2})\b/);
    var dMoqMatch = bodyText.match(/[0-9]+\s*(?:件|个|套|箱|只|双|台)\s*起(?:批|订)?/);
    var dLocMatch = bodyText.match(/(?:广东|浙江|江苏|福建|山东|河南|河北|湖北|湖南|安徽|江西|四川|重庆|上海|北京|天津|广西|辽宁|吉林|黑龙江|陕西|山西|云南|贵州|海南)(?:\s*[·\s]\s*[\u4e00-\u9fa5]{2,8})?/);

    return {
      source: "1688_detail_page",
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
      candidates: [
        {
          title: detailTitle || ("1688 商品 " + detailMatch[1]),
          supplierName: detailSupplier.slice(0, 120),
          offerUrl: location.href,
          supplierUrl: detailSupplierUrl,
          price: dPriceMatch ? dPriceMatch[0] : "",
          moq: dMoqMatch ? dMoqMatch[0] : "",
          location: dLocMatch ? clean(dLocMatch[0]) : "CN",
          badges: [],
          sourceText: bodyText.slice(0, 1000),
        },
      ],
    };
  }

  var anchors = document.querySelectorAll('a[href*="/offer/"]');

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

  return {
    source: "1688_visible_page",
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    candidates: candidates.slice(0, 60),
  };
}
