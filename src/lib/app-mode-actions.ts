"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { APP_MODE_COOKIE, type AppMode } from "./app-mode";
import { recordAuditLog } from "./audit-logs";

/**
 * 切换系统模式：模拟沙盒 (sandbox) <-> 真实数据 (live)
 */
export async function setAppModeAction(mode: AppMode) {
  const cookieStore = await cookies();
  const previousMode = cookieStore.get(APP_MODE_COOKIE)?.value ?? "sandbox";
  cookieStore.set(APP_MODE_COOKIE, mode, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 年持久化
    sameSite: "lax",
    httpOnly: false,
  });

  await recordAuditLog({
    actor: "本地操作员",
    action: "app.mode_switched",
    entityType: "app_mode",
    entityId: "workspace",
    details: { previousMode, mode },
  }).catch(() => {});

  revalidatePath("/", "layout");
  return { success: true, mode };
}

/**
 * 一键重置演示数据（仅清除并重置 is_demo = TRUE 的数据，不影响真实数据）
 */
export async function resetDemoDataAction() {
  const { resetDemoData } = await import("@/lib/db");
  await resetDemoData();
  await recordAuditLog({
    actor: "本地操作员",
    action: "app.demo_reset",
    entityType: "app_mode",
    entityId: "demo_seed",
    details: { scope: "demo_only" },
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { success: true };
}
