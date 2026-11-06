/** 纯类型与纯函数，可安全用于客户端组件，不引入任何数据库依赖。 */
export type WorkContextItem = {
  id: string;
  kind: "batch" | "case";
  label: string;
  stage: string;
  href: string;
  nextLabel: string;
  nextHref: string;
};

/** 按 URL 找出正在查看的对象；没有匹配时返回最近在做的对象。 */
export function findWorkContextItem(items: WorkContextItem[], pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const parent = segments[0];
  const id = segments[1];
  if ((parent === "ai-sourcing" || parent === "cases") && id) {
    const matched = items.find((item) => item.id === decodeURIComponent(id));
    if (matched) return { item: matched, isCurrent: true };
  }
  return { item: items[0] ?? null, isCurrent: false };
}
