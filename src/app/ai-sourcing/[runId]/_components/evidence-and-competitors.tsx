import type { CSSProperties } from "react";
import {
  autoImportCompetitorsAction,
  recordAISupplierQuoteAction,
  recordCompetitorAction,
  recordOpportunityEvidenceAction,
} from "@/app/actions";
import type { AISourcingHypothesisDetail } from "@/lib/ai-sourcing-repository";
import { compactNumber, moneyIn, percent, shortDate } from "@/lib/format";
import { isSyntheticCompetitorSource } from "@/lib/competitor-insights";
import { type BatchType, dateInputValue, dateTimeInputValue } from "./helpers";

export function EvidenceEntryForms({
  hypothesisId,
  runId,
  observedAt,
  marketCode = "US",
  conceptKeyword = "",
}: {
  hypothesisId: string;
  runId: string;
  observedAt: string;
  marketCode?: string;
  conceptKeyword?: string;
}) {
  const googlePatentUrl = `https://patents.google.com/?q=${encodeURIComponent(conceptKeyword || "product")}`;
  const usptoUrl = `https://ppubs.uspto.gov/pubwebapp/static/pages/ppubsbasic.html`;
  return (
    <>
      <details className="entry-panel card ai-entry-panel" id={`entry-review-${hypothesisId}`}>
        <summary><span><strong>录入差评痛点</strong><small>主题 + 样本数 + 代表性原话</small></span><span>＋</span></summary>
        <form action={recordOpportunityEvidenceAction} className="entry-form form-grid">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesisId} />
          <input type="hidden" name="evidenceType" value="review_insight" />
          <input type="hidden" name="sourceType" value="review_page" />
          <input type="hidden" name="observedAt" value={observedAt} />
          <input type="hidden" name="actor" value="运营人员" />
          <div className="field"><label>差评主题</label><input name="title" required maxLength={240} placeholder="例如：粘胶不牢易脱落" /></div>
          <div className="field">
            <label>差评样本数</label>
            <input name="reviewSampleSize" type="number" min="1" required placeholder="例如：25" />
          </div>
          <div className="field full">
            <label>代表性原文 / 痛点归纳</label>
            <textarea name="summary" rows={2} required maxLength={1500} placeholder="粘贴或归纳买家原话与可改进点" />
          </div>
          <div className="field full">
            <label>评论来源链接（选填）</label>
            <input name="sourceUrl" type="url" placeholder="https://www.amazon.com/product-reviews/..." />
          </div>
          <button className="button primary" type="submit">保存差评</button>
        </form>
      </details>

      <details className="entry-panel card ai-entry-panel" id={`entry-patent-${hypothesisId}`}>
        <summary><span><strong>专利与合规核验</strong><small>一键检索后直接点选结论</small></span><span>＋</span></summary>
        <form action={recordOpportunityEvidenceAction} className="entry-form form-grid">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesisId} />
          <input type="hidden" name="evidenceType" value="patent_check" />
          <input type="hidden" name="sourceType" value="patent_search" />
          <input type="hidden" name="observedAt" value={observedAt} />
          <input type="hidden" name="actor" value="运营人员" />
          <input type="hidden" name="title" value={`${marketCode} 专利检索核验`} />
          <div className="field full button-row">
            <a href={googlePatentUrl} target="_blank" rel="noreferrer" className="button secondary compact-button">
              Google Patents 检索 ↗
            </a>
            <a href={usptoUrl} target="_blank" rel="noreferrer" className="button secondary compact-button">
              USPTO 检索 ↗
            </a>
          </div>
          <RiskLevelField />
          <div className="field">
            <label>检索链接（选填）</label>
            <input name="sourceUrl" type="url" placeholder="选填，默认记检索页" />
          </div>
          <div className="field full">
            <label>核验备注</label>
            <input name="summary" required maxLength={1500} defaultValue="已完成外观与结构专利初筛，未发现阻断性侵权风险" />
          </div>
          <button className="button primary" type="submit">保存专利结论</button>
        </form>
      </details>

      <details className="entry-panel card ai-entry-panel" id={`entry-logistics-${hypothesisId}`}>
        <summary><span><strong>包装与物流核验</strong><small>体积重、限制与退货可执行性</small></span><span>＋</span></summary>
        <form action={recordOpportunityEvidenceAction} className="entry-form form-grid">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesisId} />
          <input type="hidden" name="evidenceType" value="logistics_check" />
          <input type="hidden" name="sourceType" value="logistics_check" />
          <input type="hidden" name="observedAt" value={observedAt} />
          <input type="hidden" name="actor" value="运营人员" />
          <input type="hidden" name="title" value={`${marketCode} 包装与物流核验`} />
          <RiskLevelField />
          <div className="field">
            <label>测算链接（选填）</label>
            <input name="sourceUrl" type="url" placeholder="选填" />
          </div>
          <div className="field full">
            <label>物流结论备注</label>
            <input name="summary" required maxLength={1500} defaultValue="标准件体积重可控，无危险品/超尺寸附加费限制" />
          </div>
          <button className="button primary" type="submit">保存物流结论</button>
        </form>
      </details>
    </>
  );
}

