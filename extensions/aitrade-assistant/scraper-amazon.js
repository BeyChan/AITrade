(function () {
  function getCleanText(el) {
    if (!el) return "";
    return el.textContent.replace(/\s+/g, " ").trim();
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

  // 1. 尝试提取单品详情页 ASIN
  var asin = "";
  var asinMatch = window.location.pathname.match(/(?:\/dp\/|\/gp\/product\/|\/ASIN\/|\/d\/)([B0-9][A-Z0-9]{9})/i);
  if (asinMatch) {
    asin = asinMatch[1].toUpperCase();
  } else {
    var asinInput = document.querySelector("#ASIN, input[name='ASIN']");
    if (asinInput && asinInput.value) asin = asinInput.value.trim().toUpperCase();
  }

  // 2. 若当前是搜索结果页（SERP），一键采集当前页前 20 款可见竞品
  var serpCards = document.querySelectorAll("[data-component-type='s-search-result'][data-asin]");
  if (!asin && serpCards && serpCards.length > 0) {
    var seen = {};
    var items = [];
    serpCards.forEach(function (card) {
      if (items.length >= 20) return;
      var cardAsin = (card.getAttribute("data-asin") || "").trim().toUpperCase();
      if (!cardAsin || !/^[A-Z0-9]{10}$/.test(cardAsin) || seen[cardAsin]) return;

      var titleEl = card.querySelector("h2 a span, h2 span");
      var title = getCleanText(titleEl);
      if (!title) return;

      var priceEl = card.querySelector(".a-price .a-offscreen");
      var price = getCleanText(priceEl);
      var ratingEl = card.querySelector("span.a-icon-alt");
      var rating = getCleanText(ratingEl);
      var reviewEl = card.querySelector("span[aria-label] a span.a-size-base, a[href*='#customerReviews'] span.a-size-base, .s-link-style .s-underline-text");
      var reviewCount = getCleanText(reviewEl);

      seen[cardAsin] = true;
      items.push({
        asin: cardAsin,
        url: window.location.origin + "/dp/" + cardAsin,
        title: title,
        price: price,
        rating: rating,
        reviewCount: reviewCount,
      });
    });

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

  var price = "";
  var priceEl = document.querySelector(".a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, #corePrice_feature_div .a-offscreen");
  if (priceEl) price = getCleanText(priceEl);

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
  var reviewEls = document.querySelectorAll("[data-hook='review-collapsed'] span, [data-hook='review-body'] span");
  reviewEls.forEach(function (r) {
    var rt = getCleanText(r);
    if (rt && rt.length > 20 && criticalReviews.length < 5) {
      criticalReviews.push(rt.slice(0, 300));
    }
  });

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
