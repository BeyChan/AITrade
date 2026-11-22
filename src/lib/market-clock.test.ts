import assert from "node:assert/strict";
import { test } from "node:test";
import { getMarketClockSnapshot, getUpcomingCrossBorderMilestone } from "./market-clock.ts";

test("computes market local time and shopping window across timezones", () => {
  // 2026-11-22 00:30:00 UTC -> 美西(PST, UTC-8) 16:30（午后平稳），悉尼(AEDT, UTC+11) 11:30（上午起量）
  const sample = new Date("2026-11-22T00:30:00Z");

  const us = getMarketClockSnapshot("US", sample);
  assert.equal(us.cityLabel, "美西");
  assert.equal(us.timeText, "16:30");
  assert.equal(us.windowLabel, "午后平稳");
  assert.equal(us.offsetDiffText, "比北京时间慢 16 小时");

  const au = getMarketClockSnapshot("AU", sample);
  assert.equal(au.cityLabel, "悉尼");
  assert.equal(au.timeText, "11:30");
  assert.equal(au.windowLabel, "上午起量");
  assert.equal(au.offsetDiffText, "比北京时间快 3 小时");
});

test("computes upcoming cross-border milestone and sea freight cutoff", () => {
  // 2026 年黑五是 11 月第 4 个周四(11/26)次日 = 2026-11-27
  const nearBf = getUpcomingCrossBorderMilestone("US", new Date("2026-11-22T00:00:00Z"));
  assert.equal(nearBf.name, "黑五网一大促 (BFCM)");
  assert.equal(nearBf.dateText, "2026-11-27");
  assert.equal(nearBf.daysLeft, 5);
  assert.equal(nearBf.urgency, "urgent");

  // 2026-06-01 距 Prime Day(07-15) 44 天，US 35 天海运截单还剩 9 天 -> soon
  const beforePrime = getUpcomingCrossBorderMilestone("US", new Date("2026-06-01T00:00:00Z"));
  assert.equal(beforePrime.name, "Prime Day 会员日");
  assert.equal(beforePrime.daysLeft, 44);
  assert.equal(beforePrime.seaCutoffDaysLeft, 9);
  assert.equal(beforePrime.urgency, "soon");
});
