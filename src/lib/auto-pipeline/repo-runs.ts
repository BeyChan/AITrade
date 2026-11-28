import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { calculateEconomics, type EconomicsAssumptions } from "../economics.ts";
import { recordAuditLog } from "../audit-logs.ts";
import {
  SELECTION_STATUS,
  deriveAutoCandidateSelectionStatus,
} from "../selection-status.ts";
import type { AutoGrade, AutoPipelineRunSummary } from "./types.ts";
import { getPlatformConfig } from "./repo-configs-and-queries.ts";
import {
  type CandidateRow,
  type RunRow,
  recalculateRunCounts,
  rowToRun,
  syncPooledCandidatesFromSnapshots,
} from "./repo-shared.ts";

export async function renameAutoPipelineRun(
  runId: string,
  sourceLabel: string,
  actor = "运营人员",
): Promise<AutoPipelineRunSummary> {
  const trimmed = sourceLabel.trim();
  if (!trimmed) {
    throw new Error("批次名称不能为空");
  }
  const db = await getDb();
  const res = await db.query<RunRow>(
    `UPDATE auto_pipeline_runs
     SET source_label = $1
     WHERE id = $2
     RETURNING *`,
    [trimmed.slice(0, 120), runId],
  );
  const row = res.rows[0];
  if (!row) {
    throw new Error("未找到对应的自动选品批次");
  }
  await recordAuditLog({
    actor,
    action: "auto_pipeline.run_renamed",
    entityType: "auto_pipeline_run",
    entityId: runId,
    details: { sourceLabel: trimmed.slice(0, 120) },
  }).catch(() => {});
  return rowToRun(row);
}

/**
 * 删除整批自动选品记录：
 * - 级联删除该批次在 auto_run_candidates 中的独立快照
 * - 若某 ASIN 在其他历史批次中仍有快照，则将汇总池 auto_candidates 回迁到最新剩余快照，避免误删
 * - 不影响已推进生成的正式商品案卷（product_cases）
 */
