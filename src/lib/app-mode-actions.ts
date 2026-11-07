"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { APP_MODE_COOKIE, type AppMode } from "./app-mode";

/**
 * 切换系统模式：模拟沙盒 (sandbox) <-> 真实数据 (live)
 */
export async function setAppModeAction(mode: AppMode) {
  const cookieStore = await cookies();
  cookieStore.set(APP_MODE_COOKIE, mode, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 年持久化
    sameSite: "lax",
    httpOnly: false,
  });

  revalidatePath("/", "layout");
  return { success: true, mode };
}

/**
 * 一键重置演示数据（仅清除并重置 is_demo = TRUE 的数据，不影响真实数据）
 */
export async function resetDemoDataAction() {
  const { resetDemoData } = await import("@/lib/db");
  await resetDemoData();
  revalidatePath("/", "layout");
  return { success: true };
}
