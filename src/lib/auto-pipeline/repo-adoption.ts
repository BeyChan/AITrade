import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { recordAuditLog } from "../audit-logs.ts";
import { isDemoMode, resolveAppMode, type ModeOptions } from "../app-mode.ts";
import {
  SELECTION_STATUS,
  canTransitionSelectionStatus,
  deriveAutoCandidateSelectionStatus,
} from "../selection-status.ts";
import {
  type CandidateRow,
  type DbClient,
  recalculateRunCounts,
  resolveCandidatesByIds,
} from "./repo-shared.ts";

async function ensureKanbanRunForPool(
  db: DbClient,
  opts: {
    platformCode: string;
    marketCode: string;
    currency: string;
    category: string;
    brief: string;
    requestKey: string;
    actor: string;
    demo: boolean;
  },
): Promise<{ runId: string; nextPosition: number }> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM ai_sourcing_runs WHERE request_key = $1 AND is_demo = $2 LIMIT 1`,
    [opts.requestKey, opts.demo],
  );
  let runId = existing.rows[0]?.id;
  if (!runId) {
    const briefId = randomUUID();
    runId = randomUUID();
    await db.query(
      `INSERT INTO sourcing_briefs
        (id, market_code, platform_code, category, brief, currency, created_by, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        briefId,
        opts.marketCode.toUpperCase(),
        opts.platformCode.toLowerCase(),
        opts.category.slice(0, 80),
        opts.brief.slice(0, 1200),
        opts.currency || "USD",
        opts.actor,
        opts.demo,
      ],
    );
    await db.query(
      `INSERT INTO ai_sourcing_runs
        (id, brief_id, provider, model, request_key, status, response_summary, completed_at, is_demo)
       VALUES ($1, $2, 'auto_pool', 'pool_triage', $3, 'completed', '{}'::jsonb, NOW(), $4)`,
      [runId, briefId, opts.requestKey, opts.demo],
    );
  }
  const posRes = await db.query<{ max_pos: number }>(
    `SELECT COALESCE(MAX(position), 0)::int AS max_pos FROM opportunity_hypotheses WHERE run_id = $1`,
    [runId],
  );
  return { runId, nextPosition: Number(posRes.rows[0]?.max_pos ?? 0) + 1 };
}

