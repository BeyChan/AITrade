import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSupplierLeads,
  supplier1688SearchUrl,
  supplierAlibabaSearchUrl,
  supplierGoogleSearchUrl,
} from "./supplier-discovery.ts";

test("supplier discovery always returns exactly five unique leads", () => {
  const leads = buildSupplierLeads({
    concept: "宠物梳毛刷",
    category: "宠物用品",
    targetUser: "长毛犬猫家庭",
    supplierKeywords: ["宠物梳子 OEM", "宠物梳子 OEM", "  ", "自清洁宠物梳"],
  });

  assert.equal(leads.length, 5);
  assert.equal(new Set(leads.map((lead) => lead.query.toLocaleLowerCase("zh-CN"))).size, 5);
  assert.ok(leads.every((lead) => lead.role && lead.query && lead.note));
});

test("supplier discovery fills missing clues without inventing a supplier", () => {
  const leads = buildSupplierLeads({
    concept: "",
    category: "",
    supplierKeywords: [],
  });

  assert.equal(leads.length, 5);
  assert.equal(new Set(leads.map((lead) => lead.query)).size, 5);
  assert.ok(leads.every((lead) => /当前候选品|目标品类/.test(lead.query)));
});

test("supplier links are free search entry points", () => {
  const query = "宠物梳毛刷 OEM";
  assert.match(supplier1688SearchUrl(query), /^https:\/\/s\.1688\.com\//);
  assert.match(supplierAlibabaSearchUrl(query), /^https:\/\/www\.alibaba\.com\//);
  const google = new URL(supplierGoogleSearchUrl(query));
  assert.match(google.searchParams.get("q") ?? "", /工厂 OEM wholesale supplier/);
});

test("1688 search keywords use GBK percent encoding", () => {
  assert.equal(
    supplier1688SearchUrl("宠物除毛刷 硅胶"),
    "https://s.1688.com/selloffer/offer_search.htm?keywords=%B3%E8%CE%EF%B3%FD%C3%AB%CB%A2%20%B9%E8%BD%BA",
  );
  assert.equal(
    supplier1688SearchUrl("  OEM 宠物梳  "),
    "https://s.1688.com/selloffer/offer_search.htm?keywords=OEM%20%B3%E8%CE%EF%CA%E1",
  );
});