function RiskLevelField() {
  return (
    <div className="field">
      <label>人工结论</label>
      <select name="riskLevel" defaultValue="review" required>
        <option value="clear">无明显风险 / 可执行</option>
        <option value="review">仍需复核</option>
        <option value="found">发现阻断风险</option>
      </select>
    </div>
  );
}

export function CompetitorBenchmarkPanel({
  batch,
  hypothesis,
}: {
  batch: BatchType;
  hypothesis: AISourcingHypothesisDetail;
}) {
  const { benchmark } = hypothesis;
  const { coverage, price, distribution, themes, contradictions } = benchmark;
  const hasAnyEvidence = coverage.competitorCount > 0 || hypothesis.reviewInsights.length > 0;
  const priceBandLabel: Record<string, string> = {
    below_p25: "低于 P25（低价切入）",
    p25_to_p50: "P25–P50（主流偏低）",
    p50_to_p75: "P50–P75（主流价格带）",
    p75_to_p90: "P75–P90（中高溢价带）",
    above_p90: "高于 P90（高溢价风险区）",
  };
  const fieldLabel: Record<string, string> = {
    differentiator: "痛点与差异化",
    price: "定价合理性",
    margin: "市场中位价毛利可行性",
  };
  const verdictMeta = {
    supported: { label: "证据支持", badge: "badge-success" },
    unverified: { label: "待验证", badge: "status-review_pending" },
    contradicted: { label: "存在冲突", badge: "badge-danger" },
  } as const;

  return (
    <section className="ai-record-block benchmark-panel" aria-label="竞品画像与假设证伪">
      <div className="ai-validation-summary-head">
        <div>
          <span className="eyebrow">确定性竞品分析 · 证据对标</span>
          <h3>竞品画像与假设证伪</h3>
        </div>
        <div className="button-row">
          <span className="info-pill">
            {benchmark.scope.marketCode} · {benchmark.scope.platformCode} · {benchmark.scope.currency}
          </span>
          <span className={`badge ${coverage.sufficient ? "badge-success" : "status-review_pending"}`}>
            {coverage.sufficient ? "样本充足 · 可用于对标" : "样本不足 · 结论仅供参考"}
          </span>
        </div>
      </div>

      <div className="benchmark-coverage-strip">
        <div className={coverage.dedupedCount < 20 ? "warn" : ""}>
          <span>去重竞品 / 总快照</span>
          <strong>{coverage.dedupedCount} / {coverage.competitorCount}</strong>
          <small>门禁要求 ≥ 20（按 ASIN / URL 去重）</small>
        </div>
        <div className={coverage.priceBandCount < 2 ? "warn" : ""}>
          <span>价格分层覆盖</span>
          <strong>{coverage.priceBandCount} 档</strong>
          <small>分位计算建议覆盖 ≥ 2 档价格带</small>
        </div>
        <div className={coverage.themeCount < 2 || coverage.reviewSampleCount < 15 ? "warn" : ""}>
          <span>差评主题 / 样本</span>
          <strong>{coverage.themeCount} 个 / {coverage.reviewSampleCount} 条</strong>
          <small>建议 ≥ 2 主题 · 门禁 ≥ 15 样本</small>
        </div>
        <div>
          <span>来源 URL 齐备率</span>
          <strong>{percent(coverage.withSourceUrlRate)}</strong>
          <small>100% 可回溯真实网页</small>
        </div>
        <div className={(coverage.freshnessDaysP50 ?? 0) > 180 ? "warn" : ""}>
          <span>证据新鲜度中位数</span>
          <strong>{coverage.freshnessDaysP50 === null ? "—" : `${coverage.freshnessDaysP50} 天前`}</strong>
          <small>{(coverage.freshnessDaysP50 ?? 0) > 180 ? "中位采集时间超过 180 天" : "在 180 天有效期内"}</small>
        </div>
      </div>

      {!hasAnyEvidence ? (
          <div className="empty-inline benchmark-empty">
            <span>当前尚未录入竞品快照或差评证据，暂无法生成价格带分位与假设证伪结论。</span>
            <div className="button-row">
              <a href={`#auto-competitor-${hypothesis.id}`} className="button primary">基于站点 AI 智能导入竞品</a>
              <a href={`#competitor-entry-${hypothesis.id}`} className="button secondary">手动录入单条快照</a>
            </div>
          </div>
      ) : (
        <>
          <div className="benchmark-price-section">
            <div className="benchmark-price-head">
              <div>
                <strong>市场价格带分位（{batch.currency}）</strong>
                <span>
                  {price
                    ? `竞品 P50 ${moneyIn(batch.currency, price.p50)} · AI 建议价 ${moneyIn(batch.currency, hypothesis.recommendedPriceCents)}（参考，不参与 GO）· 位于 ${price.hypothesisPricePosition ? priceBandLabel[price.hypothesisPricePosition] : "—"}`
                    : "需录入有效竞品价格后计算分位"}
                </span>
              </div>
              {price ? (
                <a href={`/costing?hypothesisId=${encodeURIComponent(hypothesis.id)}`} className="button ghost">
                  去独立成本核算 →
                </a>
              ) : null}
            </div>

            {price ? (
              <div className="benchmark-percentile-grid">
                <div><span>Min 最低</span><strong>{moneyIn(batch.currency, price.min)}</strong></div>
                <div><span>P25</span><strong>{moneyIn(batch.currency, price.p25)}</strong></div>
                <div className="highlight"><span>P50 中位价</span><strong>{moneyIn(batch.currency, price.p50)}</strong></div>
                <div><span>P75</span><strong>{moneyIn(batch.currency, price.p75)}</strong></div>
                <div><span>P90</span><strong>{moneyIn(batch.currency, price.p90)}</strong></div>
                <div><span>Max 最高</span><strong>{moneyIn(batch.currency, price.max)}</strong></div>
              </div>
            ) : null}

            <div className="benchmark-distribution-row">
              <span>
                评分 P50：<strong>{distribution.ratingP50 !== null ? `${distribution.ratingP50}★` : "—"}</strong>
              </span>
              <span>
                评论数 P50：
                <strong>
                  {distribution.reviewCountP50 !== null
                    ? compactNumber(distribution.reviewCountP50)
                    : "—"}
                </strong>
              </span>
              <span>
                BSR P50：<strong>{distribution.bsrP50 !== null ? `#${compactNumber(distribution.bsrP50)}` : "未录入"}</strong>
              </span>
            </div>
          </div>

          <div className="benchmark-contradiction-list">
            <div className="benchmark-subhead">
              <strong>假设 vs 市场证据 · 3 行证伪矩阵</strong>
              <small>确定性交叉核对，只做风险揭示，不替代门禁</small>
            </div>
            <div className="benchmark-contradiction-rows">
              {contradictions.map((row) => {
                const meta = verdictMeta[row.verdict];
                return (
                  <article className={`benchmark-contradiction-row verdict-${row.verdict}`} key={row.field}>
                    <div className="benchmark-contradiction-claim">
                      <span className="eyebrow">{fieldLabel[row.field] ?? row.field}</span>
                      <strong>{row.assertion}</strong>
                    </div>
                    <div className="benchmark-contradiction-evidence">
                      <p>{row.note}</p>
                    </div>
                    <div className="benchmark-contradiction-verdict">
                      <span className={`badge ${meta.badge}`}>{meta.label}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          {themes.length > 0 ? (
            <div className="benchmark-themes">
              <div className="benchmark-subhead">
                <strong>高频差评主题（按权重与样本数排序）</strong>
                <small>点击来源可回溯原始评论页</small>
              </div>
              <div className="benchmark-theme-grid">
                {themes.slice(0, 4).map((theme) => (
                  <div className="benchmark-theme-card" key={theme.theme}>
                    <div className="benchmark-theme-top">
                      <strong>{theme.theme}</strong>
                      <span className="badge badge-neutral">{theme.sampleSize} 样本</span>
                    </div>
                    {theme.quote ? <p>“{theme.quote}”</p> : null}
                    {theme.sourceUrl ? (
                      <a href={theme.sourceUrl} target="_blank" rel="noreferrer">查看评论来源</a>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export function AutoCompetitorImportCard({
  batch,
  hypothesis,
}: {
  batch: BatchType;
  hypothesis: AISourcingHypothesisDetail;
}) {
  return (
    <details className="entry-panel card ai-entry-panel" id={`auto-competitor-${hypothesis.id}`}>
      <summary>
        <span>
          <strong>粘贴多行竞品文本 / CSV 批量导入</strong>
          <small>支持直接粘贴卖家精灵 / H10 / 搜索页复制的商品列表，自动计入真实竞品</small>
        </span>
        <span>＋</span>
      </summary>
      <form action={autoImportCompetitorsAction} className="entry-form stack">
        <input type="hidden" name="runId" value={batch.id} />
        <input type="hidden" name="hypothesisId" value={hypothesis.id} />
        <input type="hidden" name="actor" value="运营人员" />
        <div className="field full">
          <label>粘贴商品多行文本 / CSV / JSON</label>
          <textarea
            name="rawPayload"
            rows={5}
            required
            placeholder={"B08XYZ1234 Corner Shower Caddy $24.99 4.5 stars 1200 reviews\nB09ABC5678 Stainless Bathroom Shelf $29.99 4.3 850"}
          />
        </div>
        <button type="submit" className="button primary">批量解析并导入</button>
      </form>
    </details>
  );
}

export function CompetitorEntryForm({
  hypothesisId,
  runId,
  observedAt,
  currency,
}: {
  hypothesisId: string;
  runId: string;
  observedAt: string;
  currency: string;
}) {
  return (
    <details className="entry-panel card ai-entry-panel" id={`competitor-entry-${hypothesisId}`}>
      <summary><span><strong>录入真实竞品</strong><small>链接、价格、评论数、评分与观察时间</small></span><span>＋</span></summary>
      <form action={recordCompetitorAction} className="entry-form form-grid">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="hypothesisId" value={hypothesisId} />
        <div className="field full"><label>竞品标题</label><input name="title" required maxLength={240} /></div>
        <div className="field full"><label>竞品 URL</label><input name="sourceUrl" type="url" required placeholder="https://..." /></div>
        <div className="field"><label>ASIN / 商品 ID</label><input name="asin" maxLength={80} /></div>
        <div className="field"><label>价格（{currency}）</label><input name="price" type="number" min="0.01" step="0.01" required /></div>
        <div className="field"><label>评分</label><input name="rating" type="number" min="0" max="5" step="0.01" /></div>
        <div className="field"><label>评论数</label><input name="reviewCount" type="number" min="0" step="1" defaultValue="0" required /></div>
        <div className="field"><label>BSR</label><input name="bsr" type="number" min="1" step="1" /></div>
        <div className="field"><label>卖家数</label><input name="sellerCount" type="number" min="1" step="1" /></div>
        <div className="field"><label>变体数</label><input name="variationCount" type="number" min="1" step="1" /></div>
        <div className="field"><label>月销量下限（仅填平台可见值）</label><input name="monthlySalesMin" type="number" min="1" step="1" /></div>
        <div className="field"><label>月销量上限（仅填平台可见值）</label><input name="monthlySalesMax" type="number" min="1" step="1" /></div>
        <div className="field"><label>观察时间</label><input name="observedAt" type="datetime-local" defaultValue={observedAt} required /></div>
        <div className="field full"><label>录入人</label><input name="actor" defaultValue="运营人员" required maxLength={80} /></div>
        <button className="button primary" type="submit">记录竞品快照</button>
      </form>
    </details>
  );
}

export function SupplierQuoteEntryForm({
  hypothesisId,
  runId,
  observedAt,
  currency,
}: {
  hypothesisId: string;
  runId: string;
  observedAt: string;
  currency: string;
}) {
  return (
    <details className="entry-panel card ai-entry-panel" id={`supplier-quote-${hypothesisId}`}>
      <summary><span><strong>快速录入供应商报价</strong><small>填 4 个核心项，1688 人民币自动换算为 {currency}</small></span><span>＋</span></summary>
      <form action={recordAISupplierQuoteAction} className="entry-form form-grid">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="hypothesisId" value={hypothesisId} />
        <input type="hidden" name="currency" value={currency} />
        <input type="hidden" name="observedAt" value={observedAt} />
        <input type="hidden" name="actor" value="采购人员" />
        <div className="field"><label>供应商名称</label><input name="supplierName" required maxLength={180} placeholder="例如：义乌XX日用品厂" /></div>
        <div className="field"><label>1688 采购单价（¥ RMB）</label><input name="unitPriceRmb" type="number" min="0.1" step="0.1" required placeholder="自动按实时汇率换算" /></div>
        <div className="field"><label>MOQ（起订量）</label><input name="moq" type="number" min="1" step="1" defaultValue="200" required /></div>
        <div className="field"><label>交期（天）</label><input name="leadTimeDays" type="number" min="1" step="1" defaultValue="15" required /></div>
        <div className="field"><label>单件头程运费（{currency}）</label><input name="freightPerUnit" type="number" min="0" step="0.01" defaultValue="2.20" required /></div>
        <div className="field"><label>样品评分（0–100，拿样后填）</label><input name="sampleScore" type="number" min="0" max="100" step="1" placeholder="选填，≥80 达标" /></div>

        <details className="field full" style={{ borderTop: "1px dashed var(--line)", paddingTop: "10px" }}>
          <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>
            更多条款（链接 / 关税 / 样品费 / 付款条件，均为选填）
          </summary>
          <div className="form-grid" style={{ marginTop: "10px" }}>
            <div className="field"><label>平台</label><input name="supplierPlatform" defaultValue="1688" maxLength={60} /></div>
            <div className="field"><label>供应商 / 报价链接</label><input name="supplierUrl" type="url" placeholder="选填" /></div>
            <div className="field"><label>关税率 %</label><input name="dutyRate" type="number" min="0" max="100" step="0.01" defaultValue="0" /></div>
            <div className="field"><label>样品费（{currency}）</label><input name="sampleFee" type="number" min="0" step="0.01" defaultValue="0" /></div>
            <div className="field"><label>贸易条款</label><input name="incoterm" placeholder="EXW / FOB / DDP" maxLength={80} /></div>
            <div className="field"><label>付款条件</label><input name="paymentTerms" maxLength={200} placeholder="30% 定金 / 70% 发货前" /></div>
            <div className="field full"><label>产品匹配与认证备注</label><input name="productMatch" maxLength={500} placeholder="材质、规格、已有证书等" /></div>
          </div>
        </details>

        <div className="field full">
          <button className="button primary" type="submit">保存报价并重算 18% 门禁</button>
        </div>
      </form>
    </details>
  );
}

