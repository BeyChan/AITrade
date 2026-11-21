"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WORKSPACE_ROLE_META, type WorkspaceRole } from "@/lib/operator-shared";

const ROLE_OPTIONS: WorkspaceRole[] = ["owner", "operator", "sourcing", "creative", "viewer"];

export function OperatorSwitcher({
  initialOperator = "管理员",
  initialRole = "owner",
}: {
  initialOperator?: string;
  initialRole?: WorkspaceRole;
}) {
  const router = useRouter();
  const [operator, setOperator] = useState(initialOperator);
  const [role, setRole] = useState<WorkspaceRole>(initialRole);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(initialOperator);
  const [roleInput, setRoleInput] = useState<WorkspaceRole>(initialRole);
  const [saving, setSaving] = useState(false);

  async function saveIdentity(nextName: string, nextRole: WorkspaceRole) {
    const trimmed = nextName.trim().slice(0, 24) || WORKSPACE_ROLE_META[nextRole].label;
    setSaving(true);
    try {
      const res = await fetch("/api/operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, role: nextRole }),
      });
      if (res.ok) {
        setOperator(trimmed);
        setRole(nextRole);
        setNameInput(trimmed);
        setRoleInput(nextRole);
        setEditing(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 10px",
        borderRadius: "8px",
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
        <span style={{ fontSize: "12px", opacity: 0.78 }}>
          {operator} · {WORKSPACE_ROLE_META[role].shortLabel}
        </span>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--lime)",
            cursor: "pointer",
            fontSize: "12px",
            padding: 0,
            fontWeight: 600,
          }}
        >
          {editing ? "收起" : "切换身份"}
        </button>
      </div>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveIdentity(nameInput, roleInput);
          }}
          style={{ display: "flex", flexDirection: "column", gap: "6px" }}
        >
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="成员姓名 / 昵称"
            maxLength={24}
            style={{
              width: "100%",
              padding: "5px 8px",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(0,0,0,0.22)",
              color: "inherit",
              fontSize: "12px",
            }}
          />
          <select
            value={roleInput}
            onChange={(e) => setRoleInput(e.target.value as WorkspaceRole)}
            aria-label="职能角色"
            style={{
              width: "100%",
              padding: "5px 8px",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(0,0,0,0.3)",
              color: "inherit",
              fontSize: "12px",
            }}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {WORKSPACE_ROLE_META[r].label}
              </option>
            ))}
          </select>
          <span style={{ fontSize: "12px", opacity: 0.72, lineHeight: 1.4 }}>
            {WORKSPACE_ROLE_META[roleInput].description}
          </span>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "5px 8px",
              borderRadius: "6px",
              border: "none",
              background: "var(--lime)",
              color: "var(--deep)",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {saving ? "保存中…" : "确认切换"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
