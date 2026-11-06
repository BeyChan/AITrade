"use client";

import { useEffect } from "react";

/**
 * 记住当前步骤。表单提交后 server action 会 redirect 回不带 tab 的 URL，
 * 服务端读取这个 cookie 即可把用户留在原来的步骤上。
 */
export function DetailTabCookie({ tab }: { tab: string }) {
  useEffect(() => {
    document.cookie = `aitrade_detail_tab=${encodeURIComponent(tab)};path=/;max-age=86400;SameSite=Lax`;
  }, [tab]);
  return null;
}
