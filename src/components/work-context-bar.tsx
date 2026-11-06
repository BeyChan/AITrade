"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { findWorkContextItem, type WorkContextItem } from "@/lib/work-context-types";

/**
 * 常驻对象条：回答「我在做哪个对象、处于哪一步、下一步去哪」。
 * 数据是纯展示用的轻量快照，读不到时只显示引导，不影响任何页面。
 */
export function WorkContextBar({ items }: { items: WorkContextItem[] }) {
  const pathname = usePathname();
  const { item, isCurrent } = findWorkContextItem(items, pathname);

  if (!item) {
    return (
      <div className="work-context-bar">
        <span className="work-context-label">当前对象</span>
        <span className="work-context-name">还没有进行中的机会</span>
        <Link className="work-context-next" href="/?new=1#new-research">
          从一轮选品研究开始 →
        </Link>
      </div>
    );
  }

  return (
    <div className="work-context-bar">
      <span className="work-context-label">{isCurrent ? "当前对象" : "最近在做"}</span>
      <Link className="work-context-name" href={item.href}>{item.label}</Link>
      <span className="work-context-stage">{item.stage}</span>
      <span className="work-context-divider" aria-hidden="true" />
      <span className="work-context-hint">下一步</span>
      <Link className="work-context-next" href={item.nextHref}>
        {item.nextLabel} →
      </Link>
    </div>
  );
}
