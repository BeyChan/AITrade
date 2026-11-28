"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  AutoCandidateResult,
  AutoGrade,
  AutoPipelineRunSummary,
  DeliveryMethodCode,
  PlatformPipelineConfig,
} from "@/lib/auto-pipeline/types";

const GRADE_TABS: Array<{ key: AutoGrade | "ALL"; label: string }> = [
  { key: "ALL", label: "全部候选" },
  { key: "S", label: "S 级 · 优先找厂" },
  { key: "A", label: "A 级 · 复核报价" },
  { key: "B", label: "B 级 · 补扫竞品" },
  { key: "HOLD", label: "HOLD · 待观察" },
  { key: "ELIMINATED", label: "已淘汰" },
];

const DELIVERY_LABELS: Record<DeliveryMethodCode, string> = {
  flatfile_tsv: "Flat File TSV",
  shopify_csv: "Shopify Draft CSV",
  extension_autofill: "扩展半自动填表",
  api_draft: "官方 API 草稿",
};

function gradeBadgeStyle(grade: AutoGrade): React.CSSProperties {
  if (grade === "S") {
    return { background: "var(--good-soft)", color: "var(--good)", border: "1px solid var(--good)" };
  }
  if (grade === "A") {
    return { background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent)" };
  }
  if (grade === "B" || grade === "HOLD") {
    return { background: "var(--warn-soft)", color: "var(--warn)", border: "1px solid var(--warn)" };
  }
  return { background: "var(--bad-soft)", color: "var(--bad)", border: "1px solid var(--bad)" };
}

