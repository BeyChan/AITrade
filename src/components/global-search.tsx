"use client";

import { useEffect, useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { searchGlobal, type SearchResultItem } from "@/lib/search-actions";

export function GlobalSearch() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // 快捷键 Cmd+K / Ctrl+K 监听
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // 防抖检索
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await searchGlobal(query);
        setResults(res);
        setSelectedIndex(0);
      });
    }, 180);

    return () => clearTimeout(timer);
  }, [query]);

  function handleSelect(item: SearchResultItem) {
    setIsOpen(false);
    router.push(item.href);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    }
  }

  return (
    <>
      <button
        type="button"
        className="global-search-trigger"
        onClick={() => setIsOpen(true)}
        title="全局搜索 (快捷键 ⌘K)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <span className="search-text">搜索商品 / 研报 / 供应商...</span>
        <kbd className="search-kbd">⌘K</kbd>
      </button>

      {isOpen && (
        <div className="global-search-overlay" onClick={() => setIsOpen(false)}>
          <div className="global-search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="global-search-input-wrap">
              <svg className="search-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                ref={inputRef}
                type="text"
                className="global-search-input"
                placeholder="搜索商品名称、ASIN、研报品类或供应商..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
              />
              {isPending && <span className="search-spinner" />}
              <button
                type="button"
                className="search-close-btn"
                onClick={() => setIsOpen(false)}
              >
                ESC
              </button>
            </div>

            <div className="global-search-body">
              {query.trim() === "" ? (
                <div className="search-empty-hint">
                  <p>输入关键词即刻搜索全站资源</p>
                  <div className="search-tags-hint">
                    <span>支持按商品名称</span>
                    <span>ASIN 代码</span>
                    <span>机会研报品类</span>
                    <span>1688 合作供应商</span>
                  </div>
                </div>
              ) : results.length === 0 && !isPending ? (
                <div className="search-no-results">
                  未找到与「{query}」匹配的商品、研报或供应商
                </div>
              ) : (
                <ul className="global-search-list">
                  {results.map((item, idx) => (
                    <li
                      key={`${item.type}-${item.id}`}
                      className={`global-search-item ${idx === selectedIndex ? "active" : ""}`}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className={`search-item-badge badge-${item.type}`}>
                        {item.typeLabel}
                      </span>
                      <div className="search-item-info">
                        <strong className="search-item-title">{item.title}</strong>
                        <span className="search-item-sub">{item.subtitle}</span>
                      </div>
                      <span className="search-item-arrow">→</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="global-search-footer">
              <span>↑↓ 导航</span>
              <span>↵ 确认跳转</span>
              <span>ESC 退出</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
