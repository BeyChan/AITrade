/**
 * 选品全链路统一流转状态枚举（单一真相源）：
 * - 彻底解耦「质量分级 (S/A/B/HOLD/ELIMINATED)」与「业务流转状态 (SelectionStatus)」
 * - 覆盖 选品初筛 → 选品看板 4 步验证 → 正式商品案卷 → 统一避坑库 完整生命周期
 */

export const SELECTION_STATUS = {
  /** 阶段 1：选品初筛池 · 待分诊 */
  TRIAGE_PENDING: "triage_pending",

  /** 阶段 2：选品看板 · 第 1 步（待扫竞品） */
  KANBAN_CANDIDATE: "kanban_candidate",
  /** 阶段 2：选品看板 · 第 2 步（已扫竞品 / 待核成本） */
  KANBAN_SCANNED: "kanban_scanned",
  /** 阶段 2：选品看板 · 第 3 步（利润通过 / 待找厂拿样） */
  KANBAN_PROFITABLE: "kanban_profitable",
  /** 阶段 2：选品看板 · 第 4 步（拿样定标中 / 待签发 GO） */
  KANBAN_SAMPLING: "kanban_sampling",

  /** 阶段 3：已进入正式「我的商品」案卷 */
  PROMOTED_CASE: "promoted_case",

  /** 终态：已淘汰（沉淀入统一避坑库） */
  ELIMINATED: "eliminated",
} as const;

export type SelectionStatus = (typeof SELECTION_STATUS)[keyof typeof SELECTION_STATUS];

export const SELECTION_STATUS_VALUES: readonly SelectionStatus[] = Object.values(SELECTION_STATUS);

export type SelectionPhase = "triage" | "kanban" | "case" | "terminal";
export type SelectionStatusTone = "neutral" | "accent" | "warn" | "good" | "danger";

export type SelectionStatusMeta = {
  status: SelectionStatus;
  label: string;
  shortLabel: string;
  phase: SelectionPhase;
  tone: SelectionStatusTone;
  order: number;
};

export const SELECTION_STATUS_META: Record<SelectionStatus, SelectionStatusMeta> = {
  [SELECTION_STATUS.TRIAGE_PENDING]: {
    status: SELECTION_STATUS.TRIAGE_PENDING,
    label: "待分诊",
    shortLabel: "待分诊",
    phase: "triage",
    tone: "neutral",
    order: 10,
  },
  [SELECTION_STATUS.KANBAN_CANDIDATE]: {
    status: SELECTION_STATUS.KANBAN_CANDIDATE,
    label: "选品看板 · 待扫竞品",
    shortLabel: "看板·待扫",
    phase: "kanban",
    tone: "accent",
    order: 20,
  },
  [SELECTION_STATUS.KANBAN_SCANNED]: {
    status: SELECTION_STATUS.KANBAN_SCANNED,
    label: "选品看板 · 待核成本",
    shortLabel: "看板·待核价",
    phase: "kanban",
    tone: "accent",
    order: 30,
  },
  [SELECTION_STATUS.KANBAN_PROFITABLE]: {
    status: SELECTION_STATUS.KANBAN_PROFITABLE,
    label: "选品看板 · 待找厂拿样",
    shortLabel: "看板·待找厂",
    phase: "kanban",
    tone: "warn",
    order: 40,
  },
  [SELECTION_STATUS.KANBAN_SAMPLING]: {
    status: SELECTION_STATUS.KANBAN_SAMPLING,
    label: "选品看板 · 待定标立项",
    shortLabel: "看板·待定标",
    phase: "kanban",
    tone: "warn",
    order: 50,
  },
  [SELECTION_STATUS.PROMOTED_CASE]: {
    status: SELECTION_STATUS.PROMOTED_CASE,
    label: "已进商品案卷",
    shortLabel: "已进案卷",
    phase: "case",
    tone: "good",
    order: 60,
  },
  [SELECTION_STATUS.ELIMINATED]: {
    status: SELECTION_STATUS.ELIMINATED,
    label: "已淘汰",
    shortLabel: "已淘汰",
    phase: "terminal",
    tone: "danger",
    order: 99,
  },
};

/** 合法状态机跃迁白名单（禁止已立项案卷倒流回看板等非法跃迁） */
export const ALLOWED_SELECTION_TRANSITIONS: Record<SelectionStatus, readonly SelectionStatus[]> = {
  [SELECTION_STATUS.TRIAGE_PENDING]: [
    SELECTION_STATUS.KANBAN_CANDIDATE,
    SELECTION_STATUS.PROMOTED_CASE,
    SELECTION_STATUS.ELIMINATED,
  ],
  [SELECTION_STATUS.KANBAN_CANDIDATE]: [
    SELECTION_STATUS.KANBAN_SCANNED,
    SELECTION_STATUS.PROMOTED_CASE,
    SELECTION_STATUS.ELIMINATED,
    SELECTION_STATUS.TRIAGE_PENDING,
  ],
  [SELECTION_STATUS.KANBAN_SCANNED]: [
    SELECTION_STATUS.KANBAN_PROFITABLE,
    SELECTION_STATUS.PROMOTED_CASE,
    SELECTION_STATUS.ELIMINATED,
    SELECTION_STATUS.TRIAGE_PENDING,
  ],
  [SELECTION_STATUS.KANBAN_PROFITABLE]: [
    SELECTION_STATUS.KANBAN_SAMPLING,
    SELECTION_STATUS.PROMOTED_CASE,
    SELECTION_STATUS.ELIMINATED,
    SELECTION_STATUS.TRIAGE_PENDING,
  ],
  [SELECTION_STATUS.KANBAN_SAMPLING]: [
    SELECTION_STATUS.PROMOTED_CASE,
    SELECTION_STATUS.ELIMINATED,
    SELECTION_STATUS.TRIAGE_PENDING,
  ],
  [SELECTION_STATUS.PROMOTED_CASE]: [
    SELECTION_STATUS.TRIAGE_PENDING, // 仅空案卷取消关联时允许回退
  ],
  [SELECTION_STATUS.ELIMINATED]: [
    SELECTION_STATUS.KANBAN_CANDIDATE, // 避坑库手动恢复
    SELECTION_STATUS.TRIAGE_PENDING,
  ],
};