export async function deleteAutoPipelineRun(
  runId: string,
  actor = "运营人员",
): Promise<{ deletedRunId: string; deletedCandidates: number }> {
  const db = await getDb();
  const runRes = await db.query<RunRow>(
    `SELECT * FROM auto_pipeline_runs WHERE id = $1 LIMIT 1`,
    [runId],
  );
  const run = runRes.rows[0];
  if (!run) {
    throw new Error("未找到对应的自动选品批次");
  }

  const affectedPooled = await db.query<{
    platform_code: string;
    market_code: string;
    external_id: string;
  }>(
    `SELECT platform_code, market_code, external_id
     FROM auto_candidates
     WHERE run_id = $1`,
    [runId],
  );

  // 先把仍存在于其他历史批次的汇总记录回迁到剩余最新快照，防止被 ON DELETE CASCADE 误删
  if (affectedPooled.rows.length > 0) {
    await syncPooledCandidatesFromSnapshots(
      db,
      affectedPooled.rows.map((r) => ({
        platformCode: r.platform_code,
        marketCode: r.market_code,
        externalId: r.external_id,
      })),
      runId,
    );
  }

  const snapCountRes = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM auto_run_candidates WHERE run_id = $1`,
    [runId],
  );
  const deletedCandidates = snapCountRes.rows[0]?.count ?? 0;

  await db.query(`DELETE FROM auto_pipeline_runs WHERE id = $1`, [runId]);

  await recordAuditLog({
    actor,
    action: "auto_pipeline.run_deleted",
    entityType: "auto_pipeline_run",
    entityId: runId,
    details: {
      platformCode: run.platform_code,
      marketCode: run.market_code,
      sourceLabel: run.source_label,
      deletedCandidates,
    },
  }).catch(() => {});

  return { deletedRunId: runId, deletedCandidates };
}

/**
 * 删除单批次内的单条/多条候选记录，或按分级一键清理（如清理 ELIMINATED）。
 * 同步维护汇总池 auto_candidates 与批次统计计数，不影响已推进的正式商品案卷。
 */
export async function deleteAutoCandidates(input: {
  ids?: string[];
  runId: string;
  grade?: AutoGrade;
  actor?: string;
}): Promise<{ deletedCount: number; affectedRunIds: string[] }> {
  const db = await getDb();
  const actor = input.actor || "运营人员";
  const runId = input.runId?.trim();
  const ids = Array.isArray(input.ids) ? input.ids.map((s) => s.trim()).filter(Boolean) : [];

  if (!runId || runId === "ALL") {
    throw new Error("请指定有效的批次 ID");
  }
  if (ids.length === 0 && !input.grade) {
    throw new Error("请指定要删除的候选记录或清理条件");
  }

  const clauses: string[] = [`run_id = $1`];
  const params: unknown[] = [runId];

  if (ids.length > 0) {
    params.push(ids);
    clauses.push(`id = ANY($${params.length}::text[])`);
  }
  if (input.grade) {
    params.push(input.grade);
    clauses.push(`grade = $${params.length}`);
  }

  const targets = await db.query<{
    id: string;
    platform_code: string;
    market_code: string;
    external_id: string;
  }>(
    `SELECT id, platform_code, market_code, external_id
     FROM auto_run_candidates
     WHERE ${clauses.join(" AND ")}`,
    params,
  );

  if (targets.rows.length === 0) {
    return { deletedCount: 0, affectedRunIds: [] };
  }

  const targetIds = targets.rows.map((r) => r.id);
  await db.query(`DELETE FROM auto_run_candidates WHERE id = ANY($1::text[])`, [targetIds]);

  await syncPooledCandidatesFromSnapshots(
    db,
    targets.rows.map((r) => ({
      platformCode: r.platform_code,
      marketCode: r.market_code,
      externalId: r.external_id,
    })),
  );
  await recalculateRunCounts(db, [runId]);

  await recordAuditLog({
    actor,
    action: "auto_pipeline.candidates_deleted",
    entityType: "auto_pipeline_run",
    entityId: runId,
    details: {
      grade: input.grade ?? null,
      deletedCount: targetIds.length,
    },
  }).catch(() => {});

  return { deletedCount: targetIds.length, affectedRunIds: [runId] };
}

/**
 * 人工确认将候选池条目推进为正式商品案卷（仍保持 HOLD/provisional，等补真实工厂报价定标后才转 GO）。
 * 兼容传入 auto_candidates.id 或 auto_run_candidates.id。
 */
export async function promoteAutoCandidateToCase(candidateId: string, actor = "运营人员"): Promise<{ caseId: string; alreadyExisted: boolean }> {
  const db = await getDb();
  let res = await db.query<CandidateRow>(
    `SELECT * FROM auto_candidates WHERE id = $1 LIMIT 1`,
    [candidateId],
  );
  if (!res.rows[0]) {
    res = await db.query<CandidateRow>(
      `SELECT * FROM auto_run_candidates WHERE id = $1 LIMIT 1`,
      [candidateId],
    );
  }
  const candidate = res.rows[0];
  if (!candidate) {
    throw new Error("未找到对应的自动选品候选记录");
  }

  const syncPromotedCase = async (caseId: string) => {
    await db.query(
      `UPDATE auto_candidates
       SET promoted_case_id = $1, selection_status = $2, updated_at = NOW()
       WHERE platform_code = $3 AND market_code = $4 AND external_id = $5`,
      [caseId, SELECTION_STATUS.PROMOTED_CASE, candidate.platform_code, candidate.market_code, candidate.external_id],
    );
    await db.query(
      `UPDATE auto_run_candidates
       SET promoted_case_id = $1, selection_status = $2, updated_at = NOW()
       WHERE platform_code = $3 AND market_code = $4 AND external_id = $5`,
      [caseId, SELECTION_STATUS.PROMOTED_CASE, candidate.platform_code, candidate.market_code, candidate.external_id],
    );
  };

  if (candidate.promoted_case_id) {
    await syncPromotedCase(candidate.promoted_case_id);
    return { caseId: candidate.promoted_case_id, alreadyExisted: true };
  }

  // 检查是否已存在相同 ASIN/external_id + marketplace 的案卷
  const existingCase = await db.query<{ id: string }>(
    `SELECT id FROM product_cases WHERE asin = $1 AND marketplace = $2 LIMIT 1`,
    [candidate.external_id, candidate.market_code],
  );
  if (existingCase.rows[0]) {
    const existingId = existingCase.rows[0].id;
    await syncPromotedCase(existingId);
    return { caseId: existingId, alreadyExisted: true };
  }

  const config = await getPlatformConfig(candidate.platform_code, candidate.market_code);
  const econCfg = config.economicsDefaults;
  const priceCents = Math.max(100, Number(candidate.price_cents || 100));
  const fbaFeeCents = Math.max(econCfg.fbaFeeMinCents, Math.round(priceCents * econCfg.fbaFeeRate));
  const landedCostCents = Math.round(priceCents * econCfg.estimatedLandedCostRatio);

  const assumptions: EconomicsAssumptions = {
    currency: candidate.currency || config.currency,
    salePriceCents: priceCents,
    landedCostCents,
    fbaFeeCents,
    referralRate: econCfg.referralRate,
    adRate: econCfg.adRate,
    returnRate: econCfg.returnRate,
    returnProcessingCents: Math.round(fbaFeeCents * 0.25),
    returnRecoveryRate: 0.3,
    couponCents: 0,
    storageCents: Math.round(priceCents * 0.015),
    otherCostCents: 0,
    oneTimeFixedCostCents: 0,
    initialOrderUnits: 300,
  };
  const econ = calculateEconomics(assumptions);

  const caseId = randomUUID();
  const costModelId = randomUUID();
  const notes = `自动选品 ${candidate.grade} 级推进（平台 ${candidate.platform_code}/${candidate.market_code}，估算达标采购上限 ≤ ¥${Number(candidate.max_landed_cost_cny || 0).toFixed(1)}，待补真实工厂报价与人工定标）。`;

  await db.query(
    `INSERT INTO product_cases
     (id, asin, marketplace, category, title, url, status, competitor_price_cents, monthly_sales_estimate, review_count, rating, notes, owner, evidence_score, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'researching', $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
    [
      caseId,
      candidate.external_id,
      candidate.market_code,
      candidate.category || "未分类",
      candidate.title,
      candidate.url || null,
      priceCents,
      Number(candidate.monthly_sales_estimate || 300),
      Number(candidate.review_count || 0),
      candidate.rating ?? 4.2,
      notes,
      actor,
      70,
    ],
  );

  await db.query(
    `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_at)
     VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, NOW())`,
    [costModelId, caseId, JSON.stringify(assumptions), JSON.stringify(econ)],
  );

  await syncPromotedCase(caseId);

  await recordAuditLog({
    actor,
    action: "auto_pipeline.candidate_promoted",
    entityType: "product_case",
    entityId: caseId,
    details: {
      candidateId,
      platformCode: candidate.platform_code,
      marketCode: candidate.market_code,
      externalId: candidate.external_id,
      grade: candidate.grade,
    },
  }).catch(() => {});

  return { caseId, alreadyExisted: false };
}

