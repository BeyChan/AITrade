(function () {
  function getCleanText(el) {
    if (!el) return "";
    return el.textContent.replace(/\s+/g, " ").trim();
  }

  function extractPrice(root) {
    var selectors = [
      "#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen",
      "#corePrice_feature_div .priceToPay .a-offscreen",
      ".priceToPay .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
      "#corePrice_feature_div .a-price .a-offscreen",
      ".a-price .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      "#price_inside_buybox",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i]);
      var text = getCleanText(el);
      if (text && /\d/.test(text)) return text;
    }
    var priceWrap = root.querySelector(".priceToPay, #corePriceDisplay_desktop_feature_div .a-price, .a-price");
    if (priceWrap) {
      var whole = getCleanText(priceWrap.querySelector(".a-price-whole")).replace(/[^\d]/g, "");
      var frac = getCleanText(priceWrap.querySelector(".a-price-fraction")).replace(/[^\d]/g, "");
      if (whole) return frac ? whole + "." + frac : whole;
    }
    return "";
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
      var ratingAriaEl = card.querySelector("a[aria-label*='out of 5'], i[aria-label*='out of 5']");
      var rating =
        (ratingAriaEl && ratingAriaEl.getAttribute("aria-label")) ||
        getCleanText(card.querySelector("[data-cy='reviews-block'] span.a-size-small.a-color-base")) ||
        getCleanText(card.querySelector("span.a-icon-alt, i[class*='a-star'] span"));

      var reviewAriaEl = card.querySelector("[data-cy='reviews-block'] a[aria-label*='rating'], a[aria-label*='rating'], [data-cy='reviews-block'] a[href*='customerReviews'][aria-label]:not([aria-label*='out of'])");
      var reviewCount =
        (reviewAriaEl && reviewAriaEl.getAttribute("aria-label")) ||
        getCleanText(card.querySelector("[data-cy='reviews-block'] a[href*='customerReviews'] span.s-underline-text, a[href*='#customerReviews'] span.a-size-base, .s-link-style .s-underline-text"));

      seen[cardAsin] = true;
      items.push({
        asin: cardAsin,
        url: window.location.origin + "/dp/" + cardAsin,
        brand: cardBrand || undefined,
        title: title,
        price: price,
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

    // 兼容 Amazon 2026 新版驼峰 cardui DOM（reviewTitle / reviewRichContentContainer）与经典横线 DOM（review-title / review-body）
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
    rating: rating,
    reviewCount: reviewCount,
    bullets: bullets,
    criticalReviews: criticalReviews,
    marketCode: marketCode,
    platformCode: "amazon",
    currency: currency,
  };
})();
