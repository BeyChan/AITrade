import test from "node:test";
import assert from "node:assert/strict";
import { scanListingCompliance } from "./compliance-radar.ts";

test("detects competitor brand trademarks in title and bullets", () => {
  const content = {
    brand: "MyBrand",
    title: "Upgraded Vacuum Cleaner Compatible with Dyson and Shark",
    bullets: ["Much better than Fanttik", "Great power", "Long cord", "Easy empty", "Washable"],
    description: "Good product",
    searchTerms: "vacuum",
  };

  const result = scanListingCompliance(content);
  assert.equal(result.passed, false);
  assert.ok(result.criticalCount >= 3);
  const words = result.findings.map((f) => f.word);
  assert.ok(words.includes("dyson"));
  assert.ok(words.includes("shark"));
  assert.ok(words.includes("fanttik"));
});

test("detects high-risk medical and FDA claims", () => {
  const content = {
    brand: "MyBrand",
    title: "FDA Approved Sanitizing Mop",
    bullets: ["Proven to cure back pain", "Kills virus", "Antibacterial cloth", "Clean fast", "Light"],
    description: "Good mop",
    searchTerms: "mop",
  };

  const result = scanListingCompliance(content);
  assert.equal(result.passed, false);
  const categories = result.findings.map((f) => f.category);
  assert.ok(categories.includes("medical_fda"));
});

test("passes clean listing with high score", () => {
  const content = {
    brand: "NordicHome",
    title: "Microfiber Flat Floor Mop with 3 Washable Replacement Pads",
    bullets: [
      "Heavy-duty stainless steel handle engineered for extended durability",
      "Highly absorbent microfiber pads effectively trap household dust and hair",
      "360-degree swivel head glides easily under low furniture",
      "Includes 3 machine washable reusable cleaning cloths",
      "Backed by dedicated customer support and standard warranty",
    ],
    description: "Professional cleaning solution for hardwood, tile and laminate flooring.",
    searchTerms: "floor mop cleaning supplies hardwood tile",
  };

  const result = scanListingCompliance(content);
  assert.equal(result.passed, true);
  assert.equal(result.criticalCount, 0);
  assert.equal(result.score, 100);
});