export function isSelectionStatus(value: unknown): value is SelectionStatus {
  return typeof value === "string" && (SELECTION_STATUS_VALUES as readonly string[]).includes(value);
}

export function canTransitionSelectionStatus(from: SelectionStatus, to: SelectionStatus): boolean {
  if (from === to) return true;
  return ALLOWED_SELECTION_TRANSITIONS[from].includes(to);
}

export function getSelectionStatusMeta(status: SelectionStatus): SelectionStatusMeta {
  return SELECTION_STATUS_META[status];
}

export function isKanbanSelectionStatus(status: SelectionStatus): boolean {
  return SELECTION_STATUS_META[status].phase === "kanban";
}

/** 将选品看板 KanbanStageKey 映射为统一 SelectionStatus */
export function kanbanStageToSelectionStatus(
  stage: "candidate" | "scanned" | "profitable" | "sampling" | "promoted" | "eliminated",
): SelectionStatus {
  switch (stage) {
    case "candidate":
      return SELECTION_STATUS.KANBAN_CANDIDATE;
    case "scanned":
      return SELECTION_STATUS.KANBAN_SCANNED;
    case "profitable":
      return SELECTION_STATUS.KANBAN_PROFITABLE;
    case "sampling":
      return SELECTION_STATUS.KANBAN_SAMPLING;
    case "promoted":
      return SELECTION_STATUS.PROMOTED_CASE;
    case "eliminated":
      return SELECTION_STATUS.ELIMINATED;
  }
}

/**
 * 依据持久化字段与下游实况派生唯一 SelectionStatus（严格按下游优先于上游）：
 * 1. 已关联正式商品案卷 → PROMOTED_CASE
 * 2. 初筛分级 ELIMINATED 或看板已淘汰 → ELIMINATED
 * 3. 已采纳入选品看板 → 采用看板精确阶段（默认 KANBAN_CANDIDATE）
 * 4. 默认 → TRIAGE_PENDING
 */
export function deriveAutoCandidateSelectionStatus(input: {
  grade: string;
  promotedCaseId?: string | null;
  adoptedRunId?: string | null;
  adoptedHypothesisId?: string | null;
  kanbanStage?: "candidate" | "scanned" | "profitable" | "sampling" | "promoted" | "eliminated" | null;
  persistedStatus?: string | null;
}): SelectionStatus {
  if (input.promotedCaseId || input.kanbanStage === "promoted") {
    return SELECTION_STATUS.PROMOTED_CASE;
  }
  if (input.grade === "ELIMINATED" || input.kanbanStage === "eliminated") {
    return SELECTION_STATUS.ELIMINATED;
  }
  if (input.adoptedRunId && input.adoptedHypothesisId) {
    if (input.kanbanStage) {
      return kanbanStageToSelectionStatus(input.kanbanStage);
    }
    if (isSelectionStatus(input.persistedStatus) && isKanbanSelectionStatus(input.persistedStatus)) {
      return input.persistedStatus;
    }
    return SELECTION_STATUS.KANBAN_CANDIDATE;
  }
  return SELECTION_STATUS.TRIAGE_PENDING;
}

/** 统一动作能力表：前端表格/卡片/抽屉全部按此控制按钮可见性，杜绝状态打架 */
export function getSelectionActionCapabilities(status: SelectionStatus): {
  canAdopt: boolean;
  canUnadopt: boolean;
  canViewKanban: boolean;
  canPromoteFastTrack: boolean;
  canViewCase: boolean;
  canUnpromote: boolean;
  canEliminate: boolean;
  isProcessed: boolean;
} {
  const phase = SELECTION_STATUS_META[status].phase;
  return {
    canAdopt: status === SELECTION_STATUS.TRIAGE_PENDING,
    canUnadopt: phase === "kanban",
    canViewKanban: phase === "kanban",
    canPromoteFastTrack: status === SELECTION_STATUS.TRIAGE_PENDING,
    canViewCase: status === SELECTION_STATUS.PROMOTED_CASE,
    canUnpromote: status === SELECTION_STATUS.PROMOTED_CASE,
    canEliminate: status === SELECTION_STATUS.TRIAGE_PENDING || phase === "kanban",
    isProcessed: phase === "kanban" || status === SELECTION_STATUS.PROMOTED_CASE,
  };
}
