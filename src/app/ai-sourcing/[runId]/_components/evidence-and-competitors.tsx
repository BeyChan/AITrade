import type { CSSProperties } from "react";
import {
  autoImportCompetitorsAction,
  confirmHypothesisPriceAction,
  recordAISupplierQuoteAction,
  recordCompetitorAction,
  recordOpportunityEvidenceAction,
} from "@/app/actions";
import type { AISourcingHypothesisDetail } from "@/lib/ai-sourcing-repository";
import { compactNumber, moneyIn, percent, shortDate } from "@/lib/format";
import { isSyntheticCompetitorSource } from "@/lib/competitor-insights";
import { type BatchType, dateInputValue, dateTimeInputValue } from "./helpers";

export function EvidenceEntryForms({ hypothesisId, runId, observedAt }: { hypothesisId: string; runId: string; observedAt: string }) {
  return (
    <>
      <details className="entry-panel card ai-entry-panel" id={`entry-review-${hypothesisId}`}>
        <summary><span><strong>录入差评证据</strong><small>样本数 + 原文摘录 + 来源链接</small></span><span>＋</span></summary>
        <form action={recordOpportunityEvidenceAction} className="entry-form form-grid">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesisId} />
          <input type="hidden" name="evidenceType" value="review_insight" />
          <input type="hidden" name="sourceType" value="review_page" />
          <EvidenceCommonFields title="差评主题" summary="归纳用户不满和可改进点" observedAt={observedAt} />
          <div className="field">
            <label>差评样本数</label>
            <input name="reviewSampleSize" type="number" min="1" required placeholder="例如：50" />
          </div>
          <div className="field full">
            <label>代表性原文</label>
            <textarea name="representativeQuote" rows={2} maxLength={500} placeholder="粘贴实际评论原文，不要改写事实" />
          </div>
          <div className="field full">
            <label>录入人</label>
            <input name="actor" defaultValue="运营人员" required maxLength={80} />
          </div>
          <button className="button primary" type="submit">记录差评证据</button>
        </form>
      </details>

      <details className="entry-panel card ai-entry-panel" id={`entry-patent-${hypothesisId}`}>
        <summary><span><strong>录入专利风险</strong><small>人工检索结果，不生成法律结论</small></span><span>＋</span></summary>
        <form action={recordOpportunityEvidenceAction} className="entry-form form-grid">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesisId} />
          <input type="hidden" name="evidenceType" value="patent_check" />
          <input type="hidden" name="sourceType" value="patent_search" />
          <EvidenceCommonFields title="专利检查结论" summary="记录检索范围、关键词和实际结论" observedAt={observedAt} />
          <RiskLevelField />
          <div className="field full"><label>录入人</label><input name="actor" defaultValue="运营人员" required maxLength={80} /></div>
          <button className="button primary" type="submit">记录专利证据</button>
        </form>
      </details>

      <details className="entry-panel card ai-entry-panel" id={`entry-logistics-${hypothesisId}`}>
        <summary><span><strong>录入物流风险</strong><small>包装、体积重、限制与退货</small></span><span>＋</span></summary>
        <form action={recordOpportunityEvidenceAction} className="entry-form form-grid">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesisId} />
          <input type="hidden" name="evidenceType" value="logistics_check" />
          <input type="hidden" name="sourceType" value="logistics_check" />
          <EvidenceCommonFields title="物流检查结论" summary="记录真实包装、重量、限制和可执行性" observedAt={observedAt} />
          <RiskLevelField />
          <div className="field full"><label>录入人</label><input name="actor" defaultValue="运营人员" required maxLength={80} /></div>
          <button className="button primary" type="submit">记录物流证据</button>
        </form>
      </details>
    </>
  );
}

