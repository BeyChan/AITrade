"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { findWorkContextItem, type WorkContextItem } from "@/lib/work-context-types";

/**
 * 常驻对象条：回答「我在做哪个对象、处于哪一步、下一步去哪」。
 * 支持快速下拉切换手头跟进的其他在办商品与研究批次。
 */
export function WorkContextBar({ items }: { items: WorkContextItem[] }) {
  const pathname = usePathname();
  const { item, isCurrent } = findWorkContextItem(items, pathname);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 路由跳转后自动收起下拉
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

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
    <div className="work-context-bar" ref={dropdownRef}>
      <span className="work-context-label">{isCurrent ? "当前对象" : "最近在做"}</span>

      <div className="work-context-picker">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`work-context-trigger ${isOpen ? "open" : ""}`}
          title={items.length > 1 ? "点击切换其他在办商品与研究" : item.label}
          aria-expanded={isOpen}
        >
          <span className="work-context-name-text">{item.label}</span>
          {items.length > 1 && (
            <svg className="work-context-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          )}
        </button>

        {isOpen && items.length > 1 && (
          <div className="work-context-dropdown" role="menu">
            <div className="work-context-dropdown-header">
              <span>在办项目快速切换 ({items.length})</span>
            </div>
            <div className="work-context-dropdown-list">
              {items.map((it) => {
                const isSelected = it.id === item.id;
                return (
                  <div key={it.id} className={`work-context-dropdown-item ${isSelected ? "selected" : ""}`}>
                    <Link
                      href={it.href}
                      className="dropdown-item-main"
                      onClick={() => setIsOpen(false)}
                    >
                      <span className="dropdown-item-kind">{it.kind === "batch" ? "研究" : "案卷"}</span>
                      <strong className="dropdown-item-title">{it.label}</strong>
                      <span className="dropdown-item-stage">{it.stage}</span>
                    </Link>
                    <Link
                      href={it.nextHref}
                      className="dropdown-item-action"
                      onClick={() => setIsOpen(false)}
                      title={`前往 ${it.nextLabel}`}
                    >
                      {it.nextLabel} →
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <span className="work-context-stage">{item.stage}</span>
      <span className="work-context-divider" aria-hidden="true" />
      <span className="work-context-hint">下一步</span>
      <Link className="work-context-next" href={item.nextHref}>
        {item.nextLabel} →
      </Link>
    </div>
  );
}
