"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatFxRate, setRuntimeFxRates } from "@/lib/currency";
import type { FxRatesSnapshot } from "@/lib/fx-rates";

export const FX_UPDATED_EVENT = "aitrade:fx-updated";

function syncRuntimeFromSnapshot(snapshot: FxRatesSnapshot) {
  const map: Record<string, number> = {};
  for (const item of snapshot.items) {
    map[item.currency] = item.rateToRmb;
  }
  setRuntimeFxRates(map);
}

function formatUpdatedLabel(isoOrDate: string | null): string {
  if (!isoOrDate) return "尚未同步";
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) return isoOrDate;
  const ts = Date.parse(isoOrDate);
  if (!Number.isFinite(ts)) return isoOrDate;
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

type TopbarFxWidgetProps = {
  currency: string;
  initialSnapshot: FxRatesSnapshot;
};

export function TopbarFxWidget({ currency, initialSnapshot }: TopbarFxWidgetProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<FxRatesSnapshot>(initialSnapshot);
  const [open, setOpen] = useState(false);
  const [reversed, setReversed] = useState(false);
  const [draftRate, setDraftRate] = useState("");
  const [busy, setBusy] = useState<"refresh" | "save" | "reset" | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoFetchedRef = useRef(false);

  const normalizedCurrency = (currency || "USD").toUpperCase();
  const currentItem = snapshot.byCurrency[normalizedCurrency] ?? snapshot.byCurrency.USD ?? snapshot.items[0];

  useEffect(() => {
    setSnapshot(initialSnapshot);
    syncRuntimeFromSnapshot(initialSnapshot);
  }, [initialSnapshot]);

  // 首次加载若实时汇率超过 6 小时未同步，后台静默拉取一次
  useEffect(() => {
    if (autoFetchedRef.current || !initialSnapshot.isLiveStale) return;
    autoFetchedRef.current = true;
    let cancelled = false;
    fetch("/api/settings/fx-rates?auto=1", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { snapshot?: FxRatesSnapshot; refreshed?: boolean } | null) => {
        if (cancelled || !data?.snapshot) return;
        setSnapshot(data.snapshot);
        syncRuntimeFromSnapshot(data.snapshot);
        window.dispatchEvent(new CustomEvent(FX_UPDATED_EVENT, { detail: data.snapshot }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialSnapshot.isLiveStale]);

  // 监听设置页或其他组件派发的汇率更新事件
  useEffect(() => {
    function onFxUpdated(event: Event) {
      const custom = event as CustomEvent<FxRatesSnapshot>;
      if (custom.detail?.byCurrency) {
        setSnapshot(custom.detail);
        syncRuntimeFromSnapshot(custom.detail);
      }
    }
    window.addEventListener(FX_UPDATED_EVENT, onFxUpdated);
    return () => window.removeEventListener(FX_UPDATED_EVENT, onFxUpdated);
  }, []);

  // 打开弹窗、切换币种或切换正反方向时同步输入框初始值
  useEffect(() => {
    if (open && currentItem) {
      const displayVal = reversed
        ? Number((1 / currentItem.rateToRmb).toFixed(4))
        : currentItem.rateToRmb;
      setDraftRate(String(displayVal));
      setFeedback(null);
    }
  }, [open, reversed, currentItem?.currency, currentItem?.rateToRmb]);

  // 点击外部或按 Esc 关闭弹窗
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!currentItem) return null;

  function applySnapshot(next: FxRatesSnapshot) {
    setSnapshot(next);
    syncRuntimeFromSnapshot(next);
    window.dispatchEvent(new CustomEvent(FX_UPDATED_EVENT, { detail: next }));
    router.refresh();
  }

  async function handleRefreshLive() {
    setBusy("refresh");
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/fx-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const data = (await res.json()) as { snapshot?: FxRatesSnapshot; refreshed?: boolean; error?: string };
      if (data.snapshot) {
        applySnapshot(data.snapshot);
      }
      if (!res.ok || data.error) {
        setFeedback({ tone: "err", text: data.error || "刷新失败" });
      } else {
        setFeedback({ tone: "ok", text: "已更新最新实时汇率" });
      }
    } catch {
      setFeedback({ tone: "err", text: "网络异常，暂时无法拉取实时汇率" });
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveManual(event: React.FormEvent) {
    event.preventDefault();
    const numeric = Number(draftRate);
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 10000) {
      setFeedback({ tone: "err", text: "请输入有效的正数汇率" });
      return;
    }
    const rateToRmb = reversed ? 1 / numeric : numeric;
    if (!Number.isFinite(rateToRmb) || rateToRmb <= 0 || rateToRmb > 10000) {
      setFeedback({ tone: "err", text: "换算后的汇率超出有效范围" });
      return;
    }
    setBusy("save");
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/fx-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_manual",
          currency: currentItem.currency,
          rateToRmb,
        }),
      });
      const data = (await res.json()) as { snapshot?: FxRatesSnapshot; error?: string };
      if (!res.ok || !data.snapshot) {
        setFeedback({ tone: "err", text: data.error || "保存失败" });
        return;
      }
      applySnapshot(data.snapshot);
      setFeedback({
        tone: "ok",
        text: reversed
          ? `已锁定 1 CNY = ${currentItem.symbol}${numeric}（1 ${currentItem.currency} = ¥${formatFxRate(currentItem.currency, rateToRmb)}）`
          : `已锁定 1 ${currentItem.currency} = ¥${formatFxRate(currentItem.currency, rateToRmb)}`,
      });
    } catch {
      setFeedback({ tone: "err", text: "保存失败，请重试" });
    } finally {
      setBusy(null);
    }
  }

  async function handleClearManual() {
    setBusy("reset");
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/fx-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clear_manual",
          currency: currentItem.currency,
        }),
      });
      const data = (await res.json()) as { snapshot?: FxRatesSnapshot; error?: string };
      if (!res.ok || !data.snapshot) {
        setFeedback({ tone: "err", text: data.error || "恢复失败" });
        return;
      }
      applySnapshot(data.snapshot);
      setFeedback({ tone: "ok", text: "已恢复跟随实时汇率" });
    } catch {
      setFeedback({ tone: "err", text: "操作失败，请重试" });
    } finally {
      setBusy(null);
    }
  }

  const modeLabel =
    currentItem.mode === "manual" ? "手动" : currentItem.mode === "live" ? "实时" : "基准";

  return (
    <div className="topbar-fx-widget" ref={containerRef}>
      <button
        type="button"
        className={`topbar-fx-trigger ${open ? "is-open" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`当前汇率 ${currentItem.currency}/CNY ${formatFxRate(currentItem.currency, currentItem.rateToRmb)}，点击查看或修改`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={`topbar-fx-dot is-${currentItem.mode}`} aria-hidden="true" />
        <span className="topbar-fx-pair">{currentItem.currency}/CNY</span>
        <strong className="topbar-fx-rate">{formatFxRate(currentItem.currency, currentItem.rateToRmb)}</strong>
        <span className={`topbar-fx-tag is-${currentItem.mode}`}>{modeLabel}</span>
      </button>

      {open ? (
        <div className="topbar-fx-popover" role="dialog" aria-label="实时汇率与手动修改">
          <div className="topbar-fx-pop-head">
            <div>
              <strong>
                {currentItem.name} · {currentItem.currency}/CNY
              </strong>
              <span className="topbar-fx-pop-meta">
                {currentItem.source} · {formatUpdatedLabel(currentItem.updatedAt)}
              </span>
            </div>
            <span className={`badge ${currentItem.mode === "manual" ? "badge-warn" : currentItem.mode === "live" ? "badge-success" : "badge-neutral"}`}>
              {currentItem.mode === "manual" ? "手动锁定" : currentItem.mode === "live" ? "实时汇率" : "官方基准"}
            </span>
          </div>

          <div className="topbar-fx-summary">
            <div className="topbar-fx-summary-row">
              <span>正向换算</span>
              <strong>
                1 {currentItem.currency} = ¥{formatFxRate(currentItem.currency, currentItem.rateToRmb)}
              </strong>
            </div>
            <div className="topbar-fx-summary-row">
              <span>反向换算</span>
              <strong>
                1 CNY = {currentItem.symbol}
                {Number((1 / currentItem.rateToRmb).toFixed(4))}
              </strong>
            </div>
            <div className="topbar-fx-summary-row">
              <span>实时参考</span>
              <span>
                {currentItem.liveRateToRmb !== null
                  ? reversed
                    ? `${currentItem.symbol}${Number((1 / currentItem.liveRateToRmb).toFixed(4))} (${formatUpdatedLabel(snapshot.liveUpdatedAt)})`
                    : `¥${formatFxRate(currentItem.currency, currentItem.liveRateToRmb)} (${formatUpdatedLabel(snapshot.liveUpdatedAt)})`
                  : "未拉取（点击下方刷新）"}
              </span>
            </div>
          </div>

          <form className="topbar-fx-form" onSubmit={handleSaveManual}>
            <div className="topbar-fx-form-head">
              <label htmlFor="topbar-fx-input">
                {reversed
                  ? `手动修改（1 CNY 折合 ${currentItem.currency}）`
                  : `手动修改（1 ${currentItem.currency} 折合 CNY）`}
              </label>
              <button
                type="button"
                className={`topbar-fx-swap-btn ${reversed ? "is-active" : ""}`}
                onClick={() => setReversed((prev) => !prev)}
              >
                ⇄ {reversed ? "正向" : "反向"}
              </button>
            </div>
            <div className="topbar-fx-input-row">
              <span className="topbar-fx-prefix">{reversed ? currentItem.symbol : "¥"}</span>
              <input
                id="topbar-fx-input"
                type="number"
                step="0.0001"
                min="0.0001"
                max="10000"
                value={draftRate}
                onChange={(e) => setDraftRate(e.target.value)}
                disabled={busy !== null}
                required
              />
              <button type="submit" className="button primary fx-btn-sm" disabled={busy !== null}>
                {busy === "save" ? "保存中…" : "保存"}
              </button>
            </div>
          </form>

          {feedback ? (
            <div className={`topbar-fx-feedback ${feedback.tone === "err" ? "is-error" : "is-ok"}`}>
              {feedback.text}
            </div>
          ) : null}

          <div className="topbar-fx-actions">
            <button
              type="button"
              className="button secondary fx-btn-sm"
              onClick={handleRefreshLive}
              disabled={busy !== null}
            >
              {busy === "refresh" ? "拉取中…" : "刷新实时汇率"}
            </button>
            {currentItem.mode === "manual" ? (
              <button
                type="button"
                className="button ghost fx-btn-sm"
                onClick={handleClearManual}
                disabled={busy !== null}
              >
                {busy === "reset" ? "恢复中…" : "恢复实时"}
              </button>
            ) : null}
            <Link
              href="/fx-rates"
              className="topbar-fx-all-link"
              onClick={() => setOpen(false)}
            >
              全部币种 →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