export async function adoptAutoCandidatesToKanban(input: {
  candidateIds: string[];
  actor?: string;
}, options?: ModeOptions): Promise<{
  adoptedCount: number;
  reusedCount: number;
  items: Array<{ candidateId: string; runId: string; hypothesisId: string; alreadyExisted: boolean }>;
}> {
  const db = await getDb();
  const mode = await resolveAppMode(options?.mode);
  const demo = isDemoMode(mode);
  const actor = input.actor?.trim() || "运营人员";
  const rows = await resolveCandidatesByIds(db, input.candidateIds, demo);
  if (rows.length === 0) {
    throw new Error("未找到要采纳的候选记录");
  }

  const results: Array<{ candidateId: string; runId: string; hypothesisId: string; alreadyExisted: boolean }> = [];
  let adoptedCount = 0;
  let reusedCount = 0;

  // 按 platform × market 分组，每组落入对应站点的“线索池采纳”批次
  const groups = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    const key = `${row.platform_code.toLowerCase()}:${row.market_code.toUpperCase()}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  for (const [, groupRows] of groups) {
    const first = groupRows[0];
    const platformCode = first.platform_code.toLowerCase();
    const marketCode = first.market_code.toUpperCase();
    const currency = first.currency || "USD";
    const requestKey = `pool_adopted:${platformCode}:${marketCode}`;

    let runIdCache: string | null = null;
    let nextPos = 1;

    for (const candidate of groupRows) {
      // 检查是否已有有效关联
      if (candidate.adopted_run_id && candidate.adopted_hypothesis_id) {
        const check = await db.query<{ id: string }>(
          `SELECT h.id FROM opportunity_hypotheses h
           JOIN ai_sourcing_runs r ON r.id = h.run_id
           WHERE h.id = $1 AND r.is_demo = $2 LIMIT 1`,
          [candidate.adopted_hypothesis_id, demo],
        );
        if (check.rows[0]) {
          reusedCount += 1;
          results.push({
            candidateId: candidate.id,
            runId: candidate.adopted_run_id,
            hypothesisId: candidate.adopted_hypothesis_id,
            alreadyExisted: true,
          });
          continue;
        }
      }

      const currentStatus = deriveAutoCandidateSelectionStatus({
        grade: candidate.grade,
        promotedCaseId: candidate.promoted_case_id,
        adoptedRunId: candidate.adopted_run_id,
        adoptedHypothesisId: candidate.adopted_hypothesis_id,
        persistedStatus: candidate.selection_status,
      });
      if (!canTransitionSelectionStatus(currentStatus, SELECTION_STATUS.KANBAN_CANDIDATE)) {
        throw new Error(`候选 ${candidate.external_id} 当前状态为「${currentStatus}」，不可采纳进看板`);
      }

      if (!runIdCache) {
        const ensured = await ensureKanbanRunForPool(db, {
          platformCode,
          marketCode,
          currency,
          category: "线索池采纳",
          brief: `来自 ${platformCode.toUpperCase()} ${marketCode} 选品线索池初筛采纳的候选品，进入统一 4 步验证漏斗。`,
          requestKey,
          actor,
          demo,
        });
        runIdCache = ensured.runId;
        nextPos = ensured.nextPosition;
      }

      const hypothesisId = randomUUID();
      const priceCents = Math.max(100, Number(candidate.price_cents || 100));
      const marginRate = Math.max(0, Math.min(0.95, Number(candidate.estimated_margin_rate || 0.18)));
      const maxLandedCny = Number(candidate.max_landed_cost_cny || 0);
      const priorityScore = Math.max(0, Math.min(100, Math.round(Number(candidate.score || 60))));
      const concept = `${candidate.external_id} · ${candidate.title}`.slice(0, 120);
      const reasonSummary = (Array.isArray(candidate.reasons) ? candidate.reasons : [])
        .slice(0, 3)
        .map((r) => r.message)
        .join("；");
      const painPoint = `竞品参考价 ${(priceCents / 100).toFixed(2)} ${currency}，评论 ${Number(candidate.review_count || 0)}，评分 ${candidate.rating ?? "—"}；18% 门禁达标采购上限 ≤ ¥${maxLandedCny.toFixed(1)}。`;
      const differentiator = `线索池 ${candidate.grade} 级初筛采纳（机会分 ${priorityScore}，估算净利率 ${(marginRate * 100).toFixed(1)}%）${reasonSummary ? `：${reasonSummary}` : ""}`;
      const risks = (Array.isArray(candidate.reasons) ? candidate.reasons : [])
        .filter((r) => r.severity === "fail" || r.severity === "warn")
        .map((r) => r.message);

      await db.query(
        `INSERT INTO opportunity_hypotheses
          (id, run_id, position, concept, target_user, pain_point, differentiator,
           recommended_price_cents, expected_margin_rate, first_order_budget_cents,
           main_risks, supplier_keywords, competitor_queries, review_queries,
           priority_score, selected_for_validation, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, TRUE, NOW())`,
        [
          hypothesisId,
          runIdCache,
          nextPos++,
          concept,
          `${marketCode} ${platformCode.toUpperCase()} 买家`,
          painPoint,
          differentiator,
          priceCents,
          marginRate,
          Math.max(0, Math.round(Number(candidate.max_landed_cost_cents || 0) * 300)),
          JSON.stringify(risks),
          JSON.stringify([candidate.category || candidate.title.slice(0, 32)].filter(Boolean)),
          JSON.stringify([candidate.external_id, candidate.title.slice(0, 48)].filter(Boolean)),
          JSON.stringify([candidate.external_id].filter(Boolean)),
          priorityScore,
        ],
      );

      await db.query(
        `UPDATE auto_candidates
         SET adopted_run_id = $1, adopted_hypothesis_id = $2, selection_status = $3, updated_at = NOW()
         WHERE platform_code = $4 AND market_code = $5 AND external_id = $6 AND is_demo = $7`,
        [runIdCache, hypothesisId, SELECTION_STATUS.KANBAN_CANDIDATE, candidate.platform_code, candidate.market_code, candidate.external_id, demo],
      );
      await db.query(
        `UPDATE auto_run_candidates
         SET adopted_run_id = $1, adopted_hypothesis_id = $2, selection_status = $3, updated_at = NOW()
         WHERE platform_code = $4 AND market_code = $5 AND external_id = $6 AND is_demo = $7`,
        [runIdCache, hypothesisId, SELECTION_STATUS.KANBAN_CANDIDATE, candidate.platform_code, candidate.market_code, candidate.external_id, demo],
      );

      adoptedCount += 1;
      results.push({
        candidateId: candidate.id,
        runId: runIdCache,
        hypothesisId,
        alreadyExisted: false,
      });

      await recordAuditLog({
        mode,
        actor,
        action: "auto_pipeline.candidate_adopted",
        entityType: "opportunity_hypothesis",
        entityId: hypothesisId,
        details: {
          candidateId: candidate.id,
          runId: runIdCache,
          platformCode,
          marketCode,
          externalId: candidate.external_id,
          grade: candidate.grade,
          mode,
        },
      }).catch(() => {});
    }
  }

  return { adoptedCount, reusedCount, items: results };
}

/**
 * 取消采纳入选品看板：
 * - 清空 auto_candidates 与 auto_run_candidates 的 adopted_run_id / adopted_hypothesis_id 关联
 * - 若关联的看板候选仍是刚采纳的空白记录（未绑定研报/核算单/案卷，且无竞品/报价/证据/定标记录），同步删除该空候选（若所属采纳批次已空则一并清理）
 * - 若已在看板中录入真实调研数据，则保留看板候选不误删，仅解除初筛池关联
 */
export async function unadoptAutoCandidate(
  candidateId: string,
  actor = "运营人员",
  options?: ModeOptions,
): Promise<{ hypothesisId: string | null; hypothesisDeleted: boolean }> {
  const db = await getDb();
  const mode = await resolveAppMode(options?.mode);
  const demo = isDemoMode(mode);
  const rows = await resolveCandidatesByIds(db, [candidateId], demo);
  const candidate = rows[0];
  if (!candidate) {
    throw new Error("未找到对应的初筛候选记录");
  }

  const hypothesisId = candidate.adopted_hypothesis_id ?? null;
  const runId = candidate.adopted_run_id ?? null;

  const nextStatusAfterUnadopt = deriveAutoCandidateSelectionStatus({
    grade: candidate.grade,
    promotedCaseId: candidate.promoted_case_id,
    adoptedRunId: null,
    adoptedHypothesisId: null,
  });

  await db.query(
    `UPDATE auto_candidates
     SET adopted_run_id = NULL, adopted_hypothesis_id = NULL, selection_status = $1, updated_at = NOW()
     WHERE platform_code = $2 AND market_code = $3 AND external_id = $4 AND is_demo = $5`,
    [nextStatusAfterUnadopt, candidate.platform_code, candidate.market_code, candidate.external_id, demo],
  );
  await db.query(
    `UPDATE auto_run_candidates
     SET adopted_run_id = NULL, adopted_hypothesis_id = NULL, selection_status = $1, updated_at = NOW()
     WHERE platform_code = $2 AND market_code = $3 AND external_id = $4 AND is_demo = $5`,
    [nextStatusAfterUnadopt, candidate.platform_code, candidate.market_code, candidate.external_id, demo],
  );

  let hypothesisDeleted = false;
  if (hypothesisId) {
    const hypRes = await db.query<{
      run_id: string;
      comparison_report_id: string | null;
      cost_sheet_id: string | null;
      product_case_id: string | null;
      eliminated_at: string | null;
      extra_records: number;
    }>(
      `SELECT
         h.run_id,
         h.comparison_report_id,
         h.cost_sheet_id,
         h.product_case_id,
         h.eliminated_at,
         (
           (SELECT COUNT(*) FROM opportunity_evidence WHERE hypothesis_id = $1) +
           (SELECT COUNT(*) FROM competitor_snapshots WHERE hypothesis_id = $1) +
           (SELECT COUNT(*) FROM review_insights WHERE hypothesis_id = $1) +
           (SELECT COUNT(*) FROM supplier_shortlists WHERE hypothesis_id = $1) +
           (SELECT COUNT(*) FROM sourcing_supplier_quotes WHERE hypothesis_id = $1) +
           (SELECT COUNT(*) FROM selection_decisions WHERE hypothesis_id = $1)
         )::int AS extra_records
       FROM opportunity_hypotheses h
       JOIN ai_sourcing_runs r ON r.id = h.run_id AND r.is_demo = $2
       WHERE h.id = $1
       LIMIT 1`,
      [hypothesisId, demo],
    );
    const hyp = hypRes.rows[0];
    if (
      hyp &&
      !hyp.comparison_report_id &&
      !hyp.cost_sheet_id &&
      !hyp.product_case_id &&
      !hyp.eliminated_at &&
      hyp.extra_records === 0
    ) {
      await db.query(
        `DELETE FROM opportunity_hypotheses h
         USING ai_sourcing_runs r
         WHERE h.id = $1 AND h.run_id = r.id AND r.is_demo = $2`,
        [hypothesisId, demo],
      );
      hypothesisDeleted = true;

      // 如果所属“线索池采纳”批次下已无任何候选，顺手清理该空批次避免看板出现空批 pill
      const targetRunId = runId || hyp.run_id;
      if (targetRunId) {
        const remainRes = await db.query<{ count: number; brief_id: string | null; request_key: string | null }>(
          `SELECT
             (SELECT COUNT(*) FROM opportunity_hypotheses WHERE run_id = $1)::int AS count,
             r.brief_id,
             r.request_key
           FROM ai_sourcing_runs r
           WHERE r.id = $1 AND r.is_demo = $2
           LIMIT 1`,
          [targetRunId, demo],
        );
        const remain = remainRes.rows[0];
        if (remain && remain.count === 0 && remain.request_key?.startsWith("pool_adopted:")) {
          await db.query(
            `DELETE FROM ai_sourcing_runs WHERE id = $1 AND is_demo = $2`,
            [targetRunId, demo],
          );
          if (remain.brief_id) {
            await db.query(
              `DELETE FROM sourcing_briefs WHERE id = $1 AND is_demo = $2`,
              [remain.brief_id, demo],
            );
          }
        }
      }
    }
  }

  await recordAuditLog({
    mode,
    actor,
    action: "auto_pipeline.candidate_unadopted",
    entityType: "opportunity_hypothesis",
    entityId: hypothesisId || candidateId,
    details: {
      candidateId,
      platformCode: candidate.platform_code,
      marketCode: candidate.market_code,
      externalId: candidate.external_id,
      hypothesisDeleted,
      mode,
    },
  }).catch(() => {});

  return { hypothesisId, hypothesisDeleted };
}

/**
 * 在选品线索池将一条或多条候选批量淘汰，并同步沉淀到统一避坑库（opportunity_hypotheses.eliminated_at）：
 * - 更新 auto_candidates / auto_run_candidates 为 ELIMINATED + NO-GO，刷新批次统计
 * - 写入统一避坑记录，后续在推进看板、添加选品、线索池导入时自动触发历史避坑预警
 */
export async function eliminateAutoCandidatesToBlacklist(input: {
  candidateIds: string[];
  reason: string;
  note?: string;
  actor?: string;
}, options?: ModeOptions): Promise<{ eliminatedCount: number }> {
  const db = await getDb();
  const mode = await resolveAppMode(options?.mode);
  const demo = isDemoMode(mode);
  const actor = input.actor?.trim() || "运营人员";
  const reason = input.reason?.trim() || "其他";
  const note = input.note?.trim() || null;
  const rows = await resolveCandidatesByIds(db, input.candidateIds, demo);
  if (rows.length === 0) {
    throw new Error("未找到要淘汰的候选记录");
  }

  const affectedRunIds = new Set<string>();

  for (const candidate of rows) {
    affectedRunIds.add(candidate.run_id);
    const existingReasons = Array.isArray(candidate.reasons) ? candidate.reasons : [];
    const nextReasons = [
      { code: "MANUAL_BLACKLIST", severity: "fail" as const, message: `人工淘汰入避坑库：${reason}${note ? `（${note}）` : ""}` },
      ...existingReasons.filter((r) => r.code !== "MANUAL_BLACKLIST"),
    ];

    await db.query(
      `UPDATE auto_candidates
       SET grade = 'ELIMINATED', verdict = 'NO-GO', selection_status = $1, reasons = $2::jsonb, updated_at = NOW()
       WHERE platform_code = $3 AND market_code = $4 AND external_id = $5 AND is_demo = $6`,
      [SELECTION_STATUS.ELIMINATED, JSON.stringify(nextReasons), candidate.platform_code, candidate.market_code, candidate.external_id, demo],
    );
    await db.query(
      `UPDATE auto_run_candidates
       SET grade = 'ELIMINATED', verdict = 'NO-GO', selection_status = $1, reasons = $2::jsonb, updated_at = NOW()
       WHERE platform_code = $3 AND market_code = $4 AND external_id = $5 AND is_demo = $6`,
      [SELECTION_STATUS.ELIMINATED, JSON.stringify(nextReasons), candidate.platform_code, candidate.market_code, candidate.external_id, demo],
    );

    // 若已采纳进看板，直接把该看板记录标记为淘汰；否则写入统一的“线索池避坑沉淀”批次
    if (candidate.adopted_hypothesis_id) {
      await db.query(
        `UPDATE opportunity_hypotheses h
         SET eliminated_at = NOW(), elimination_reason = $1, elimination_note = $2
         FROM ai_sourcing_runs r
         WHERE h.id = $3 AND h.run_id = r.id AND r.is_demo = $4`,
        [reason, note || `${candidate.platform_code}/${candidate.market_code} 线索池淘汰`, candidate.adopted_hypothesis_id, demo],
      );
    } else {
      const platformCode = candidate.platform_code.toLowerCase();
      const marketCode = candidate.market_code.toUpperCase();
      const currency = candidate.currency || "USD";
      const ensured = await ensureKanbanRunForPool(db, {
        platformCode,
        marketCode,
        currency,
        category: "线索池避坑库",
        brief: `从 ${platformCode.toUpperCase()} ${marketCode} 选品线索池直接淘汰沉淀的避坑记录。`,
        requestKey: `pool_blacklist:${platformCode}:${marketCode}`,
        actor,
        demo,
      });

      const hypId = randomUUID();
      const concept = `${candidate.external_id} · ${candidate.title}`.slice(0, 120);
      await db.query(
        `INSERT INTO opportunity_hypotheses
          (id, run_id, position, concept, target_user, pain_point, differentiator,
           recommended_price_cents, expected_margin_rate, first_order_budget_cents,
           main_risks, supplier_keywords, competitor_queries, review_queries,
           priority_score, selected_for_validation, eliminated_at, elimination_reason, elimination_note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10::jsonb, '[]'::jsonb, $11::jsonb, '[]'::jsonb, 0, FALSE, NOW(), $12, $13, NOW())`,
        [
          hypId,
          ensured.runId,
          ensured.nextPosition,
          concept,
          `${marketCode} ${platformCode.toUpperCase()} 买家`,
          `线索池淘汰：${reason}`,
          candidate.category || "线索池淘汰",
          Math.max(100, Number(candidate.price_cents || 100)),
          Math.max(0, Math.min(0.95, Number(candidate.estimated_margin_rate || 0))),
          JSON.stringify([reason]),
          JSON.stringify([candidate.external_id, candidate.title.slice(0, 48)].filter(Boolean)),
          reason,
          note || `线索池淘汰（${candidate.external_id}）`,
        ],
      );

      await db.query(
        `UPDATE auto_candidates
         SET adopted_run_id = $1, adopted_hypothesis_id = $2, updated_at = NOW()
         WHERE platform_code = $3 AND market_code = $4 AND external_id = $5 AND is_demo = $6`,
        [ensured.runId, hypId, candidate.platform_code, candidate.market_code, candidate.external_id, demo],
      );
      await db.query(
        `UPDATE auto_run_candidates
         SET adopted_run_id = $1, adopted_hypothesis_id = $2, updated_at = NOW()
         WHERE platform_code = $3 AND market_code = $4 AND external_id = $5 AND is_demo = $6`,
        [ensured.runId, hypId, candidate.platform_code, candidate.market_code, candidate.external_id, demo],
      );
    }

    await recordAuditLog({
      mode,
      actor,
      action: "auto_pipeline.candidate_eliminated",
      entityType: "auto_candidate",
      entityId: candidate.id,
      details: {
        platformCode: candidate.platform_code,
        marketCode: candidate.market_code,
        externalId: candidate.external_id,
        reason,
        note,
        mode,
      },
    }).catch(() => {});
  }

  await recalculateRunCounts(db, affectedRunIds, demo);
  return { eliminatedCount: rows.length };
}

