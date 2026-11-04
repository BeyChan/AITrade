import test from "node:test";
import assert from "node:assert/strict";
import { preflightListing, type ListingDraftContent } from "./listing.ts";

const validDraft: ListingDraftContent = {
  brand: "PawLab",
  title: "PawLab Quiet Pet Water Fountain with Easy-Clean Filter for Cats and Small Dogs",
  bullets: [
    "Whisper-quiet pump keeps nighttime noise low while your pet stays hydrated.",
    "Tool-free tray and filter access make weekly cleaning faster and easier.",
    "Visible water window helps you check the level without opening the lid.",
    "Stable non-slip base keeps the fountain in place on tile and hardwood floors.",
    "PawLab includes a starter filter and a clearly labeled replacement reminder.",
  ],
  description: "PawLab is a quiet, easy-clean pet fountain designed for everyday hydration at home.",
  searchTerms: "quiet pet fountain cat water dispenser easy clean filter small dog",
};

test("valid listing draft passes deterministic preflight", () => {
  const result = preflightListing(validDraft);
  assert.equal(result.passed, true);
  assert.equal(result.errorCount, 0);
  assert.equal(result.metrics.filledBulletCount, 5);
});

test("missing fields and incomplete bullets fail preflight", () => {
  const result = preflightListing({ ...validDraft, title: "", bullets: ["", "", "", "", ""], description: "" });
  assert.equal(result.passed, false);
  assert.ok(result.errorCount >= 3);
});

test("claim wording is surfaced as a warning, not silently accepted", () => {
  const result = preflightListing({ ...validDraft, title: `${validDraft.title} - 100% guaranteed` });
  assert.equal(result.passed, true);
  assert.ok(result.warningCount >= 2);
  assert.ok(result.findings.some((finding) => finding.field === "claims"));
});

test("search term byte limit is enforced for multilingual text", () => {
  const result = preflightListing({ ...validDraft, searchTerms: "宠物饮水器".repeat(30) });
  assert.equal(result.passed, false);
  assert.ok(result.findings.some((finding) => finding.code === "SEARCH_TERMS_TOO_LONG"));
});
