import Link from "next/link";
import { ProposalMeta } from "@/components/ai-proposal-card";
import { CopyDraftButton } from "@/components/copy-draft-button";
import { generateStructuredJSON } from "@/lib/ai-provider";
import type { AppMode } from "@/lib/app-mode";
import type { CaseBenchmarkLookupResult } from "@/lib/ai-sourcing-repository";
import {
  buildTemplateBenchmarkBullets,
  classifyPricePosition,
  textsShareDomainConcept,
  validateBenchmarkBulletProposal,
  type BenchmarkBulletProposal,
  type CompetitorBenchmark,
} from "@/lib/competitor-insights";
import { money, moneyIn } from "@/lib/format";

export async function resolveBenchmarkBulletProposals(
  benchmark: CompetitorBenchmark,
  profile: {
    productName?: string | null;
    targetCustomer?: string | null;
    coreDifferentiator?: string | null;
    specifications?: string | null;
    packageContents?: string | null;
    claimsToAvoid?: string | null;
  } | null,
  requestModel: boolean,
  mode: AppMode,
): Promise<BenchmarkBulletProposal | null> {
  const fallbackProposal = buildTemplateBenchmarkBullets(benchmark, profile);
  if (!requestModel) {
    return fallbackProposal;
  }

  try {
    const generated = await generateStructuredJSON({
      systemPrompt:
        "你是跨境电商 Listing 五点卖点对标助理。请仅根据提供的差评缺口证据和已核验商品定义，输出 JSON 格式的五点卖点草稿提案。严禁使用 best/#1/guaranteed/100%/FDA approved 等违规词。每条必须原样引用提供的 sourceQuote 与 evidenceRefs。",
      userPrompt: JSON.stringify({
        productName: profile?.productName || benchmark.hypothesisSummary.concept,
        targetCustomer: profile?.targetCustomer || benchmark.hypothesisSummary.targetUser,
        coreDifferentiator: profile?.coreDifferentiator || benchmark.hypothesisSummary.differentiator,
        specifications: profile?.specifications || "",
        claimsToAvoid: profile?.claimsToAvoid || "",
        reviewGaps: benchmark.themes.slice(0, 5).map((theme) => ({
          theme: theme.theme,
          sourceQuote: theme.quote || theme.theme,
          evidenceRefs: theme.evidenceRefs.length > 0 ? theme.evidenceRefs : [benchmark.scope.hypothesisId],
        })),
        outputSchema: {
          summary: "五点提案总结",
          bullets: [
            {
              theme: "回应的差评主题",
              bullet: "卖点草稿（20-450字符）",
              sourceQuote: "必须原样取自输入中的 sourceQuote",
              evidenceRefs: ["必须取自输入中的 evidenceRefs"],
              confidence: 0.82,
            },
          ],
        },
      }),
      timeoutMs: 18_000,
      maxTokens: 1_600,
    }, fetch, undefined, { mode });

    const parsed = JSON.parse(generated.content) as unknown;
    return validateBenchmarkBulletProposal(parsed, benchmark, {
      source: "model",
      provider: generated.provider,
      model: generated.model,
    });
  } catch (error) {
    if (!fallbackProposal) return null;
    return {
      ...fallbackProposal,
      generation: {
        source: "template",
        fallback: true,
        providerError: error instanceof Error ? error.message : "模型调用失败，已回退确定性模板",
      },
    };
  }
}

