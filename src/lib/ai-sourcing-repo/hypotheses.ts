import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { isValidEliminationReason } from "../sourcing-funnel.ts";
import { buildValidationTasks, loadHypothesisContext } from "./mappers.ts";
import { refreshAISelectionDecision } from "./decisions.ts";

export async function selectHypothesisForValidation(hypothesisId: string, actor: string) {
  const db = await getDb();
  const context = await loadHypothesisContext(hypothesisId);
  if (!context) throw new Error("机会假设不存在");
  const owner = actor.trim() || "运营人员";

  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE opportunity_hypotheses SET selected_for_validation = TRUE WHERE id = $1",
      [hypothesisId],
    );
    for (const task of buildValidationTasks(context.hypothesis, context.batch)) {
      await tx.query(
        `INSERT INTO validation_tasks
          (id, hypothesis_id, task_type, title, description, target_count, owner)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (hypothesis_id, task_type) DO UPDATE SET
           description = EXCLUDED.description,
           target_count = EXCLUDED.target_count,
           owner = CASE WHEN validation_tasks.owner = '未分配' THEN EXCLUDED.owner ELSE validation_tasks.owner END,
           updated_at = NOW()`,
        [randomUUID(), hypothesisId, task.taskType, task.title, task.description, task.targetCount, owner],
      );
    }
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.hypothesis_selected', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [randomUUID(), owner, hypothesisId, JSON.stringify({ taskCount: 8, externalActions: "none" })],
    );
  });
  await refreshAISelectionDecision(hypothesisId);
}

export async function toggleValidationTaskStatus(
  taskId: string,
  requestedStatus?: "done" | "todo",
  actor = "运营人员",
) {
  const db = await getDb();
  const res = await db.query<{ id: string; status: string; hypothesis_id: string; title: string }>(
    "SELECT id, status, hypothesis_id, title FROM validation_tasks WHERE id = $1",
    [taskId],
  );
  const task = res.rows[0];
  if (!task) throw new Error("验证任务不存在");

  const nextStatus = requestedStatus ?? (task.status === "done" ? "todo" : "done");
  await db.query(
    "UPDATE validation_tasks SET status = $1, updated_at = NOW() WHERE id = $2",
    [nextStatus, taskId],
  );

  await db.query(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'ai_sourcing.task_status_changed', 'validation_task', $3, $4::jsonb)`,
    [randomUUID(), actor, taskId, JSON.stringify({ title: task.title, status: nextStatus })],
  );

  await refreshAISelectionDecision(task.hypothesis_id);
  return { id: taskId, status: nextStatus, hypothesisId: task.hypothesis_id };
}



export async function eliminateHypothesis(input: {
  hypothesisId: string;
  reason: string;
  note?: string;
  actor?: string;
}) {
  const db = await getDb();
  const reason = input.reason.trim();
  if (!isValidEliminationReason(reason)) {
    throw new Error("请选择有效的淘汰原因");
  }
  const note = (input.note ?? "").trim().slice(0, 400) || null;
  const actor = (input.actor ?? "").trim() || "运营人员";

  const existing = await db.query<{ id: string; run_id: string; concept: string }>(
    "SELECT id, run_id, concept FROM opportunity_hypotheses WHERE id = $1",
    [input.hypothesisId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("候选方向不存在");

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE opportunity_hypotheses
       SET eliminated_at = NOW(), elimination_reason = $2, elimination_note = $3
       WHERE id = $1`,
      [input.hypothesisId, reason, note],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.hypothesis_eliminated', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        input.hypothesisId,
        JSON.stringify({ runId: row.run_id, concept: row.concept, reason, note }),
      ],
    );
  });

  return { id: row.id, runId: row.run_id, reason, note };
}