/**
 * 取消候选推进：
 * - 清空 auto_candidates 与 auto_run_candidates 的 promoted_case_id 关联
 * - 若关联的商品案卷仍是刚推进的初始空案卷（无证据/报价/审批/文案/素材/拿样/实盘记录），自动删除该空案卷
 * - 若已录入真实业务数据或已进入审批，则保留正式案卷不误删，仅解除选品池关联
 */
export async function unpromoteAutoCandidate(
  candidateId: string,
  actor = "运营人员",
): Promise<{ caseId: string | null; caseDeleted: boolean }> {
  const db = await getDb();
  let res = await db.query<CandidateRow>(
    `SELECT * FROM auto_candidates WHERE id = $1 LIMIT 1`,
    [candidateId],
  );
  if (!res.rows[0]) {
    res = await db.query<CandidateRow>(
      `SELECT * FROM auto_run_candidates WHERE id = $1 LIMIT 1`,
      [candidateId],
    );
  }
  const candidate = res.rows[0];
  if (!candidate) {
    throw new Error("未找到对应的自动选品候选记录");
  }

  const caseId = candidate.promoted_case_id;
  const nextStatusAfterUnpromote = deriveAutoCandidateSelectionStatus({
    grade: candidate.grade,
    promotedCaseId: null,
    adoptedRunId: candidate.adopted_run_id,
    adoptedHypothesisId: candidate.adopted_hypothesis_id,
  });
  await db.query(
    `UPDATE auto_candidates
     SET promoted_case_id = NULL, selection_status = $1, updated_at = NOW()
     WHERE platform_code = $2 AND market_code = $3 AND external_id = $4`,
    [nextStatusAfterUnpromote, candidate.platform_code, candidate.market_code, candidate.external_id],
  );
  await db.query(
    `UPDATE auto_run_candidates
     SET promoted_case_id = NULL, selection_status = $1, updated_at = NOW()
     WHERE platform_code = $2 AND market_code = $3 AND external_id = $4`,
    [nextStatusAfterUnpromote, candidate.platform_code, candidate.market_code, candidate.external_id],
  );

  let caseDeleted = false;
  if (caseId) {
    const caseRes = await db.query<{ status: string }>(
      `SELECT status FROM product_cases WHERE id = $1 LIMIT 1`,
      [caseId],
    );
    const caseRow = caseRes.rows[0];
    if (caseRow && caseRow.status === "researching") {
      const workRes = await db.query<{
        extra_records: number;
        cost_model_count: number;
      }>(
        `SELECT
           (
             (SELECT COUNT(*) FROM case_evidence WHERE case_id = $1) +
             (SELECT COUNT(*) FROM approvals WHERE case_id = $1) +
             (SELECT COUNT(*) FROM rfqs WHERE case_id = $1) +
             (SELECT COUNT(*) FROM assets WHERE case_id = $1) +
             (SELECT COUNT(*) FROM listings WHERE case_id = $1) +
             (SELECT COUNT(*) FROM supplier_selections WHERE case_id = $1) +
             (SELECT COUNT(*) FROM sourcing_sample_logs WHERE case_id = $1) +
             (SELECT COUNT(*) FROM studio_media_assets WHERE case_id = $1) +
             (SELECT COUNT(*) FROM operations_sku_snapshots WHERE case_id = $1)
           )::int AS extra_records,
           (SELECT COUNT(*) FROM cost_models WHERE case_id = $1)::int AS cost_model_count`,
        [caseId],
      );
      const work = workRes.rows[0];
      if (work && work.extra_records === 0 && work.cost_model_count <= 1) {
        await db.query(`DELETE FROM product_cases WHERE id = $1`, [caseId]);
        caseDeleted = true;
      }
    }
  }

  await recordAuditLog({
    actor,
    action: "auto_pipeline.candidate_unpromoted",
    entityType: "product_case",
    entityId: caseId || candidateId,
    details: {
      candidateId,
      platformCode: candidate.platform_code,
      marketCode: candidate.market_code,
      externalId: candidate.external_id,
      caseDeleted,
    },
  }).catch(() => {});

  return { caseId, caseDeleted };
}
