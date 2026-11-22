import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRssXml } from "./market-intel.ts";
import { describeAuditAction } from "./audit-logs.ts";

test("parseRssXml parses RSS 2.0 items, decodes CDATA and classifies categories", () => {
  const sampleXml = `
    <rss version="2.0">
      <channel>
        <item>
          <title><![CDATA[Amazon announces new FBA inbound fee policy for Q4]]></title>
          <link>https://example.com/amazon-fba-fee</link>
          <pubDate>Sun, 22 Nov 2026 00:15:00 GMT</pubDate>
        </item>
        <item>
          <title>US Customs updates de minimis tariff rule</title>
          <link>https://example.com/tariff-update</link>
          <pubDate>Sat, 21 Nov 2026 12:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>
  `;
  const items = parseRssXml(sampleXml, "TestFeed", "market", 5);
  assert.equal(items.length, 2);
  assert.equal(items[0].category, "policy");
  assert.equal(items[0].categoryLabel, "平台政策");
  assert.equal(items[1].category, "tariff");
  assert.equal(items[1].categoryLabel, "关税合规");
});

test("audit log metadata covers intel.feed_refreshed", () => {
  const meta = describeAuditAction("intel.feed_refreshed", "market_intel");
  assert.equal(meta.label, "刷新跨境行业快讯");
  assert.equal(meta.module, "ingestion");
});
