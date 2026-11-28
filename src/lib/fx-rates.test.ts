import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-fx-test-"));
process.env.PGLITE_DATA_DIR = dataDir;

const {
  clearManualFxRate,
  getEffectiveFxRate,
  getFxRatesSnapshot,
  setManualFxRate,
} = await import("./fx-rates.ts");
const { convertRmbToForeignCents, formatFxRate, getFxRate, OFFICIAL_FX_CONFIG } = await import("./currency.ts");
const { describeAuditAction, queryAuditLogs } = await import("./audit-logs.ts");
const { getDb } = await import("./db.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

test("loads default official FX rates and supports manual override and reset", async () => {
  const initial = await getFxRatesSnapshot();
  assert.equal(initial.byCurrency.USD.mode, "default");
  assert.equal(initial.byCurrency.USD.rateToRmb, OFFICIAL_FX_CONFIG.USD.rateToRmb);

  const afterSet = await setManualFxRate({ currency: "USD", rateToRmb: 7.35, actor: "测试员" });
  assert.equal(afterSet.byCurrency.USD.mode, "manual");
  assert.equal(afterSet.byCurrency.USD.rateToRmb, 7.35);
  assert.equal(afterSet.byCurrency.USD.manualRateToRmb, 7.35);
  assert.equal(getFxRate("USD"), 7.35);
  assert.equal(await getEffectiveFxRate("USD"), 7.35);
  assert.equal(convertRmbToForeignCents(73.5, "USD"), 1000);

  const afterReset = await clearManualFxRate({ currency: "USD", actor: "测试员" });
  assert.equal(afterReset.byCurrency.USD.mode, "default");
  assert.equal(afterReset.byCurrency.USD.manualRateToRmb, null);
  assert.equal(getFxRate("USD"), OFFICIAL_FX_CONFIG.USD.rateToRmb);

  const logs = await queryAuditLogs({ mode: "sandbox", module: "settings", pageSize: 10 });
  const setLog = logs.items.find((entry) => entry.action === "fx.manual_rate_set");
  const clearLog = logs.items.find((entry) => entry.action === "fx.manual_rate_cleared");
  assert.ok(setLog);
  assert.ok(clearLog);
  assert.equal(setLog.actionLabel, "手动锁定汇率");
  assert.equal(setLog.entityTypeLabel, "实时汇率");
  assert.equal(setLog.entityHref, "/fx-rates");
  assert.equal(clearLog.actionLabel, "恢复跟随实时汇率");
  assert.equal(describeAuditAction("fx.live_rates_refreshed", "fx_rate").label, "同步最新实时汇率");
});

test("validates currency code and rate range", async () => {
  await assert.rejects(
    () => setManualFxRate({ currency: "UNKNOWN", rateToRmb: 7.2 }),
    /暂不支持的币种/,
  );
  await assert.rejects(
    () => setManualFxRate({ currency: "USD", rateToRmb: 0 }),
    /有效汇率/,
  );
  await assert.rejects(
    () => setManualFxRate({ currency: "USD", rateToRmb: -3 }),
    /有效汇率/,
  );
});

test("formats FX rates with clean precision", () => {
  assert.equal(formatFxRate("USD", 7.22), "7.22");
  assert.equal(formatFxRate("USD", 7.2345), "7.2345");
  assert.equal(formatFxRate("JPY", 0.0475), "0.0475");
});
