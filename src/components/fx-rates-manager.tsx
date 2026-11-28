"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatFxRate, setRuntimeFxRates } from "@/lib/currency";
import type { FxRateItem, FxRatesSnapshot } from "@/lib/fx-rates";
import { FX_UPDATED_EVENT } from "./topbar-fx-widget";

function syncRuntimeFromSnapshot(snapshot: FxRatesSnapshot) {
  const map: Record<string, number> = {};
  for (const item of snapshot.items) {
    map[item.currency] = item.rateToRmb;
  }
  setRuntimeFxRates(map, snapshot.mode);
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return "尚未拉取实时汇率";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

type FxDirection = "foreign_to_cny" | "cny_to_foreign";

function formatDisplayNumber(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return "—";
  if (val >= 100) return val.toFixed(2);
  if (val >= 10) return val.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  const fixed4 = val.toFixed(4);
  const trimmed = fixed4.replace(/0+$/, "");
  const dotIdx = trimmed.indexOf(".");
  if (dotIdx === -1) return `${trimmed}.00`;
  return trimmed.length - dotIdx - 1 < 2 ? val.toFixed(2) : trimmed;
}

function toDisplayRate(rateToRmb: number, direction: FxDirection): number {
  if (!Number.isFinite(rateToRmb) || rateToRmb <= 0) return 0;
  return direction === "foreign_to_cny" ? rateToRmb : Number((1 / rateToRmb).toFixed(4));
}

function buildDrafts(items: FxRateItem[], direction: FxDirection): Record<string, string> {
  return Object.fromEntries(
    items.map((item) => [item.currency, String(toDisplayRate(item.rateToRmb, direction))]),
  );
}

export function FxRatesManager({ initialSnapshot }: { initialSnapshot: FxRatesSnapshot }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<FxRatesSnapshot>(initialSnapshot);
  const [direction, setDirection] = useState<FxDirection>("foreign_to_cny");
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    buildDrafts(initialSnapshot.items, "foreign_to_cny"),
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setSnapshot(initialSnapshot);
    setDrafts(buildDrafts(initialSnapshot.items, direction));
    syncRuntimeFromSnapshot(initialSnapshot);
  }, [initialSnapshot, direction]);

  useEffect(() => {
    function onFxUpdated(event: Event) {
      const custom = event as CustomEvent<FxRatesSnapshot>;
      if (custom.detail?.items) {
        setSnapshot(custom.detail);
        setDrafts(buildDrafts(custom.detail.items, direction));
        syncRuntimeFromSnapshot(custom.detail);
      }
    }
    window.addEventListener(FX_UPDATED_EVENT, onFxUpdated);
    return () => window.removeEventListener(FX_UPDATED_EVENT, onFxUpdated);
  }, [direction]);

  function switchDirection(next: FxDirection) {
    setDirection(next);
    setDrafts(buildDrafts(snapshot.items, next));
    setFeedback(null);
  }

  function broadcastSnapshot(next: FxRatesSnapshot) {
    setSnapshot(next);
    setDrafts(buildDrafts(next.items, direction));
    syncRuntimeFromSnapshot(next);
    window.dispatchEvent(new CustomEvent(FX_UPDATED_EVENT, { detail: next }));
    router.refresh();
  }

  async function handleRefreshAll() {
    setBusyKey("refresh");
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/fx-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const data = (await res.json()) as { snapshot?: FxRatesSnapshot; error?: string };
      if (data.snapshot) broadcastSnapshot(data.snapshot);
      if (!res.ok || data.error) {
        setFeedback({ tone: "err", text: data.error || "刷新失败" });
      } else {
        setFeedback({ tone: "ok", text: "已刷新全部币种实时汇率（已手动锁定的币种保持不变）" });
      }
    } catch {
      setFeedback({ tone: "err", text: "网络异常，无法拉取实时汇率" });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSaveRow(item: FxRateItem) {
    const raw = Number(drafts[item.currency]);
    if (!Number.isFinite(raw) || raw <= 0 || raw > 10000) {
      setFeedback({ tone: "err", text: `${item.currency} 请输入有效的正数汇率` });
      return;
    }
    const rateToRmb = direction === "foreign_to_cny" ? raw : 1 / raw;
    if (!Number.isFinite(rateToRmb) || rateToRmb <= 0 || rateToRmb > 10000) {
      setFeedback({ tone: "err", text: `${item.currency} 换算后的汇率超出有效范围` });
      return;
    }
    setBusyKey(`save:${item.currency}`);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/fx-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_manual",
          currency: item.currency,
          rateToRmb,
        }),
      });
      const data = (await res.json()) as { snapshot?: FxRatesSnapshot; error?: string };
      if (!res.ok || !data.snapshot) {
        setFeedback({ tone: "err", text: data.error || "保存失败" });
        return;
      }
      broadcastSnapshot(data.snapshot);
      const savedText =
        direction === "foreign_to_cny"
          ? `1 ${item.currency} = ¥${formatFxRate(item.currency, rateToRmb)}`
          : `1 CNY = ${item.symbol}${formatDisplayNumber(raw)}（1 ${item.currency} = ¥${formatFxRate(item.currency, rateToRmb)}）`;
      setFeedback({
        tone: "ok",
        text: `已手动锁定 ${savedText}`,
      });
    } catch {
      setFeedback({ tone: "err", text: "保存失败，请重试" });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleResetRow(item: FxRateItem) {
    setBusyKey(`reset:${item.currency}`);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/fx-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clear_manual",
          currency: item.currency,
        }),
      });
      const data = (await res.json()) as { snapshot?: FxRatesSnapshot; error?: string };
      if (!res.ok || !data.snapshot) {
        setFeedback({ tone: "err", text: data.error || "恢复失败" });
        return;
      }
      broadcastSnapshot(data.snapshot);
      setFeedback({ tone: "ok", text: `${item.currency} 已恢复跟随实时汇率` });
    } catch {
      setFeedback({ tone: "err", text: "操作失败，请重试" });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section id="fx-rates" className="panel fx-manager-panel" aria-label="实时汇率与多币种基准设置">
      <div className="fx-manager-head">
        <div>
          <h2>多币种汇率列表</h2>
          <p className="muted">
            {snapshot.liveProvider || "离线官方基准"} · 上次同步：{formatSyncTime(snapshot.liveUpdatedAt)}
          </p>
        </div>
        <div className="fx-manager-head-actions">
          <div className="fx-dir-toggle" role="group" aria-label="汇率换算方向">
            <button
              type="button"
              className={`fx-dir-btn ${direction === "foreign_to_cny" ? "is-active" : ""}`}
              onClick={() => switchDirection("foreign_to_cny")}
            >
              1 外币 → CNY
            </button>
            <button
              type="button"
              className={`fx-dir-btn ${direction === "cny_to_foreign" ? "is-active" : ""}`}
              onClick={() => switchDirection("cny_to_foreign")}
            >
              1 CNY → 外币
            </button>
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={handleRefreshAll}
            disabled={busyKey !== null}
          >
            {busyKey === "refresh" ? "正在拉取实时汇率…" : "刷新全部实时汇率"}
          </button>
        </div>
      </div>

      {feedback ? (
        <div className={`fx-manager-banner ${feedback.tone === "err" ? "is-error" : "is-ok"}`}>
          {feedback.text}
        </div>
      ) : null}

      <div className="fx-table-wrap">
        <table className="fx-table">
          <thead>
            <tr>
              <th>币种</th>
              <th>{direction === "foreign_to_cny" ? "当前生效（1 外币 = CNY）" : "当前生效（1 CNY = 外币）"}</th>
              <th>实时参考</th>
              <th>状态 / 来源</th>
              <th>{direction === "foreign_to_cny" ? "手动修改（CNY）" : "手动修改（外币）"}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.items.map((item) => {
              const draft = drafts[item.currency] ?? String(toDisplayRate(item.rateToRmb, direction));
              const isSaving = busyKey === `save:${item.currency}`;
              const isResetting = busyKey === `reset:${item.currency}`;
              const effectiveDisplay =
                direction === "foreign_to_cny"
                  ? `¥${formatFxRate(item.currency, item.rateToRmb)}`
                  : `${item.symbol}${formatDisplayNumber(1 / item.rateToRmb)}`;
              const referenceDisplay =
                item.liveRateToRmb !== null
                  ? direction === "foreign_to_cny"
                    ? `¥${formatFxRate(item.currency, item.liveRateToRmb)}`
                    : `${item.symbol}${formatDisplayNumber(1 / item.liveRateToRmb)}`
                  : direction === "foreign_to_cny"
                    ? `基准 ¥${formatFxRate(item.currency, item.defaultRateToRmb)}`
                    : `基准 ${item.symbol}${formatDisplayNumber(1 / item.defaultRateToRmb)}`;
              return (
                <tr key={item.currency}>
                  <td>
                    <div className="fx-currency-cell">
                      <span className="fx-currency-symbol">{item.symbol}</span>
                      <div>
                        <strong>{item.currency}</strong>
                        <span>{item.name}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <strong className="fx-mono-val">{effectiveDisplay}</strong>
                  </td>
                  <td>
                    <span className="fx-mono-sub">{referenceDisplay}</span>
                  </td>
                  <td>
                    <div className="fx-status-cell">
                      <span
                        className={`badge ${
                          item.mode === "manual"
                            ? "badge-warn"
                            : item.mode === "live"
                              ? "badge-success"
                              : "badge-neutral"
                        }`}
                      >
                        {item.mode === "manual" ? "手动锁定" : item.mode === "live" ? "实时" : "官方基准"}
                      </span>
                      <small>{item.source}</small>
                    </div>
                  </td>
                  <td>
                    <div className="fx-edit-row">
                      <input
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        max="10000"
                        aria-label={`${item.currency} 折合人民币汇率`}
                        value={draft}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [item.currency]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleSaveRow(item);
                          }
                        }}
                        disabled={busyKey !== null}
                      />
                      <button
                        type="button"
                        className="button primary fx-btn-sm"
                        onClick={() => handleSaveRow(item)}
                        disabled={busyKey !== null}
                      >
                        {isSaving ? "保存…" : "保存"}
                      </button>
                      {item.mode === "manual" ? (
                        <button
                          type="button"
                          className="button ghost fx-btn-sm"
                          onClick={() => handleResetRow(item)}
                          disabled={busyKey !== null}
                        >
                          {isResetting ? "恢复…" : "恢复实时"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