export function ContentBenchmarkCard({
  caseId,
  salePriceCents,
  benchmarkLookup,
  profile,
  draftText,
}: {
  caseId: string;
  salePriceCents: number;
  benchmarkLookup: CaseBenchmarkLookupResult;
  profile: {
    product_name: string;
    target_customer: string;
    core_differentiator: string;
    claims_to_avoid: string;
  } | null;
  draftText: string;
}) {
  if (benchmarkLookup.status === "none" || !benchmarkLookup.benchmark) {
    return (
      <section className="section content-benchmark-card">
        <div className="section-header">
          <div>
            <div className="eyebrow">竞品对标与差评缺口</div>
            <h2>0. 竞品对标参考</h2>
            <p>当前商品未关联 AI 选品机会假设，或尚未录入竞品与差评证据。</p>
          </div>
          <span className="badge badge-neutral">无可用竞品证据</span>
        </div>
        <div className="empty-inline">
          <span>无关联竞品数据时，商品定义、主图检查、Listing 草稿与确定性预检均可正常独立使用。</span>
          <Link href="/ai-sourcing" className="button ghost">去选品验证补充证据</Link>
        </div>
      </section>
    );
  }

  if (benchmarkLookup.status === "ambiguous") {
    return (
      <section className="section content-benchmark-card">
        <div className="section-header">
          <div>
            <div className="eyebrow">竞品对标与差评缺口</div>
            <h2>0. 竞品对标参考</h2>
            <p>检测到多个关联选品假设，请人工选择要用于内容对标的证据来源。</p>
          </div>
          <span className="badge status-review_pending">需人工选择证据源</span>
        </div>
        <div className="benchmark-ambiguous-list">
          {benchmarkLookup.candidates.map((candidate) => (
            <div className="benchmark-ambiguous-item" key={candidate.hypothesisId}>
              <div>
                <strong>{candidate.concept}</strong>
                <span>{candidate.marketCode} · {candidate.platformCode} · {candidate.currency}</span>
              </div>
              <Link
                href={`/cases/${encodeURIComponent(caseId)}/content?hypothesisId=${encodeURIComponent(candidate.hypothesisId)}`}
                className="button secondary"
              >
                选用此假设对标
              </Link>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const { benchmark } = benchmarkLookup;
  const { price, coverage, themes, hypothesisSummary, scope } = benchmark;
  const priceBandLabel: Record<string, string> = {
    below_p25: "低于 P25（低价切入）",
    p25_to_p50: "P25–P50（主流偏低）",
    p50_to_p75: "P50–P75（主流价格带）",
    p75_to_p90: "P75–P90（中高溢价带）",
    above_p90: "高于 P90（高溢价风险区）",
  };
  const currentBand = price && salePriceCents > 0 ? classifyPricePosition(salePriceCents, price) : null;
  const differentiatorAligned = profile?.core_differentiator && hypothesisSummary.differentiator
    ? textsShareDomainConcept(profile.core_differentiator, hypothesisSummary.differentiator)
    : null;

  return (
    <section className="section content-benchmark-card" aria-label="竞品对标与差评缺口卡">
      <div className="section-header">
        <div>
          <div className="eyebrow">竞品对标与差评缺口 · 只读证据传承</div>
          <h2>0. 竞品对标与差评缺口卡</h2>
          <p>来自选品假设「{hypothesisSummary.concept}」的已核实竞品价格带与差评痛点（AI 合成素材已排除），写作商品定义和五点描述时可直接对照。</p>
        </div>
        <div className="button-row">
          <span className="info-pill">
            {coverage.dedupedCount} 去重竞品 · {coverage.themeCount} 差评主题
          </span>
          <Link
            href={`/ai-sourcing/${encodeURIComponent(scope.runId)}?tab=hypotheses&hypothesisId=${encodeURIComponent(scope.hypothesisId)}`}
            className="button ghost"
          >
            回看选品证据
          </Link>
        </div>
      </div>

      <div className="content-benchmark-grid">
        <article className="content-benchmark-col">
          <span className="eyebrow">价格带与定位</span>
          <h3>竞品价格带（{scope.currency}）</h3>
          {price ? (
            <>
              <div className="content-benchmark-prices">
                <div><span>P25</span><strong>{moneyIn(scope.currency, price.p25)}</strong></div>
                <div className="highlight"><span>P50 中位</span><strong>{moneyIn(scope.currency, price.p50)}</strong></div>
                <div><span>P75</span><strong>{moneyIn(scope.currency, price.p75)}</strong></div>
                <div><span>P90</span><strong>{moneyIn(scope.currency, price.p90)}</strong></div>
              </div>
              <p className="muted">
                当前商品售价 <strong>{money(salePriceCents)}</strong>
                {currentBand ? ` · 位于 ${priceBandLabel[currentBand]}` : ""}
              </p>
            </>
          ) : (
            <p className="muted">当前关联假设尚未录入有效竞品价格。</p>
          )}
        </article>

        <article className="content-benchmark-col">
          <span className="eyebrow">差评缺口清单 TOP {Math.min(3, themes.length)}</span>
          <h3>必须在卖点中回应的痛点</h3>
          {themes.length > 0 ? (
            <div className="content-gap-list">
              {themes.slice(0, 3).map((theme) => {
                const covered = draftText.trim().length > 0 && textsShareDomainConcept(theme.theme, draftText);
                return (
                  <div className="content-gap-item" key={theme.theme}>
                    <div className="content-gap-head">
                      <strong>{theme.theme}</strong>
                      <span className={`badge ${covered ? "badge-success" : "status-review_pending"}`}>
                        {covered ? "✓ 草稿已回应" : `${theme.sampleSize} 样本 · 待回应`}
                      </span>
                    </div>
                    {theme.quote ? <small>“{theme.quote}”</small> : null}
                    {theme.sourceUrl ? (
                      <a href={theme.sourceUrl} target="_blank" rel="noreferrer">来源链接</a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">当前关联假设尚未录入差评主题。</p>
          )}
        </article>

        <article className="content-benchmark-col">
          <span className="eyebrow">差异化一致性与红线</span>
          <h3>立项主张 vs 商品定义</h3>
          <div className="content-alignment-box">
            <div>
              <small>选品差异化假设</small>
              <p>{hypothesisSummary.differentiator || "未记录"}</p>
            </div>
            <div>
              <small>当前商品定义差异点</small>
              <p>{profile?.core_differentiator || "尚未保存商品定义（已为您自动预填下方表单）"}</p>
            </div>
            {differentiatorAligned !== null ? (
              <span className={`badge ${differentiatorAligned ? "badge-success" : "status-review_pending"}`}>
                {differentiatorAligned ? "✓ 差异点与选品证据一致" : "提醒：与选品阶段差异化主张偏离"}
              </span>
            ) : null}
            {profile?.claims_to_avoid ? (
              <div className="content-claims-avoid">
                <small>禁用声明红线</small>
                <strong>{profile.claims_to_avoid}</strong>
              </div>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}

export function BenchmarkBulletProposalSection({
  caseId,
  hypothesisId,
  proposal,
  applied,
}: {
  caseId: string;
  hypothesisId?: string;
  proposal: BenchmarkBulletProposal;
  applied: boolean;
}) {
  const baseQuery = new URLSearchParams();
  if (hypothesisId) baseQuery.set("hypothesisId", hypothesisId);

  const applyParams = new URLSearchParams(baseQuery);
  applyParams.set("applyProposal", "1");

  const modelParams = new URLSearchParams(baseQuery);
  modelParams.set("proposeBullets", "1");

  return (
    <div className="benchmark-proposal-box">
      <div className="benchmark-proposal-head">
        <div>
          <span className="eyebrow">对标五点草稿提案 · 人工确认前不落库</span>
          <strong>{proposal.summary}</strong>
          <p>每条提案均绑定真实差评原文或已核验规格，且经过确定性合规过滤（不含夸大/违规对比词）。</p>
        </div>
        <div className="button-row">
          <Link
            href={`/cases/${encodeURIComponent(caseId)}/content?${applyParams.toString()}#bullet-0`}
            className="button secondary"
          >
            {applied ? "✓ 已带入下方表单（请核对后保存）" : "带入下方五点表单预览"}
          </Link>
          <Link
            href={`/cases/${encodeURIComponent(caseId)}/content?${modelParams.toString()}`}
            className="button ghost"
          >
            用 AI 模型润色提案
          </Link>
        </div>
      </div>

      {proposal.generation.providerError ? (
        <small className="muted">提示：{proposal.generation.providerError}</small>
      ) : null}

      <div className="benchmark-proposal-list">
        {proposal.bullets.map((item) => (
          <article className="benchmark-proposal-item" key={item.index}>
            <div className="benchmark-proposal-item-top">
              <div>
                <span className="badge badge-neutral">卖点提案 #{item.index}</span>
                <strong>回应痛点：{item.theme}</strong>
              </div>
              <CopyDraftButton text={item.bullet} />
            </div>
            <p className="benchmark-proposal-bullet">{item.bullet}</p>
            <ProposalMeta
              generation={proposal.generation}
              confidence={item.confidence}
              sourceQuote={item.sourceQuote}
              targetLabel={`证据 #${item.evidenceRefs[0]?.slice(0, 8) ?? "已关联"}`}
              statusLabel="需人工复核后保存"
            />
          </article>
        ))}
      </div>
    </div>
  );
}

