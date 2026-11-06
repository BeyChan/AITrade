"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { recordSupplierCandidatesAction } from "@/app/actions";
import type { AISupplierCandidate } from "@/lib/ai-sourcing-repository";

export function SupplierCandidateImportForm({
  runId,
  hypothesisId,
  defaultQuery,
  autoReadClipboard = false,
}: {
  runId: string;
  hypothesisId: string;
  defaultQuery: string;
  autoReadClipboard?: boolean;
}) {
  const [payload, setPayload] = useState("");
  const [clipboardMessage, setClipboardMessage] = useState("");
  const autoReadAttempted = useRef(false);

  useEffect(() => {
    if (!autoReadClipboard || autoReadAttempted.current) return;
    autoReadAttempted.current = true;
    void readClipboard(true);
  }, [autoReadClipboard]);

  async function readClipboard(automatic = false) {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("剪贴板为空");
      setPayload(text);
      setClipboardMessage(`${automatic ? "已自动" : "已"}读取剪贴板内容（${text.length.toLocaleString("zh-CN")} 个字符），请确认后导入`);
    } catch (error) {
      setClipboardMessage(error instanceof Error
        ? `${automatic ? "自动读取未成功" : "读取失败"}：${error.message}。请点击按钮重试，或直接粘贴。`
        : "读取剪贴板失败，请手动粘贴");
    }
  }

  return (
    <form action={recordSupplierCandidatesAction} className="ai-candidate-capture-form">
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="hypothesisId" value={hypothesisId} />
      <div className="field">
        <label>本次搜索词</label>
        <input name="query" defaultValue={defaultQuery} maxLength={500} required />
      </div>
      <div className="field">
        <label>采集人</label>
        <input name="actor" defaultValue="采购人员" maxLength={80} required />
      </div>
      <div className="field full">
        <div className="ai-candidate-field-head">
          <label htmlFor="supplier-candidate-payload">采集结果</label>
          <button type="button" className="button secondary compact-button" onClick={() => void readClipboard()}>
            从剪贴板读取
          </button>
        </div>
        <textarea
          id="supplier-candidate-payload"
          name="payload"
          rows={7}
          required
          maxLength={500_000}
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          placeholder="点击上方“从剪贴板读取”，或直接粘贴书签/扩展复制的 JSON。也支持包含标题和 1688 商品链接的纯文本。"
        />
        {clipboardMessage ? <span className="help" role="status">{clipboardMessage}</span> : null}
      </div>
      <div className="field full ai-candidate-capture-actions">
        <span>导入后自动去重并评分。候选不会直接进入报价门禁，必须由你打开来源并人工核验。</span>
        <ImportButton />
      </div>
    </form>
  );
}

function ImportButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button primary" type="submit" disabled={pending}>
      {pending ? "正在解析…" : "导入并生成 TOP 10"}
    </button>
  );
}

export function SupplierCaptureTools({
  runId,
  hypothesisId,
  query,
}: {
  runId: string;
  hypothesisId: string;
  query: string;
}) {
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);
  const [origin, setOrigin] = useState("");
  const [bookmarkletSource, setBookmarkletSource] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/bookmarklet.js")
      .then((response) => {
        if (!response.ok) throw new Error("书签脚本加载失败");
        return response.text();
      })
      .then(setBookmarkletSource)
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "书签脚本加载失败"));
  }, []);

  const extensionConfig = useMemo(() => JSON.stringify({
    apiBase: origin ? `${origin}/api/supplier-candidates` : "",
    appOrigin: origin,
    runId,
    hypothesisId,
    query,
    actor: "采购人员",
  }, null, 2), [origin, runId, hypothesisId, query]);

  const bookmarkletHref = useMemo(() => {
    if (!origin || !bookmarkletSource) return "";
    const config = JSON.stringify({ appOrigin: origin, runId, hypothesisId });
    return `javascript:${bookmarkletSource.replace("__AITRADE_CONFIG__", config)}`;
  }, [origin, bookmarkletSource, runId, hypothesisId]);

  useEffect(() => {
    if (bookmarkletRef.current && bookmarkletHref) bookmarkletRef.current.href = bookmarkletHref;
  }, [bookmarkletHref]);

  async function copyText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(message);
    } catch {
      setStatus("复制失败，请手动选中复制");
    }
  }

  return (
    <div className="ai-capture-tools">
      <div className="ai-capture-tool-card primary-tool">
        <div>
          <span className="ai-capture-tool-step">推荐</span>
          <strong>Chrome 一键采集</strong>
          <p>复制当前方向的扩展配置，在扩展里粘贴一次。以后打开 1688 搜索结果页，点扩展就能直接导入本方向。</p>
        </div>
        <button
          type="button"
          className="button primary"
          onClick={() => copyText(extensionConfig, "扩展配置已复制。请在 AITrade 采集扩展中粘贴并保存。")}
          disabled={!origin}
        >
          复制扩展配置
        </button>
      </div>

      <div className="ai-capture-tool-card">
        <div>
          <span className="ai-capture-tool-step">免安装</span>
          <strong>1688 采集书签</strong>
          <p>把右侧按钮拖到浏览器书签栏。在 1688 当前搜索结果页点击它，会自动复制当前可见候选并打开本方向。</p>
        </div>
        <a
          ref={bookmarkletRef}
          className="button secondary"
          draggable
          href="#"
          onClick={(event) => {
            event.preventDefault();
            if (bookmarkletHref) void copyText(bookmarkletHref, "书签代码已复制。请新建书签，并把代码粘贴到网址栏。");
          }}
          aria-disabled={!bookmarkletHref}
        >
          拖我到书签栏
        </a>
      </div>
      <p className="ai-capture-tool-status" role="status" aria-live="polite">{status}</p>
    </div>
  );
}

