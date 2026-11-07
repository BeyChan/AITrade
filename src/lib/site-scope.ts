import { cookies } from "next/headers";

export const SITE_MARKET_COOKIE = "aitrade_site_market";
export const SITE_PLATFORM_COOKIE = "aitrade_site_platform";
export const DEFAULT_MARKET = "US";
export const DEFAULT_PLATFORM = "amazon";

/**
 * 在服务端解析当前持久化的国家站点与平台
 * 优先级：URL 查询参数 > Cookie 持久化值 > 默认值 (US / amazon)
 */
export async function resolvePersistedSiteScope(
  requestedMarket?: string,
  requestedPlatform?: string,
): Promise<{ marketCode: string; platformCode: string }> {
  let marketCode = requestedMarket?.trim().toUpperCase();
  let platformCode = requestedPlatform?.trim().toLowerCase();

  try {
    const cookieStore = await cookies();
    if (!marketCode) {
      const fromCookie = cookieStore.get(SITE_MARKET_COOKIE)?.value?.trim().toUpperCase();
      if (fromCookie) {
        marketCode = fromCookie;
      }
    }
    if (!platformCode) {
      const fromCookie = cookieStore.get(SITE_PLATFORM_COOKIE)?.value?.trim().toLowerCase();
      if (fromCookie) {
        platformCode = fromCookie;
      }
    }
  } catch {
    // 单元测试或非请求上下文优雅降级
  }

  return {
    marketCode: marketCode || DEFAULT_MARKET,
    platformCode: platformCode || DEFAULT_PLATFORM,
  };
}