export function AutoPipelineClient(props: {
  initialConfigs: PlatformPipelineConfig[];
  initialRuns: AutoPipelineRunSummary[];
  initialCandidates: AutoCandidateResult[];
  initialPlatform: string;
  initialMarket: string;
}) {
  const [configs, setConfigs] = useState<PlatformPipelineConfig[]>(props.initialConfigs);
  const [runs, setRuns] = useState<AutoPipelineRunSummary[]>(props.initialRuns);
  const [candidates, setCandidates] = useState<AutoCandidateResult[]>(props.initialCandidates);

  const defaultConfigKey = `${props.initialPlatform}:${props.initialMarket}`;
  const [selectedConfigId, setSelectedConfigId] = useState<string>(
    props.initialConfigs.some((c) => c.id === defaultConfigKey)
      ? defaultConfigKey
      : (props.initialConfigs[0]?.id ?? "amazon:US"),
  );
  const [activeGrade, setActiveGrade] = useState<AutoGrade | "ALL">("ALL");
  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 新增自定义平台/站点弹窗表单
  const [newPlatformCode, setNewPlatformCode] = useState("");
  const [newMarketCode, setNewMarketCode] = useState("US");
  const [newCurrency, setNewCurrency] = useState("USD");

  const activeConfig = useMemo(
    () => configs.find((c) => c.id === selectedConfigId) ?? configs[0],
    [configs, selectedConfigId],
  );

  // 配置编辑态
  const [draftConfig, setDraftConfig] = useState<PlatformPipelineConfig | null>(null);

  const openEditor = () => {
    if (!activeConfig) return;
    setDraftConfig(structuredClone(activeConfig));
    setShowConfigEditor(true);
  };

  const refreshData = async () => {
    const res = await fetch("/api/auto-pipeline", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setConfigs(data.configs ?? []);
      setRuns(data.runs ?? []);
      setCandidates(data.candidates ?? []);
    }
  };

  const handleCsvUpload = async (file: File | null) => {
    if (!file || !activeConfig) return;
    setBusy(true);
    setFeedback(null);
    try {
      const csv = await file.text();
      const res = await fetch("/api/auto-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformCode: activeConfig.platformCode,
          marketCode: activeConfig.marketCode,
          sourceType: "csv",
          sourceLabel: file.name,
          csv,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "CSV 自动选品运行失败");
      setFeedback({
        kind: "ok",
        text: `已自动处理 ${data.run.totalSeeds} 条候选：S 级 ${data.run.sCount}、A 级 ${data.run.aCount}、B 级 ${data.run.bCount}、HOLD ${data.run.holdCount}、淘汰 ${data.run.eliminatedCount}（全部为估算快筛，人工补真实报价后才可签发 GO）。`,
      });
      await refreshData();
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "上传失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleScanInbox = async () => {
    if (!activeConfig) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/auto-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformCode: activeConfig.platformCode,
          marketCode: activeConfig.marketCode,
          sourceType: "inbox",
          inboxDir: activeConfig.inboxDir,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "扫描收件箱失败");
      setFeedback({
        kind: "ok",
        text: `已扫描 ${data.filesRead?.length ?? 0} 个 CSV 文件，共入池 ${data.run.totalSeeds} 条（S 级 ${data.run.sCount} / A 级 ${data.run.aCount}）。`,
      });
      await refreshData();
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "扫描失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!draftConfig) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/auto-pipeline/configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftConfig),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存配置失败");
      setShowConfigEditor(false);
      setFeedback({ kind: "ok", text: `已保存 ${data.config.label} 的选品费率、分级阈值与半自动上架策略。` });
      await refreshData();
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCustomPlatform = async () => {
    const p = newPlatformCode.trim().toLowerCase();
    const m = newMarketCode.trim().toUpperCase();
    if (!p || !m) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/auto-pipeline/configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformCode: p,
          marketCode: m,
          currency: newCurrency.trim().toUpperCase() || "USD",
          label: `${p.toUpperCase()} (${m})`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建平台配置失败");
      setNewPlatformCode("");
      await refreshData();
      setSelectedConfigId(data.config.id);
      setFeedback({ kind: "ok", text: `已新增平台配置 ${data.config.label}，后续可直接切换使用。` });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "新增失败" });
    } finally {
      setBusy(false);
    }
  };

  const handlePromote = async (candidateId: string) => {
    setPromotingId(candidateId);
    setFeedback(null);
    try {
      const res = await fetch(`/api/auto-pipeline/candidates/${encodeURIComponent(candidateId)}/promote`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "推进案卷失败");
      setFeedback({
        kind: "ok",
        text: data.alreadyExisted
          ? "该候选已关联正式商品案卷，已为你刷新入口。"
          : "已推进为正式商品案卷（初始状态 HOLD，待录真实报价并定标后可签发 GO）。",
      });
      await refreshData();
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "推进失败" });
    } finally {
      setPromotingId(null);
    }
  };

  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      if (activeConfig && (c.platformCode !== activeConfig.platformCode || c.marketCode !== activeConfig.marketCode)) {
        return false;
      }
      if (activeGrade !== "ALL" && c.grade !== activeGrade) return false;
      return true;
    });
  }, [candidates, activeConfig, activeGrade]);

  const gradeCounts = useMemo(() => {
    const map: Record<AutoGrade, number> = { S: 0, A: 0, B: 0, HOLD: 0, ELIMINATED: 0 };
    for (const c of candidates) {
      if (activeConfig && (c.platformCode !== activeConfig.platformCode || c.marketCode !== activeConfig.marketCode)) {
        continue;
      }
      map[c.grade] += 1;
    }
    return map;
  }, [candidates, activeConfig]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* 顶部标题与平台切换 */}
      <section
        style={{
          background: "var(--paper)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>
              自动选品池 · 多平台可配置流水线
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              无需 Keepa Key：支持卖家精灵/H10 CSV 上传、本地收件箱扫描与 Chrome 扩展一键推送。自动执行市场格局快筛、目标净利率采购上限反推与 S/A/B 分级；<strong>严禁自动签发 GO</strong>，人工核实报价并定标后进入半自动上架。
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={selectedConfigId}
              onChange={(e) => setSelectedConfigId(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--surface-subtle)",
                color: "var(--ink)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {configs.map((cfg) => (
                <option key={cfg.id} value={cfg.id}>
                  {cfg.label} ({cfg.currency})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={openEditor}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--surface-subtle)",
                color: "var(--ink)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              配置当前平台规则
            </button>
          </div>
        </div>

        {/* 快捷摄入操作区 */}
        {activeConfig && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              padding: 14,
              borderRadius: 10,
              background: "var(--surface-subtle)",
              border: "1px solid var(--line)",
            }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 8,
                background: "var(--accent)",
                color: "var(--paper)",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              <span>上传候选 CSV 自动跑批</span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  void handleCsvUpload(file);
                  e.target.value = "";
                }}
              />
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={handleScanInbox}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--paper)",
                color: "var(--ink)",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              扫描收件箱目录 ({activeConfig.inboxDir || `.data/inbox-csv/${activeConfig.platformCode}-${activeConfig.marketCode}`})
            </button>

            <div style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
              目标净利率门禁：<strong>{(activeConfig.economicsDefaults.targetMarginRate * 100).toFixed(0)}%</strong> · S 级线：<strong>≥{(activeConfig.thresholds.sGradeMinMargin * 100).toFixed(0)}%</strong> · 交付方式：{activeConfig.deliveryMethods.map((m) => DELIVERY_LABELS[m] || m).join(" / ")}
            </div>
          </div>
        )}

        {feedback && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              background: feedback.kind === "ok" ? "var(--good-soft)" : "var(--bad-soft)",
              color: feedback.kind === "ok" ? "var(--good)" : "var(--bad)",
              border: `1px solid ${feedback.kind === "ok" ? "var(--good)" : "var(--bad)"}`,
            }}
          >
            {feedback.text}
          </div>
        )}
      </section>

      {/* 平台规则配置编辑器 */}
      {showConfigEditor && draftConfig && (
        <section
          style={{
            background: "var(--paper)",
            border: "1px solid var(--accent)",
            borderRadius: 14,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>
              平台规则配置：{draftConfig.label}（{draftConfig.platformCode} / {draftConfig.marketCode}）
            </h2>
            <button
              type="button"
              onClick={() => setShowConfigEditor(false)}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              关闭
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              平台佣金率 (如 0.15)
              <input
                type="number"
                step="0.01"
                value={draftConfig.economicsDefaults.referralRate}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    economicsDefaults: { ...draftConfig.economicsDefaults, referralRate: Number(e.target.value) },
                  })
                }
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface-subtle)", color: "var(--ink)" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              目标净利率门禁 (如 0.18)
              <input
                type="number"
                step="0.01"
                value={draftConfig.economicsDefaults.targetMarginRate}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    economicsDefaults: { ...draftConfig.economicsDefaults, targetMarginRate: Number(e.target.value) },
                  })
                }
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface-subtle)", color: "var(--ink)" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              默认广告费率 (如 0.12)
              <input
                type="number"
                step="0.01"
                value={draftConfig.economicsDefaults.adRate}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    economicsDefaults: { ...draftConfig.economicsDefaults, adRate: Number(e.target.value) },
                  })
                }
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface-subtle)", color: "var(--ink)" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              S 级最低净利率 (如 0.24)
              <input
                type="number"
                step="0.01"
                value={draftConfig.thresholds.sGradeMinMargin}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    thresholds: { ...draftConfig.thresholds, sGradeMinMargin: Number(e.target.value) },
                  })
                }
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface-subtle)", color: "var(--ink)" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              最大评论中位数上限
              <input
                type="number"
                step="50"
                value={draftConfig.thresholds.maxMedianReviews}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    thresholds: { ...draftConfig.thresholds, maxMedianReviews: Number(e.target.value) },
                  })
                }
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface-subtle)", color: "var(--ink)" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              品牌 HHI 垄断上限
              <input
                type="number"
                step="100"
                value={draftConfig.thresholds.maxHhi}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    thresholds: { ...draftConfig.thresholds, maxHhi: Number(e.target.value) },
                  })
                }
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface-subtle)", color: "var(--ink)" }}
              />
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>新增其他平台/站点配置：</span>
              <input
                placeholder="平台码如 ebay / temu"
                value={newPlatformCode}
                onChange={(e) => setNewPlatformCode(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface-subtle)", color: "var(--ink)", width: 140, fontSize: 12 }}
              />
              <input
                placeholder="站点如 US/DE"
                value={newMarketCode}
                onChange={(e) => setNewMarketCode(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface-subtle)", color: "var(--ink)", width: 90, fontSize: 12 }}
              />
              <input
                placeholder="币种 USD"
                value={newCurrency}
                onChange={(e) => setNewCurrency(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface-subtle)", color: "var(--ink)", width: 80, fontSize: 12 }}
              />
              <button
                type="button"
                disabled={busy || !newPlatformCode.trim()}
                onClick={handleCreateCustomPlatform}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                  background: "var(--surface-subtle)",
                  color: "var(--ink)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                + 添加平台
              </button>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={handleSaveConfig}
              style={{
                padding: "8px 18px",
                borderRadius: 8,
                border: "none",
                background: "var(--accent)",
                color: "var(--paper)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              保存规则配置
            </button>
          </div>
        </section>
      )}

      {/* 分级统计与 Tab */}
      <section style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {GRADE_TABS.map((tab) => {
          const count =
            tab.key === "ALL"
              ? Object.values(gradeCounts).reduce((a, b) => a + b, 0)
              : gradeCounts[tab.key];
          const active = activeGrade === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveGrade(tab.key)}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                background: active ? "var(--accent-soft)" : "var(--paper)",
                color: active ? "var(--accent)" : "var(--ink)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </section>

      {/* 候选列表 */}
      <section
        style={{
          background: "var(--paper)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {filteredCandidates.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            当前平台/分级下暂无候选品。你可以点击上方「上传候选 CSV 自动跑批」，或在 Amazon 搜索页打开 Chrome 扩展点击「推送本页到自动选品池」。
          </div>
        ) : (
          filteredCandidates.map((item) => (
            <div
              key={item.id}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: 14,
                background: "var(--surface-subtle)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span
                    style={{
                      ...gradeBadgeStyle(item.grade),
                      padding: "2px 10px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {item.grade} 级
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
                    {item.externalId}
                  </span>
                  <strong style={{ fontSize: 14, color: "var(--ink)" }}>{item.title}</strong>
                  <span style={{ fontSize: 11, color: "var(--muted)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--line)" }}>
                    估算快筛 · {item.verdict}
                  </span>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <a
                    href={`/api/sourcing/1688-search?q=${encodeURIComponent(item.title.slice(0, 40))}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      padding: "6px 10px",
                      borderRadius: 7,
                      border: "1px solid var(--line)",
                      background: "var(--paper)",
                      color: "var(--ink)",
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    按 ≤¥{item.maxLandedCostCny.toFixed(1)} 去 1688 找厂
                  </a>

                  {item.promotedCaseId ? (
                    <Link
                      href={`/cases/${item.promotedCaseId}`}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 7,
                        background: "var(--good-soft)",
                        color: "var(--good)",
                        border: "1px solid var(--good)",
                        fontSize: 12,
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      查看正式案卷 →
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled={promotingId === item.id || item.grade === "ELIMINATED"}
                      onClick={() => void handlePromote(item.id)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 7,
                        border: "none",
                        background: item.grade === "ELIMINATED" ? "var(--line)" : "var(--accent)",
                        color: item.grade === "ELIMINATED" ? "var(--muted)" : "var(--paper)",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: item.grade === "ELIMINATED" ? "not-allowed" : "pointer",
                      }}
                    >
                      {promotingId === item.id ? "推进中…" : "推进为商品案卷"}
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
                <span>售价：<strong style={{ color: "var(--ink)" }}>{(item.priceCents / 100).toFixed(2)} {item.currency}</strong></span>
                <span>估算净利率：<strong style={{ color: "var(--ink)" }}>{(item.estimatedMarginRate * 100).toFixed(1)}%</strong></span>
                <span>机会分：<strong style={{ color: "var(--ink)" }}>{item.score}</strong></span>
                <span>达标采购天花板：<strong style={{ color: "var(--good)" }}>≤ ¥{item.maxLandedCostCny.toFixed(1)}</strong></span>
                <span>评论：{item.reviewCount.toLocaleString()} · 评分：{item.rating ?? "—"}</span>
                <span>品牌：{item.brand || "未识别"}</span>
              </div>

              {item.reasons.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {item.reasons.map((r, idx) => (
                    <span
                      key={`${item.id}-r-${idx}`}
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        borderRadius: 6,
                        background:
                          r.severity === "fail"
                            ? "var(--bad-soft)"
                            : r.severity === "warn"
                              ? "var(--warn-soft)"
                              : "var(--good-soft)",
                        color:
                          r.severity === "fail"
                            ? "var(--bad)"
                            : r.severity === "warn"
                              ? "var(--warn)"
                              : "var(--good)",
                      }}
                    >
                      {r.message}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {/* 最近批跑记录 */}
      {runs.length > 0 && (
        <section
          style={{
            background: "var(--paper)",
            border: "1px solid var(--line)",
            borderRadius: 14,
            padding: 16,
          }}
        >
          <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
            最近自动选品批跑记录
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "var(--muted)" }}>
            {runs.slice(0, 8).map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: "var(--surface-subtle)",
                }}
              >
                <span>
                  <strong style={{ color: "var(--ink)" }}>{r.platformCode.toUpperCase()} / {r.marketCode}</strong> · 来源 {r.sourceType}（{r.sourceLabel}）
                </span>
                <span>
                  共 {r.totalSeeds} 条 · S:{r.sCount} / A:{r.aCount} / B:{r.bCount} / HOLD:{r.holdCount} / 淘汰:{r.eliminatedCount}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
