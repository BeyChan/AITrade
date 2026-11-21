(function () {
  function getCleanText(el) {
    if (!el) return "";
    return el.textContent.replace(/\s+/g, " ").trim();
  }

  function readPriceFromNode(priceNode) {
    if (!priceNode) return "";
    // 优先读 whole + fraction：Amazon 2025/2026 新版 .priceToPay 经常把 .a-offscreen 留空，
    // 若跳过它去匹配后续 .a-price .a-offscreen，极易误抓单价 ($1.00/count)！
    var wholeEl = priceNode.querySelector(".a-price-whole");
    var fracEl = priceNode.querySelector(".a-price-fraction");
    if (wholeEl) {
      var whole = getCleanText(wholeEl).replace(/[^\d]/g, "");
      var frac = getCleanText(fracEl).replace(/[^\d]/g, "");
      if (whole) return frac ? whole + "." + frac : whole;
    }
    var offscreen = getCleanText(priceNode.querySelector(".a-offscreen"));
    if (offscreen && /\d/.test(offscreen)) return offscreen;
    return "";
  }

  function isNonPrimaryPrice(el) {
    if (!el) return true;
    if (el.classList && el.classList.contains("a-text-price")) return true;
    if (el.getAttribute && el.getAttribute("data-a-strike") === "true") return true;
    var size = (el.getAttribute && el.getAttribute("data-a-size")) || "";
    if (size === "mini" || size === "xs") return true;
    if (el.closest && el.closest(".pricePerUnit, .basisPrice, #promoPriceBlockMessage_feature_div, [data-a-strike='true'], .a-text-price")) {
      return true;
    }
    var parentText = getCleanText(el.parentElement);
    if (parentText && /\/\s*(?:count|item|unit|each|pack|pc|pcs|piece|100\s*g|100\s*ml|kg|lb|oz|fl\s*oz|l|ml|g|sheet|wipe|capsule|tablet)\b/i.test(parentText)) {
      return true;
    }
    return false;
  }

  function extractPrice(root) {
    // 1. 最高优先级：权威主售价容器 .priceToPay（直接在其内部读 whole+fraction 或 offscreen）
    var primaryContainers = [
      "#corePriceDisplay_desktop_feature_div .priceToPay",
      "#corePrice_feature_div .priceToPay",
      "#apex_desktop .priceToPay",
      ".priceToPay",
      "[data-cy='price-recipe'] .a-price:not(.a-text-price)",
    ];
    for (var i = 0; i < primaryContainers.length; i++) {
      var node = root.querySelector(primaryContainers[i]);
      if (node && !isNonPrimaryPrice(node)) {
        var val = readPriceFromNode(node);
        if (val) return val;
      }
    }

    // 2. 次级回退：扫描所有 .a-price，严格过滤划线原价、单价 ($1/count) 与 mini 字号
    var allPrices = root.querySelectorAll(
      "#corePriceDisplay_desktop_feature_div .a-price, #corePrice_feature_div .a-price, .a-price"
    );
    for (var j = 0; j < allPrices.length; j++) {
      if (isNonPrimaryPrice(allPrices[j])) continue;
      var candidate = readPriceFromNode(allPrices[j]);
      if (candidate) return candidate;
    }

    // 3. 经典老版 DOM 兜底
    var legacySelectors = ["#priceblock_ourprice", "#priceblock_dealprice", "#price_inside_buybox"];
    for (var k = 0; k < legacySelectors.length; k++) {
      var legacyEl = root.querySelector(legacySelectors[k]);
      var text = getCleanText(legacyEl);
      if (text && /\d/.test(text)) return text;
    }
    return "";
  }

  function extractListPrice(root) {
    var selectors = [
      ".basisPrice .a-text-price .a-offscreen",
      ".apex-basisprice-value .a-offscreen",
      ".apex-basisprice-value",
      ".a-text-price[data-a-strike='true'] .a-offscreen",
      ".a-text-price .a-offscreen",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i]);
      var text = getCleanText(el);
      if (text && /\d/.test(text)) return text;
    }
    return "";
  }

  function parseBoughtPastMonth(text) {
    if (!text) return null;
    var clean = String(text).replace(/,/g, " ").replace(/\s+/g, " ").trim();
    // 英文: "500+ bought in past month" / "1.5K+ bought in past month"
    var en = clean.match(/(\d+(?:\.\d+)?)\s*([KkMm])?\+?\s*(?:bought|purchased)\s+in\s+past\s+month/i);
    // 德文: "100+ Mal im letzten Monat gekauft"
    var de = clean.match(/(\d+(?:\.\d+)?)\s*([KkMm])?\+?\s*Mal\s+im\s+letzten\s+Monat/i);
    // 日文: "過去1か月で500点以上購入"
    var jp = clean.match(/過去1か月で\s*(\d+(?:\.\d+)?)\s*([KkMm万])?/);
    var m = en || de || jp;
    if (!m) return null;
    var base = Number(m[1]);
    if (!Number.isFinite(base) || base <= 0) return null;
    var unit = (m[2] || "").toLowerCase();
    if (unit === "k") base *= 1000;
    else if (unit === "m") base *= 1000000;
    else if (unit === "万") base *= 10000;
    return Math.round(base);
  }

  function extractBoughtPastMonth(root) {
    var direct = root.querySelector("#social-proofing-faceout-title-tk_bought, [data-cy='reviews-block'] + div, .a-row.a-size-base");
    if (direct) {
      var directVal = parseBoughtPastMonth(getCleanText(direct));
      if (directVal) return directVal;
    }
    var spans = root.querySelectorAll("span.a-size-base, span.a-color-secondary, #social-proofing-faceout-title-tk_bought span");
    for (var i = 0; i < spans.length; i++) {
      var val = parseBoughtPastMonth(getCleanText(spans[i]));
      if (val) return val;
    }
    return null;
  }

  function extractShippingFeeCents(root) {
    // 1. 优先读取 Amazon BuyBox 机器可读属性 data-csa-c-delivery-price（如 "$15.99" 或 "FREE"）
    var csaEls = root.querySelectorAll("[data-csa-c-delivery-price]");
    for (var c = 0; c < csaEls.length; c++) {
      var rawAttr = (csaEls[c].getAttribute("data-csa-c-delivery-price") || "").trim();
      if (!rawAttr) continue;
      if (/^free$/i.test(rawAttr)) return undefined;
      var attrNum = rawAttr.match(/(\d+(?:\.\d{1,2})?)/);
      if (attrNum) {
        var v = Number(attrNum[1]);
        if (Number.isFinite(v) && v > 0 && v < 500) return Math.round(v * 100);
      }
    }

    // 2. 匹配右侧 BuyBox 与搜索卡片中的 "$15.99 delivery Wednesday, 2 December" / "+ $9.99 shipping"
    var selectors = [
      "#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE",
      "#mir-layout-DELIVERY_BLOCK",
      "#deliveryBlockMessage",
      "#ourprice_shippingmessage",
      "#price-shipping-message",
      "#desktop_buybox",
      "#buybox",
      "[data-cy='delivery-recipe']",
      ".s-align-children-center",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var els = root.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) {
        var t = getCleanText(els[j]);
        if (!t || t.length > 600) continue;
        // 优先匹配明确的金额 + delivery/shipping（避免页面其他位置出现 FREE returns 误判）
        var m =
          t.match(/(?:\+\s*)?(?:A\$|CA\$|S\$|US\$|\$|£|€|¥)\s*(\d+(?:\.\d{1,2})?)\s*(?:delivery|shipping|postage|Versand|配送料)/i) ||
          t.match(/(?:delivery|shipping|postage)\s*(?:fee|cost)?\s*:?\s*(?:A\$|CA\$|S\$|US\$|\$|£|€|¥)\s*(\d+(?:\.\d{1,2})?)/i);
        if (m) {
          var val = Number(m[1]);
          if (Number.isFinite(val) && val > 0 && val < 500) {
            return Math.round(val * 100);
          }
        }
        // 免邮 / Prime 包邮直接返回 undefined（0）
        if (/\bFREE\s+(?:delivery|shipping)\b/i.test(t)) {
          return undefined;
        }
      }
    }
    return undefined;
  }

  function extractCouponText(root) {
    var selectors = [
      "[data-cy='coupon-badge']",
      ".s-coupon-unclipped",
      ".s-coupon-highlight-color",
      "#couponText",
      "#apex_desktop .promoPriceBlockMessage",
      "span[data-component-type='s-coupon-component']",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i]);
      var t = getCleanText(el);
      if (!t || !/(\d+\s*%|off|coupon|voucher|クーポン|Rabatt)/i.test(t)) continue;
      // 1. 详情页优先精确匹配单件优惠券 "Apply 5% coupon" / "Apply $5 voucher"，避免误抓满件折扣 "Save 6% on any 2"
      var applyCouponPct = t.match(/Apply\s+(\d{1,2}\s*%)\s*(?:coupon|voucher)/i);
      if (applyCouponPct) return applyCouponPct[1] + " off";
      var applyCouponAmt = t.match(/Apply\s+((?:A\$|CA\$|S\$|\$|£|€|¥)\s*\d+(?:\.\d{1,2})?)\s*(?:coupon|voucher)/i);
      if (applyCouponAmt) return "Save " + applyCouponAmt[1];
      // 跳过纯满件多买折扣（非单件优惠券）
      if (/on\s+any\s+\d+\s+qualifying/i.test(t) && !/coupon|voucher/i.test(t)) continue;
      // 2. 匹配明确百分比折扣或立减金额（Save 20% / Save $5 / $5 off）
      var pct = t.match(/(\d{1,2}\s*%)(?:\s*off)?/i);
      if (pct) return pct[1] + " off";
      var saveAmt = t.match(/(?:Save\s+|Apply\s+)((?:A\$|CA\$|S\$|\$|£|€|¥)\s*\d+(?:\.\d{1,2})?)/i);
      if (saveAmt) return "Save " + saveAmt[1];
      var offAmt = t.match(/((?:A\$|CA\$|S\$|\$|£|€|¥)\s*\d+(?:\.\d{1,2})?)\s*off/i);
      if (offAmt) return offAmt[1] + " off";
      // 3. 若是 "$18.99 with coupon"（券后直接标价），保留 "with coupon" 语义，避免被误当成立减金额
      var withCoupon = t.match(/((?:A\$|CA\$|S\$|\$|£|€|¥)\s*\d+(?:\.\d{1,2})?)\s*(?:with|after)\s+coupon/i);
      if (withCoupon) return withCoupon[1] + " with coupon";
    }
    return "";
  }

  function isSponsoredCard(card) {
    if (card.classList && card.classList.contains("AdHolder")) return true;
    if (card.querySelector("[data-component-type='sp-sponsored-result'], .puis-sponsored-label-text, .s-sponsored-label-info-icon")) {
      return true;
    }
    var spEl = card.querySelector("span.a-color-secondary, a.puis-label-popover");
    if (spEl) {
      var t = getCleanText(spEl);
      if (/^(Sponsored|Gesponsert|スポンサー)$/i.test(t)) return true;
    }
    return false;
  }

  function extractImageUrl(root, isSerp) {
    var img = isSerp
      ? root.querySelector("img.s-image")
      : root.querySelector("#landingImage, #imgBlkFront, #main-image, .imgTagWrapper img");
    if (!img) return "";
    return (img.getAttribute("data-old-hires") || img.getAttribute("src") || "").trim();
  }

  function extractFulfillmentType(doc) {
    var buybox = doc.querySelector("#tabular-buybox, #merchantInfoFeature_feature_div, #fulfillerInfoFeature_feature_div, #merchant-info");
    if (!buybox) return "unknown";
    var text = getCleanText(buybox);
    if (!text) return "unknown";
    // 检查 Sold by Amazon (1P 自营)
    if (/(?:Sold by|Verkauf durch|販売元)[:\s]*Amazon/i.test(text) || /Ships from and sold by Amazon/i.test(text)) {
      return "amazon_1p";
    }
    // 检查 Ships from Amazon / Fulfilled by Amazon (FBA)
    if (/(?:Ships from|Fulfilled by|Versand durch|出荷元)[:\s]*Amazon/i.test(text)) {
      return "fba";
    }
    if (/(?:Sold by|Ships from)/i.test(text)) {
      return "fbm";
    }
    return "unknown";
  }

  function extractDetailSpecs(doc) {
    var dateFirstAvailable = "";
    var dimensionsText = "";
    var rows = doc.querySelectorAll(
      "#productDetails_detailBullets_sections1 tr, #productDetails_techSpec_section_1 tr, #detailBullets_feature_div li, #detailBulletsWrapper_feature_div li"
    );
    rows.forEach(function (row) {
      var text = getCleanText(row);
      if (!text) return;
      if (!dateFirstAvailable && /(?:Date First Available|Im Angebot von Amazon|Amazon\.co\.jp での取り扱い開始日)/i.test(text)) {
        var valEl = row.querySelector("td, span:last-child");
        var val = getCleanText(valEl).replace(/^[:：\s\u200E\u200F]+/, "").trim();
        if (val && val.length <= 40) dateFirstAvailable = val;
      }
      if (!dimensionsText && /(?:Package Dimensions|Product Dimensions|Item Dimensions|Produktabmessungen|梱包サイズ|商品の寸法)/i.test(text)) {
        var dimEl = row.querySelector("td, span:last-child");
        var dim = getCleanText(dimEl).replace(/^[:：\s\u200E\u200F]+/, "").trim();
        if (dim && dim.length <= 80) dimensionsText = dim;
      }
    });
    return { dateFirstAvailable: dateFirstAvailable, dimensionsText: dimensionsText };
  }

  function extractRatingDistribution(doc) {
    var table = doc.querySelector("#histogramTable");
    if (!table) return null;
    var dist = {};
    var found = 0;
    var rows = table.querySelectorAll("tr, li");
    rows.forEach(function (row) {
      var text = getCleanText(row);
      var starMatch = text.match(/([1-5])\s*(?:star|Stern|つ星)/i);
      var pctMatch = text.match(/(\d{1,3})\s*%/);
      if (starMatch && pctMatch) {
        var star = Number(starMatch[1]);
        var pct = Number(pctMatch[1]);
        if (star >= 1 && star <= 5 && pct >= 0 && pct <= 100) {
          dist["star" + star] = pct;
          found += 1;
        }
      }
    });
    return found >= 3 ? dist : null;
  }

  // 识别站点
  var host = window.location.hostname;
  var marketCode = "US";
  var currency = "USD";
  if (/\.com\.au$/i.test(host)) { marketCode = "AU"; currency = "AUD"; }
  else if (/\.co\.uk$/i.test(host)) { marketCode = "GB"; currency = "GBP"; }
  else if (/\.de$/i.test(host)) { marketCode = "DE"; currency = "EUR"; }
  else if (/\.co\.jp$/i.test(host)) { marketCode = "JP"; currency = "JPY"; }
  else if (/\.ca$/i.test(host)) { marketCode = "CA"; currency = "CAD"; }
  else if (/\.sg$/i.test(host)) { marketCode = "SG"; currency = "SGD"; }

  // 1. 优先判断是否为搜索结果页（/s?k=...），避免页面内隐藏的 input[name='ASIN'] 误判成单品页
  var isSearchPage = /^\/s(?:\/|$)/i.test(window.location.pathname);
  var serpCards = document.querySelectorAll("[data-component-type='s-search-result'][data-asin], div.s-result-item[data-asin], [data-asin][data-index]");
  var urlAsinMatch = window.location.pathname.match(/(?:\/dp\/|\/gp\/product\/|\/product-reviews\/|\/ASIN\/|\/d\/)([B0-9][A-Z0-9]{9})/i);

  if (isSearchPage || (!urlAsinMatch && serpCards.length >= 2)) {
    var seen = {};
    var items = [];
    serpCards.forEach(function (card) {
      if (items.length >= 20) return;
      var cardAsin = (card.getAttribute("data-asin") || "").trim().toUpperCase();
      if (!cardAsin || !/^[A-Z0-9]{10}$/.test(cardAsin) || seen[cardAsin]) return;

      var brandEl = card.querySelector("[data-cy='title-recipe'] .a-color-secondary h2 span, [data-cy='title-recipe'] .a-color-secondary h2");
      var rawCardBrand = getCleanText(brandEl);
      var cardBrand = rawCardBrand && rawCardBrand.length <= 36 && !/sponsored/i.test(rawCardBrand) ? rawCardBrand : "";

      var titleEl = card.querySelector(
        "[data-cy='title-recipe'] a h2 span, [data-cy='title-recipe'] a h2, a h2 span, h2 a span, .a-size-medium.a-color-base.a-text-normal, .a-size-base-plus.a-color-base.a-text-normal, h2 span, h2"
      );
      var title = getCleanText(titleEl);
      if (!title) {
        var imgAlt = card.querySelector("img.s-image");
        if (imgAlt && imgAlt.getAttribute("alt")) title = imgAlt.getAttribute("alt").trim();
      }
      if (!title) return;

      var price = extractPrice(card);
      var listPrice = extractListPrice(card);
      var couponText = extractCouponText(card);
      var boughtPastMonth = extractBoughtPastMonth(card);
      var isSponsored = isSponsoredCard(card);
      var imageUrl = extractImageUrl(card, true);

      var ratingAriaEl = card.querySelector("a[aria-label*='out of 5'], i[aria-label*='out of 5']");
      var rating =
        (ratingAriaEl && ratingAriaEl.getAttribute("aria-label")) ||
        getCleanText(card.querySelector("[data-cy='reviews-block'] span.a-size-small.a-color-base")) ||
        getCleanText(card.querySelector("span.a-icon-alt, i[class*='a-star'] span"));

      var reviewAriaEl = card.querySelector("[data-cy='reviews-block'] a[aria-label*='rating'], a[aria-label*='rating'], [data-cy='reviews-block'] a[href*='customerReviews'][aria-label]:not([aria-label*='out of'])");
      var reviewCount =
        (reviewAriaEl && reviewAriaEl.getAttribute("aria-label")) ||
        getCleanText(card.querySelector("[data-cy='reviews-block'] a[href*='customerReviews'] span.s-underline-text, a[href*='#customerReviews'] span.a-size-base, .s-link-style .s-underline-text"));

      var shippingCents = extractShippingFeeCents(card);
      seen[cardAsin] = true;
      items.push({
        asin: cardAsin,
        url: window.location.origin + "/dp/" + cardAsin,
        brand: cardBrand || undefined,
        title: title,
        price: price,
        shippingCents: shippingCents,
        listPrice: listPrice || undefined,
        couponText: couponText || undefined,
        boughtPastMonth: boughtPastMonth || undefined,
        isSponsored: isSponsored,
        imageUrl: imageUrl || undefined,
        rating: rating,
        reviewCount: reviewCount,
      });
    });

    // 兜底：若 Amazon 改版不再挂 data-asin 容器，直接扫描页面中所有 /dp/ASIN 链接聚合
    if (items.length === 0) {
      var dpLinks = document.querySelectorAll("a[href*='/dp/']");
      dpLinks.forEach(function (a) {
        if (items.length >= 20) return;
        var m = (a.getAttribute("href") || "").match(/\/dp\/([B0-9][A-Z0-9]{9})/i);
        if (!m) return;
        var cardAsin = m[1].toUpperCase();
        if (seen[cardAsin]) return;
        var title = getCleanText(a);
        if (!title || title.length < 6) {
          var img = a.querySelector("img[alt]");
          if (img) title = (img.getAttribute("alt") || "").trim();
        }
        if (!title || title.length < 4) return;
        var container = a.closest("[data-asin], .s-result-item, .sg-col-inner, li") || a.parentElement;
        seen[cardAsin] = true;
        items.push({
          asin: cardAsin,
          url: window.location.origin + "/dp/" + cardAsin,
          title: title.slice(0, 180),
          price: container ? extractPrice(container) : "",
          imageUrl: container ? extractImageUrl(container, true) : "",
          boughtPastMonth: container ? extractBoughtPastMonth(container) : undefined,
          rating: container ? getCleanText(container.querySelector("span.a-icon-alt")) : "",
          reviewCount: "",
        });
      });
    }

    var searchInput = document.querySelector("#twotabsearchtextbox");
    var params = new URLSearchParams(window.location.search);
    var keyword = (searchInput && searchInput.value ? searchInput.value.trim() : "") || params.get("k") || "";

    return {
      mode: "serp",
      url: window.location.href,
      keyword: keyword,
      items: items,
      marketCode: marketCode,
      platformCode: "amazon",
      currency: currency,
    };
  }

  // 2. 单品详情页 / 评论页 ASIN 提取
  var asin = "";
  if (urlAsinMatch) {
    asin = urlAsinMatch[1].toUpperCase();
  } else {
    var asinInput = document.querySelector("#ASIN, input[name='ASIN']");
    if (asinInput && asinInput.value) asin = asinInput.value.trim().toUpperCase();
  }

  // 3. 单品详情页采集模式
  var breadcrumbs = [];
  var bcLinks = document.querySelectorAll("#wayfinding-breadcrumbs_feature_div ul li a, .a-breadcrumb li a");
  bcLinks.forEach(function (a) {
    var t = getCleanText(a);
    if (t && t !== "›") breadcrumbs.push(t);
  });
  var category = breadcrumbs.join(" > ");

  var titleEl = document.querySelector("#productTitle, #title");
  var title = getCleanText(titleEl);

  var brand = "";
  var brandEl = document.querySelector("#bylineInfo, a#bylineInfo");
  if (brandEl) {
    var rawBrand = getCleanText(brandEl);
    brand = rawBrand.replace(/^(Brand:|Visit the|Store)\s*/i, "").trim();
  }

  var price = extractPrice(document);
  var shippingCents = extractShippingFeeCents(document);
  var listPrice = extractListPrice(document);
  var couponText = extractCouponText(document);
  var boughtPastMonth = extractBoughtPastMonth(document);
  var imageUrl = extractImageUrl(document, false);
  var fulfillmentType = extractFulfillmentType(document);
  var detailSpecs = extractDetailSpecs(document);
  var ratingDistribution = extractRatingDistribution(document);

  var rating = "";
  var ratingEl = document.querySelector("#acrPopover, span.a-icon-alt");
  if (ratingEl) rating = getCleanText(ratingEl);

  var reviewCount = "";
  var reviewCountEl = document.querySelector("#acrCustomerReviewText");
  if (reviewCountEl) reviewCount = getCleanText(reviewCountEl);

  var bullets = [];
  var bulletEls = document.querySelectorAll("#feature-bullets ul li span.a-list-item");
  bulletEls.forEach(function (b) {
    var bt = getCleanText(b);
    if (bt && !bt.startsWith("Make sure this fits")) bullets.push(bt);
  });

  var criticalReviews = [];
  var seenReviews = {};
  function pushReview(text) {
    var clean = (text || "").replace(/\s+/g, " ").trim();
    if (!clean || clean.length < 15 || seenReviews[clean] || criticalReviews.length >= 8) return;
    seenReviews[clean] = true;
    criticalReviews.push(clean.slice(0, 320));
  }

  // A. 优先提取 Amazon 官方「Customers say」评论摘要与负向方面
  var summaryEl = document.querySelector("[data-hook='cr-insights-widget-summary'], #product-summary p, [data-csa-c-slot-id='cr-product-insights-cards'] p");
  if (summaryEl) {
    var summaryText = getCleanText(summaryEl);
    if (summaryText && summaryText.length >= 20) {
      pushReview("[Amazon 买家共识] " + summaryText);
    }
  }

  // B. 提取页面可见的买家评论卡片（优先 1~3 星差评，不足则补充其他可见评论）
  var reviewCards = document.querySelectorAll("[data-hook='review'], li[data-hook='review'], .review.aok-relative");
  var lowStarReviews = [];
  var otherReviews = [];
  reviewCards.forEach(function (card) {
    var starEl = card.querySelector(
      "[data-hook='review-star-rating'] .a-icon-alt, [data-hook='cmps-review-star-rating'] .a-icon-alt, i.review-rating .a-icon-alt, [aria-label*='out of 5'], .a-icon-alt"
    );
    var starText = (starEl && (starEl.getAttribute("aria-label") || getCleanText(starEl))) || "";
    var starMatch = starText.match(/(\d+(?:\.\d+)?)/);
    var starNum = starMatch ? Number(starMatch[1]) : null;

    var titleNode = card.querySelector(
      "[data-hook='reviewTitle'], [data-hook='review-title'] span:last-child, [data-hook='review-title']"
    );
    var bodyNode = card.querySelector(
      "[data-hook='reviewRichContentContainer'], [data-hook='reviewTextContainer'], [data-hook='reviewText'], [data-hook='review-body'] span, [data-hook='review-body'], [data-hook='review-collapsed'] span, [data-hook='review-collapsed'], .review-text-content span, .review-text-content"
    );
    var rTitle = getCleanText(titleNode).replace(/^\d+(?:\.\d+)?\s*out of\s*5\s*stars\s*/i, "").trim();
    var rBody = getCleanText(bodyNode).replace(/^Read more$/i, "").trim();
    var combined = [starNum ? "[" + starNum + "★]" : "", rTitle, rBody].filter(Boolean).join(" ");
    if (!combined || combined.length < 10) return;
    if (starNum !== null && starNum <= 3.5) {
      lowStarReviews.push(combined);
    } else {
      otherReviews.push(combined);
    }
  });
  lowStarReviews.forEach(pushReview);
  otherReviews.forEach(pushReview);

  // C. 兜底选择器：兼容新版 cardui 与旧版精简评论页 DOM
  if (criticalReviews.length === 0) {
    var fallbackEls = document.querySelectorAll(
      "[data-hook='reviewRichContentContainer'], [data-hook='reviewTextContainer'], [data-hook='review-collapsed'], [data-hook='review-body'], .review-text-content"
    );
    fallbackEls.forEach(function (r) {
      pushReview(getCleanText(r));
    });
  }

  return {
    mode: "detail",
    url: window.location.href,
    asin: asin,
    title: title,
    brand: brand,
    category: category,
    price: price,
    shippingCents: shippingCents,
    listPrice: listPrice || undefined,
    couponText: couponText || undefined,
    boughtPastMonth: boughtPastMonth || undefined,
    imageUrl: imageUrl || undefined,
    fulfillmentType: fulfillmentType,
    dateFirstAvailable: detailSpecs.dateFirstAvailable || undefined,
    dimensionsText: detailSpecs.dimensionsText || undefined,
    ratingDistribution: ratingDistribution || undefined,
    rating: rating,
    reviewCount: reviewCount,
    bullets: bullets,
    criticalReviews: criticalReviews,
    marketCode: marketCode,
    platformCode: "amazon",
    currency: currency,
  };
})();