export async function restoreHypothesis(hypothesisId: string, actor = "运营人员") {
  const db = await getDb();
  const existing = await db.query<{ id: string; run_id: string; concept: string }>(
    "SELECT id, run_id, concept FROM opportunity_hypotheses WHERE id = $1",
    [hypothesisId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("候选方向不存在");

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE opportunity_hypotheses
       SET eliminated_at = NULL, elimination_reason = NULL, elimination_note = NULL
       WHERE id = $1`,
      [hypothesisId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.hypothesis_restored', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [randomUUID(), actor.trim() || "运营人员", hypothesisId, JSON.stringify({ runId: row.run_id, concept: row.concept })],
    );
  });

  return { id: row.id, runId: row.run_id };
}

export async function deleteHypothesis(hypothesisId: string, actor = "运营人员") {
  const db = await getDb();
  const normalizedId = hypothesisId.trim();
  const deletedBy = actor.trim() || "运营人员";
  if (!normalizedId) throw new Error("缺少候选方向 ID");

  return db.transaction(async (tx) => {
    const existing = await tx.query<{
      id: string;
      run_id: string;
      concept: string;
      product_case_id: string | null;
    }>(
      "SELECT id, run_id, concept, product_case_id FROM opportunity_hypotheses WHERE id = $1 FOR UPDATE",
      [normalizedId],
    );
    const row = existing.rows[0];
    if (!row) throw new Error("候选方向不存在或已被删除");

    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.hypothesis_deleted', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [
        randomUUID(),
        deletedBy,
        row.id,
        JSON.stringify({
          runId: row.run_id,
          concept: row.concept,
          preservedProductCaseId: row.product_case_id,
        }),
      ],
    );

    await tx.query("DELETE FROM opportunity_hypotheses WHERE id = $1", [row.id]);

    const remaining = await tx.query<{ cnt: string | number }>(
      "SELECT COUNT(*) AS cnt FROM opportunity_hypotheses WHERE run_id = $1",
      [row.run_id],
    );

    return {
      id: row.id,
      runId: row.run_id,
      concept: row.concept,
      remainingCount: Number(remaining.rows[0]?.cnt ?? 0),
      preservedProductCase: Boolean(row.product_case_id),
    };
  });
}

export async function saveHypothesisComplianceAttrs(input: {
  hypothesisId: string;
  complianceAttrs?: string[];
  actor?: string;
}) {
  const db = await getDb();
  const context = await loadHypothesisContext(input.hypothesisId);
  if (!context) throw new Error("候选方向不存在");
  if (!context.hypothesis.selectedForValidation) {
    await selectHypothesisForValidation(input.hypothesisId, input.actor || "运营人员");
  }

  const attrs =
    input.complianceAttrs === undefined
      ? context.hypothesis.complianceAttrs
      : [...new Set(input.complianceAttrs.map((a) => a.trim()).filter(Boolean))];
  const actor = (input.actor ?? "").trim() || "运营人员";

  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE opportunity_hypotheses SET compliance_attrs = $2::jsonb WHERE id = $1",
      [input.hypothesisId, JSON.stringify(attrs)],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.compliance_attrs_saved', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        input.hypothesisId,
        JSON.stringify({ complianceAttrs: attrs }),
      ],
    );
  });

  await refreshAISelectionDecision(input.hypothesisId);
  return { id: input.hypothesisId, runId: context.hypothesis.runId };
}

export async function createQuickCandidateBatch(input: {
  marketCode: string;
  platformCode: string;
  category: string;
  concept: string;
  sourceKind: "manual_idea" | "asin_scan" | "quick_calc";
  searchKeyword?: string;
  recommendedPriceCents?: number | null;
  complianceAttrs?: string[];
  comparisonReportId?: string | null;
  costSheetId?: string | null;
  eliminationReason?: string | null;
  eliminationNote?: string | null;
  actor?: string;
}) {
  const db = await getDb();
  const site = await db.query<{ market_name: string; currency: string; platform_name: string }>(
    `SELECT m.name AS market_name, m.currency, p.name AS platform_name
     FROM markets m, platforms p
     WHERE m.code = $1 AND p.code = $2 AND m.status = 'active' AND p.status <> 'disabled'`,
    [input.marketCode, input.platformCode],
  );
  const row = site.rows[0];
  if (!row) throw new Error("当前国家或平台站点不可用");

  const briefId = randomUUID();
  const runId = randomUUID();
  const hypothesisId = randomUUID();
  const actor = (input.actor ?? "").trim() || "选品负责人";
  const concept = input.concept.trim().slice(0, 140) || "未命名候选方向";
  const category = input.category.trim().slice(0, 80) || "跨境候选";
  const keyword = (input.searchKeyword ?? concept).trim().slice(0, 140);
  let priceCents =
    input.recommendedPriceCents && Number.isFinite(input.recommendedPriceCents) && input.recommendedPriceCents > 0
      ? Math.round(input.recommendedPriceCents)
      : null;
  const requestedCostSheetId = input.costSheetId?.trim() || null;
  if (requestedCostSheetId) {
    const costSheet = await db.query<{
      status: string;
      market_code: string;
      platform_code: string;
      currency: string;
      hypothesis_id: string | null;
      sale_price_cents: string | number;
      is_latest: boolean;
    }>(
      `SELECT cs.status, cs.market_code, cs.platform_code, cs.currency, cs.hypothesis_id,
              cs.assumptions->>'salePriceCents' AS sale_price_cents,
              NOT EXISTS (
                SELECT 1 FROM cost_sheets newer
                WHERE newer.group_id = cs.group_id AND newer.version > cs.version
              ) AS is_latest
       FROM cost_sheets cs WHERE cs.id = $1`,
      [requestedCostSheetId],
    );
    const sheet = costSheet.rows[0];
    if (!sheet) throw new Error("成本核算单不存在");
    if (sheet.status !== "confirmed") throw new Error("只有已确认的成本核算单才能建立候选");
    if (!sheet.is_latest) throw new Error("该核算单已有新版本，请使用最新版本");
    if (sheet.hypothesis_id) throw new Error("该核算单已绑定其他候选");
    if (
      sheet.market_code.toUpperCase() !== input.marketCode.toUpperCase() ||
      sheet.platform_code.toLowerCase() !== input.platformCode.toLowerCase() ||
      sheet.currency.toUpperCase() !== row.currency.toUpperCase()
    ) {
      throw new Error("核算单站点、平台或币种与候选不一致");
    }
    priceCents = Math.round(Number(sheet.sale_price_cents));
  }
  if (!priceCents) throw new Error("缺少成本核算单售价或推荐售价，不能建立候选");
  const attrs = Array.isArray(input.complianceAttrs) ? input.complianceAttrs : [];
  const validReason =
    input.eliminationReason && isValidEliminationReason(input.eliminationReason)
      ? input.eliminationReason
      : null;

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO sourcing_briefs
        (id, market_code, platform_code, category, brief, currency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [briefId, input.marketCode, input.platformCode, category, `快速立项候选：${concept}`, row.currency, actor],
    );
    await tx.query(
      `INSERT INTO ai_sourcing_runs
        (id, brief_id, provider, model, status, response_summary, completed_at)
       VALUES ($1, $2, 'manual', $3, 'completed', '{}'::jsonb, NOW())`,
      [runId, briefId, input.sourceKind],
    );
    await tx.query(
      `INSERT INTO opportunity_hypotheses
        (id, run_id, position, concept, target_user, pain_point, differentiator,
         recommended_price_cents, confirmed_price_cents, confirmed_price_at,
         expected_margin_rate, first_order_budget_cents,
         main_risks, supplier_keywords, competitor_queries, review_queries,
         priority_score, selected_for_validation, source_kind,
         comparison_report_id, cost_sheet_id, reference_factory_cost_rmb, compliance_attrs,
         eliminated_at, elimination_reason, elimination_note)
       VALUES ($1, $2, 1, $3, $4, '待通过真实竞品与差评验证', '待通过竞品差异化确认',
         $5, NULL, NULL,
         0.20, 150000, '[]'::jsonb, $6::jsonb, $7::jsonb, $7::jsonb,
         70, TRUE, $8, $9, $10, NULL, $11::jsonb,
         CASE WHEN $12::text IS NOT NULL THEN NOW() ELSE NULL END, $12, $13)`,
      [
        hypothesisId,
        runId,
        concept,
        `${row.market_name}站 · ${row.platform_name}`,
        priceCents,
        JSON.stringify([concept]),
        JSON.stringify([keyword]),
        input.sourceKind,
        input.comparisonReportId ?? null,
        requestedCostSheetId,
        JSON.stringify(attrs),
        validReason,
        input.eliminationNote?.trim().slice(0, 400) || null,
      ],
    );
  });

  // 自动创建 8 项任务（按新口径：供应商 3 家）
  await selectHypothesisForValidation(hypothesisId, actor);
  return { runId, hypothesisId };
}

