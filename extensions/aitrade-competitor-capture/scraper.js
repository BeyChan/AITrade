(function () {
  function getCleanText(el) {
    if (!el) return "";
    return el.textContent.replace(/\s+/g, " ").trim();
  }

  // 1. 提取 ASIN
  var asin = "";
  var asinMatch = window.location.pathname.match(/(?:\/dp\/|\/gp\/product\/|\/ASIN\/|\/d\/)([B0-9][A-Z0-9]{9})/i);
  if (asinMatch) {
    asin = asinMatch[1].toUpperCase();
  } else {
    var asinInput = document.querySelector("#ASIN, input[name='ASIN']");
    if (asinInput && asinInput.value) asin = asinInput.value.trim().toUpperCase();
  }

  // 2. 提取面包屑分类 (如 Home > Household Cleaning Tools & Vacuums > Mops)
  var breadcrumbs = [];
  var bcLinks = document.querySelectorAll("#wayfinding-breadcrumbs_feature_div ul li a, .a-breadcrumb li a");
  bcLinks.forEach(function (a) {
    var t = getCleanText(a);
    if (t && t !== "›") breadcrumbs.push(t);
  });
  var category = breadcrumbs.join(" > ");

  // 3. 提取商品标题
  var titleEl = document.querySelector("#productTitle, #title");
  var title = getCleanText(titleEl);

  // 4. 提取品牌
  var brand = "";
  var brandEl = document.querySelector("#bylineInfo, a#bylineInfo");
  if (brandEl) {
    var rawBrand = getCleanText(brandEl);
    brand = rawBrand.replace(/^(Brand:|Visit the|Store)\s*/i, "").trim();
  }

  // 5. 提取价格
  var price = "";
  var priceEl = document.querySelector(".a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, #corePrice_feature_div .a-offscreen");
  if (priceEl) price = getCleanText(priceEl);

  // 6. 提取评分与评论量
  var rating = "";
  var ratingEl = document.querySelector("#acrPopover, span.a-icon-alt");
  if (ratingEl) rating = getCleanText(ratingEl);

  var reviewCount = "";
  var reviewCountEl = document.querySelector("#acrCustomerReviewText");
  if (reviewCountEl) reviewCount = getCleanText(reviewCountEl);

  // 7. 提取五点描述 (Bullet points)
  var bullets = [];
  var bulletEls = document.querySelectorAll("#feature-bullets ul li span.a-list-item");
  bulletEls.forEach(function (b) {
    var bt = getCleanText(b);
    if (bt && !bt.startsWith("Make sure this fits")) bullets.push(bt);
  });

  // 8. 提取买家差评关键句 (Top Critical Reviews)
  var criticalReviews = [];
  var reviewEls = document.querySelectorAll("[data-hook='review-collapsed'] span, [data-hook='review-body'] span");
  reviewEls.forEach(function (r) {
    var rt = getCleanText(r);
    if (rt && rt.length > 20 && criticalReviews.length < 5) {
      criticalReviews.push(rt.slice(0, 300));
    }
  });

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

  return {
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