function EvidenceCommonFields({ title, summary, observedAt }: { title: string; summary: string; observedAt: string }) {
  return (
    <>
      <div className="field full"><label>证据标题</label><input name="title" required maxLength={240} placeholder={title} /></div>
      <div className="field full"><label>来源 URL</label><input name="sourceUrl" type="url" required placeholder="https://..." /></div>
      <div className="field"><label>观察时间</label><input name="observedAt" type="datetime-local" defaultValue={observedAt} required /></div>
      <div className="field full"><label>证据摘要</label><textarea name="summary" rows={3} required maxLength={1500} placeholder={summary} /></div>
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
        <div className={coverage.themeCount < 2 || coverage.reviewSampleCount < 50 ? "warn" : ""}>
          <span>差评主题 / 样本</span>
          <strong>{coverage.themeCount} 个 / {coverage.reviewSampleCount} 条</strong>
          <small>建议 ≥ 2 主题 · 门禁 ≥ 50 样本</small>
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
                    ? hypothesis.confirmedPriceCents
                      ? `已确认售价 ${moneyIn(batch.currency, hypothesis.confirmedPriceCents)} · 位于 ${price.hypothesisPricePosition ? priceBandLabel[price.hypothesisPricePosition] : "—"}`
                      : `AI 建议价 ${moneyIn(batch.currency, hypothesis.recommendedPriceCents)}（未确认）· 位于 ${price.hypothesisPricePosition ? priceBandLabel[price.hypothesisPricePosition] : "—"}`
                    : "需录入有效竞品价格后计算分位"}
                </span>
              </div>
              {price ? (
                <a href={`#confirm-price-${hypothesis.id}`} className="button ghost">
                  参考 P50（{moneyIn(batch.currency, price.p50)}）去确认售价
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
  const defaultQuery = hypothesis.competitorQueries[0] || hypothesis.concept;
  return (
    <section className="card ai-auto-competitor-card" id={`auto-competitor-${hypothesis.id}`}>
      <div className="ai-validation-summary-head">
        <div>
          <span className="eyebrow">站点级竞品分析 · AI 智能与批量导入</span>
          <h3>基于当前国家与站点批量生成竞品素材</h3>
          <p>
            绑定 <strong>{batch.marketName}站（{batch.marketCode}）· {batch.platformName}</strong> 平台与币种 <strong>{batch.currency}</strong>。
            AI / 本地模板按品类推演 10~25 款对标竞品的价格带、ASIN、评分与差评主题，用于快速铺开分析框架。
          </p>
          <div className="result-box warning" style={{ marginTop: "10px", fontSize: "12px", lineHeight: "1.5" }} role="status">
            <strong>这些是待核实素材，不是真实市场证据。</strong>批量生成的 ASIN、价格、评分、评论数与差评原话均由系统推演，一律标记为 AI / 模板来源，<strong>不计入 GO 门禁的竞品数与差评样本，也不进入价格分位</strong>。请用下方「粘贴表格批量导入」或浏览器采集扩展补录真实证据；「粘贴表格」导入的内容才作为人工证据参与门禁。
          </div>
        </div>
        <span className="badge badge-neutral">{batch.marketCode} · {batch.currency}</span>
      </div>

      <div className="ai-auto-competitor-forms">
        <form action={autoImportCompetitorsAction} className="ai-auto-competitor-direct form-grid">
          <input type="hidden" name="runId" value={batch.id} />
          <input type="hidden" name="hypothesisId" value={hypothesis.id} />
          <div className="field">
            <label>站点检索核心词</label>
            <input
              name="query"
              defaultValue={defaultQuery}
              placeholder="例如：pet water fountain stainless steel"
              maxLength={200}
              required
            />
          </div>
          <div className="field">
            <label>生成竞品素材数量（不计入门禁）</label>
            <select name="targetCount" defaultValue="20">
              <option value="10">10 款待核实素材</option>
              <option value="15">15 款待核实素材</option>
              <option value="20">20 款待核实素材</option>
              <option value="25">25 款待核实素材</option>
            </select>
          </div>
          <div className="field">
            <label>操作人</label>
            <input name="actor" defaultValue="运营人员" maxLength={80} required />
          </div>
          <div className="field full ai-auto-competitor-checks">
            <label className="check-row">
              <input type="checkbox" name="includeReviews" value="true" defaultChecked />
              <span>同步生成该站点代表性差评痛点洞察（自动写入差评样本，激活假设证伪与内容卖点对标）</span>
            </label>
          </div>
          <div className="field full button-row">
            <button type="submit" className="button primary">
              🚀 基于当前站点 AI 一键导入竞品与差评包
            </button>
            <small className="muted">
              免 API Key 模板模式或已配置的 LLM 会自动适配目标站点语言、ASIN/URL 与价格带。
            </small>
          </div>
        </form>

        <details className="ai-auto-competitor-paste">
          <summary>
            <strong>方式二：从网页/插件复制多条文本或 CSV 批量粘贴导入</strong>
            <small>支持粘贴包含多条 ASIN、标题、价格、评分的任意纯文本或表格</small>
          </summary>
          <form action={autoImportCompetitorsAction} className="stack" style={{ marginTop: 12 }}>
            <input type="hidden" name="runId" value={batch.id} />
            <input type="hidden" name="hypothesisId" value={hypothesis.id} />
            <input type="hidden" name="actor" value="运营人员" />
            <div className="field full">
              <label>粘贴商品多行文本 / CSV / JSON</label>
              <textarea
                name="rawPayload"
                rows={5}
                required
                placeholder="粘贴包含商品信息的多行文本，例如：&#10;B08XYZ1234 Pet Water Fountain 2.5L $24.99 4.3 stars 1200 reviews&#10;B09ABC5678 Stainless Steel Dog Cat Fountain $29.99 4.1 850&#10;或直接粘贴从平台搜索页复制的商品列表。"
              />
            </div>
            <button type="submit" className="button secondary">批量解析并导入当前假设</button>
          </form>
        </details>
      </div>
    </section>
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

export function ConfirmPriceForm({ hypothesisId, runId, currency }: { hypothesisId: string; runId: string; currency: string }) {
  return (
    <details className="entry-panel card ai-entry-panel" id={`confirm-price-${hypothesisId}`}>
      <summary><span><strong>确认售价</strong><small>依据真实竞品价格带；利润门禁只使用这里的价格</small></span><span>＋</span></summary>
      <form action={confirmHypothesisPriceAction} className="entry-form form-grid">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="hypothesisId" value={hypothesisId} />
        <div className="field"><label>已确认售价（{currency}）</label><input name="price" type="number" min="0.01" step="0.01" required /></div>
        <div className="field full"><label>依据链接（竞品页、价格带记录等）</label><input name="sourceUrl" type="url" required placeholder="https://..." /></div>
        <div className="field full"><label>录入人</label><input name="actor" defaultValue="运营人员" required maxLength={80} /></div>
        <button className="button primary" type="submit">记录已确认售价</button>
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
      <summary><span><strong>录入供应商真实报价</strong><small>采购价、运费、关税、MOQ、交期、样品分</small></span><span>＋</span></summary>
      <form action={recordAISupplierQuoteAction} className="entry-form form-grid">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="hypothesisId" value={hypothesisId} />
        <div className="form-section-label full">供应商身份</div>
        <div className="field"><label>供应商名称</label><input name="supplierName" required maxLength={180} /></div>
        <div className="field"><label>平台</label><input name="supplierPlatform" placeholder="1688 / Alibaba / 工厂直联" defaultValue="1688" maxLength={60} /></div>
        <div className="field"><label>供应商主页 URL</label><input name="supplierUrl" type="url" required /></div>
        <div className="field"><label>联系方式</label><input name="contact" maxLength={180} placeholder="仅记录你已获得的公开或合法联系方式" /></div>
        <div className="field"><label>国家 / 地区</label><input name="country" maxLength={60} /></div>
        <div className="field"><label>产品匹配说明</label><input name="productMatch" maxLength={500} placeholder="材质、规格、结构、包装差异" /></div>
        <div className="form-section-label full">报价与成本（{currency}）</div>
        <div className="field"><label>采购单价（{currency}）</label><input name="unitPrice" type="number" min="0.01" step="0.01" required /></div>
        <div className="field"><label>单件运费（{currency}）</label><input name="freightPerUnit" type="number" min="0" step="0.01" defaultValue="0" required /></div>
        <div className="field"><label>关税率 %</label><input name="dutyRate" type="number" min="0" max="100" step="0.01" defaultValue="0" required /></div>
        <div className="field"><label>MOQ</label><input name="moq" type="number" min="1" step="1" required /></div>
        <div className="field"><label>交期（天）</label><input name="leadTimeDays" type="number" min="1" step="1" required /></div>
        <div className="field"><label>样品评分（0–100）</label><input name="sampleScore" type="number" min="0" max="100" step="1" /></div>
        <div className="field"><label>样品费（{currency}）</label><input name="sampleFee" type="number" min="0" step="0.01" defaultValue="0" required /></div>
        <div className="field"><label>贸易条款</label><input name="incoterm" placeholder="FOB / EXW / DDP" maxLength={80} /></div>
        <div className="field"><label>付款条件</label><input name="paymentTerms" maxLength={200} placeholder="例如：30% 定金 / 70% 发货前" /></div>
        <div className="field full"><label>认证与合规</label><input name="certifications" maxLength={500} placeholder="只填供应商能提供证明的认证" /></div>
        <div className="field full"><label>报价来源 URL</label><input name="quoteUrl" type="url" required placeholder="聊天记录导出、报价单或产品链接" /></div>
        <div className="field"><label>观察时间</label><input name="observedAt" type="datetime-local" defaultValue={observedAt} required /></div>
        <div className="field"><label>录入人</label><input name="actor" defaultValue="采购人员" required maxLength={80} /></div>
        <button className="button primary" type="submit">记录真实报价并重算门禁</button>
      </form>
    </details>
  );
}

