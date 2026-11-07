export type AppMode = "sandbox" | "live";

export const APP_MODE_COOKIE = "aitrade_mode";
export const DEFAULT_APP_MODE: AppMode = "sandbox";

/**
 * 读取当前应用模式（RSC / Server Action / Route Handler 均可用）
 * 如果没有 cookie 或值非法，默认降级为 "sandbox"（模拟沙盒）
 */
export async function getAppMode(): Promise<AppMode> {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const value = cookieStore.get(APP_MODE_COOKIE)?.value;
    if (value === "live") return "live";
    return "sandbox";
  } catch {
    // 单元测试或非请求上下文优雅降级
    return DEFAULT_APP_MODE;
  }
}