export function SupplierCandidateComparison({ candidates }: { candidates: AISupplierCandidate[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const selected = candidates.filter((candidate) => selectedIds.includes(candidate.id));

  function toggle(candidateId: string) {
    setMessage("");
    setSelectedIds((current) => {
      if (current.includes(candidateId)) return current.filter((id) => id !== candidateId);
      if (current.length >= 4) {
        setMessage("最多同时对比 4 个候选，请先取消一个");
        return current;
      }
      return [...current, candidateId];
    });
  }

  if (candidates.length === 0) return null;

  return (
    <details className="ai-candidate-comparison">
      <summary>
        <span>对比候选</span>
        <small>选择 2–4 个，比较价格、MOQ、地区和风险</small>
        {selected.length > 0 ? <strong>已选 {selected.length}</strong> : null}
      </summary>
      <div className="ai-candidate-comparison-body">
        <div className="ai-candidate-comparison-picker">
          {candidates.map((candidate) => (
            <label key={candidate.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(candidate.id)}
                onChange={() => toggle(candidate.id)}
              />
              <span><strong>{candidate.title}</strong><small>{candidate.supplierName} · {candidate.score} 分</small></span>
            </label>
          ))}
        </div>
        {message ? <p className="ai-candidate-comparison-message" role="alert">{message}</p> : null}
        {selected.length >= 2 ? (
          <div className="ai-candidate-comparison-table-wrap">
            <table className="ai-candidate-comparison-table">
              <thead>
                <tr>
                  <th>维度</th>
                  {selected.map((candidate) => <th key={candidate.id}>{candidate.supplierName}</th>)}
                </tr>
              </thead>
              <tbody>
                <ComparisonRow label="商品" values={selected.map((candidate) => candidate.title)} />
                <ComparisonRow label="匹配分" values={selected.map((candidate) => `${candidate.score} / 100`)} />
                <ComparisonRow label="价格" values={selected.map((candidate) => formatMoney(candidate))} />
                <ComparisonRow label="MOQ" values={selected.map((candidate) => candidate.moq ? `${candidate.moq} 件` : "待确认")} />
                <ComparisonRow label="地区" values={selected.map((candidate) => candidate.location || "待确认")} />
                <ComparisonRow label="交期" values={selected.map((candidate) => candidate.leadTimeDays ? `${candidate.leadTimeDays} 天` : "待确认")} />
                <ComparisonRow label="标签" values={selected.map((candidate) => candidate.badges.join("、") || "无")} />
                <ComparisonRow label="风险" values={selected.map((candidate) => candidate.riskNotes.join("；") || "未标记")} />
                <ComparisonRow label="状态" values={selected.map((candidate) => candidate.status === "shortlisted" ? "已核验短名单" : "待人工核验")} />
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ai-candidate-comparison-hint">再选择 {Math.max(1, 2 - selected.length)} 个候选即可生成对比表。</p>
        )}
      </div>
    </details>
  );
}

function ComparisonRow({ label, values }: { label: string; values: string[] }) {
  return (
    <tr>
      <th>{label}</th>
      {values.map((value, index) => <td key={`${label}-${index}`}>{value}</td>)}
    </tr>
  );
}

function formatMoney(candidate: AISupplierCandidate) {
  if (candidate.priceCents === null) return "待确认";
  const amount = (candidate.priceCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 });
  return candidate.currency === "CNY" ? `¥${amount}` : `${candidate.currency} ${amount}`;
}
