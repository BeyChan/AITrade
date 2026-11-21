export const OPERATOR_COOKIE_NAME = "aitrade_operator";
export const ROLE_COOKIE_NAME = "aitrade_role";

export type WorkspaceRole = "owner" | "operator" | "sourcing" | "creative" | "viewer";

export type WorkspaceMemberIdentity = {
  name: string;
  role: WorkspaceRole;
};

export const WORKSPACE_ROLE_META: Record<
  WorkspaceRole,
  { label: string; shortLabel: string; description: string }
> = {
  owner: {
    label: "管理员",
    shortLabel: "管理员",
    description: "拥有全部权限，含系统设置、模型配置与数据备份",
  },
  operator: {
    label: "选品与运营",
    shortLabel: "运营",
    description: "负责选品雷达、竞品分析、利润测算与实盘复盘",
  },
  sourcing: {
    label: "供应链采购",
    shortLabel: "采购",
    description: "负责 1688 工厂库、询价报价与打样验货记录",
  },
  creative: {
    label: "视觉与内容",
    shortLabel: "视觉",
    description: "负责 Listing 文案、AI 生图/视频工坊与素材库",
  },
  viewer: {
    label: "只读访客",
    shortLabel: "只读",
    description: "仅可查阅商品案卷、立项战报与复盘数据",
  },
};

export const DEFAULT_OPERATOR = "管理员";
export const DEFAULT_ROLE: WorkspaceRole = "owner";

export function isWorkspaceRole(value: string | null | undefined): value is WorkspaceRole {
  return value === "owner" || value === "operator" || value === "sourcing" || value === "creative" || value === "viewer";
}

export function sanitizeOperatorName(raw: string | null | undefined): string {
  const cleaned = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  return cleaned || DEFAULT_OPERATOR;
}

export function sanitizeWorkspaceRole(raw: string | null | undefined): WorkspaceRole {
  return isWorkspaceRole(raw) ? raw : DEFAULT_ROLE;
}

export function canManageSettings(role: WorkspaceRole): boolean {
  return role === "owner";
}

export function canEditWorkspace(role: WorkspaceRole): boolean {
  return role !== "viewer";
}
