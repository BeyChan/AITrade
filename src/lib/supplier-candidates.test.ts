import assert from "node:assert/strict";
import test from "node:test";
import { parseSupplierCandidatePayload } from "./supplier-candidates.ts";

test("structured current-page candidates are normalized, deduplicated and ranked", () => {
  const payload = JSON.stringify({
    source: "1688_visible_page",
    pageUrl: "https://s.1688.com/selloffer/offer_search.htm?keywords=pet",
    capturedAt: "2026-11-06T02:00:00.000Z",
    candidates: [
      {
        title: "宠物饮水机 静音水泵 OEM 跨境专供",
        supplierName: "深圳宠物电器工厂",
        supplierUrl: "https://shop.example.1688.com/",
        offerUrl: "https://detail.1688.com/offer/123456789.html?spm=a26352",
        price: "¥35.80-42.00",
        moq: "2件起批",
        badges: ["超级工厂", "深度验厂", "48小时发货"],
        location: "广东 深圳",
        sourceText: "宠物饮水机 静音水泵 OEM 跨境专供 超级工厂 48小时发货 2件起批",
      },
      {
        title: "宠物饮水机 静音水泵 OEM 跨境专供",
        supplierName: "深圳宠物电器工厂",
        offerUrl: "https://detail.1688.com/offer/123456789.html?spm=other",
        price: 35.8,
        moq: 2,
      },
      {
        title: "普通猫碗",
        supplierName: "陶瓷餐具店",
        offerUrl: "https://detail.1688.com/offer/987654321.html",
        price: 9.9,
        moq: 100,
      },
    ],
  });

  const result = parseSupplierCandidatePayload(payload, {
    query: "静音宠物饮水机",
    observedAt: "2026-11-06T02:00:00.000Z",
  });

  assert.equal(result.receivedCount, 3);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0]?.title, "宠物饮水机 静音水泵 OEM 跨境专供");
  assert.equal(result.candidates[0]?.offerId, "123456789");
  assert.equal(result.candidates[0]?.priceCents, 3580);
  assert.equal(result.candidates[0]?.moq, 2);
  assert.equal(result.candidates[0]?.currency, "CNY");
  assert.equal(result.candidates[0]?.supplierUrl, "https://shop.example.1688.com/");
  assert.equal(result.candidates[0]?.location, "广东 深圳");
  assert.deepEqual(result.candidates[0]?.badges, ["超级工厂", "深度验厂", "48小时发货"]);
  assert.ok((result.candidates[0]?.score ?? 0) > (result.candidates[1]?.score ?? 0));
  assert.equal(
    result.candidates[0]?.scoreParts.reduce((sum, part) => sum + part.points, 0),
    result.candidates[0]?.score,
  );
  assert.ok(result.candidates[0]?.riskNotes.some((note) => note.includes("价格区间")));
  assert.ok(!result.candidates[0]?.riskNotes.some((note) => note.includes("供应商主页")));
  assert.ok(!result.candidates[0]?.riskNotes.some((note) => note.includes("经营地区")));
});

test("text-only current-page capture still produces candidates", () => {
  const payload = `宠物饮水机 静音水泵 OEM
供应商：深圳宠物电器工厂
¥35.80 2件起批 广东深圳 48小时发货
https://detail.1688.com/offer/123456789.html

不锈钢猫碗
供应商：潮州陶瓷餐具厂
¥8.50 100件起批 广东潮州
https://detail.1688.com/offer/987654321.html`;

  const result = parseSupplierCandidatePayload(payload, { query: "宠物饮水机" });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0]?.offerId, "123456789");
  assert.equal(result.candidates[0]?.priceCents, 3580);
  assert.equal(result.candidates[0]?.moq, 2);
  assert.match(result.candidates[0]?.supplierName ?? "", /深圳宠物电器工厂/);
});

test("candidate scoring is deterministic and keeps at most ten results", () => {
  const candidates = Array.from({ length: 14 }, (_, index) => ({
    title: `宠物饮水机 跨境款 ${index + 1}`,
    supplierName: `工厂 ${index + 1}`,
    supplierUrl: `https://shop${index + 1}.example.com`,
    offerUrl: `https://detail.1688.com/offer/${100000 + index}.html`,
    price: 20 + index,
    moq: index + 1,
    sourceText: `宠物饮水机 跨境款 ${index + 1}`,
  }));
  const first = parseSupplierCandidatePayload(JSON.stringify({ candidates }), {
    query: "宠物饮水机",
    observedAt: "2026-11-06T02:00:00.000Z",
  });
  const second = parseSupplierCandidatePayload(JSON.stringify({ candidates }), {
    query: "宠物饮水机",
    observedAt: "2026-11-06T02:00:00.000Z",
  });

  assert.equal(first.candidates.length, 10);
  assert.deepEqual(
    first.candidates.map((candidate) => [candidate.fingerprint, candidate.score]),
    second.candidates.map((candidate) => [candidate.fingerprint, candidate.score]),
  );
});

test("invalid or empty captures fail before writing candidates", () => {
  assert.throws(() => parseSupplierCandidatePayload(""), /请粘贴采集结果/);
  assert.throws(() => parseSupplierCandidatePayload("这不是搜索结果"), /没有识别到候选商品/);
  assert.throws(() => parseSupplierCandidatePayload('{"candidates": [}'), /不是有效 JSON/);
});
