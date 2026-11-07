"use client";

import { useEffect, useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { searchGlobal, type SearchResultItem } from "@/lib/search-actions";
import { chatWithAiAssistant, type ChatMessage } from "@/lib/ai-assistant-action";

type LauncherMode = "search" | "chat";

const DEFAULT_GREETING: ChatMessage = {
  role: "assistant",
  content: `👋 您好！我是 AITrade 跨境超级操盘手智能助手。
我常驻全站，您可以随时向我咨询 **18% 净利门禁倒推**、**1688 源头询价与压价策略**、**美日欧站点选品差异** 或 **Listing 侵权排查**。
您也可以随时切换上方标签进行全域秒级搜索。`,
};

export function GlobalSearch() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<LauncherMode>("search");

  // Search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, startSearchTransition] = useTransition();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Chat state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([DEFAULT_GREETING]);
  const [chatInput, setChatInput] = useState("");
  const [isAnswering, setIsAnswering] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // 全局快捷键 ⌘K / Ctrl+K 监听
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

    function handleOpenEvent() {
      setIsOpen(true);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("aitrade:open-search", handleOpenEvent);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("aitrade:open-search", handleOpenEvent);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (mode === "search") {
          searchInputRef.current?.focus();
        } else {
          chatInputRef.current?.focus();
        }
      }, 60);
    }
  }, [isOpen, mode]);

  useEffect(() => {
    if (mode === "chat") {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, mode]);

  // 防抖搜索
  useEffect(() => {
    if (mode !== "search" || !query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      startSearchTransition(async () => {
        const res = await searchGlobal(query);
        setResults(res);
        setSelectedIndex(0);
      });
    }, 150);

    return () => clearTimeout(timer);
  }, [query, mode]);

  function handleSelectResult(item: SearchResultItem) {
    setIsOpen(false);
    router.push(item.href);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelectResult(results[selectedIndex]);
      }
    }
  }

  async function sendChatMessage(promptText?: string) {
    const textToSend = (promptText ?? chatInput).trim();
    if (!textToSend || isAnswering) return;

    const newHistory: ChatMessage[] = [...chatHistory, { role: "user", content: textToSend }];
    setChatHistory(newHistory);
    setChatInput("");
    setIsAnswering(true);

    try {
      const answer = await chatWithAiAssistant(newHistory);
      setChatHistory([...newHistory, { role: "assistant", content: answer }]);
    } catch {
      setChatHistory([
        ...newHistory,
        { role: "assistant", content: "⚠️ AI 响应异常，请检查网络或设置中的 API Key 配置。" },
      ]);
    } finally {
      setIsAnswering(false);
    }
  }

  return (
    <>
      {/* 悬浮在右下角的高级复合图标胶囊 (Floating AI Assistant & Command Launcher) */}
      <button
        type="button"
        className="floating-assistant-launcher"
        onClick={() => setIsOpen(true)}
        title="打开 AI 操盘手助手与全域搜索 (快捷键 ⌘K 或 Ctrl+K)"
        aria-label="打开 AI 助手与全域搜索"
      >
        <div className="launcher-icon-badge">
          {/* 精心设计的复合 SVG 图标：透亮放大镜 + 闪耀 AI 四芒星 */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="6" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M14.5 14.5L19.5 19.5" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
            <path
              d="M19 1.5C19 3.4 20.6 5 22.5 5C20.6 5 19 6.6 19 8.5C19 6.6 17.4 5 15.5 5C17.4 5 19 3.4 19 1.5Z"
              fill="#b9f26c"
            />
            <circle cx="6" cy="10" r="1.2" fill="#b9f26c" />
          </svg>
          <span className="launcher-pulse-dot" />
        </div>
        <div className="launcher-label-wrap">
          <span className="launcher-main-label">AI 助手 & 搜索</span>
        </div>
        <kbd className="launcher-kbd">⌘K</kbd>
      </button>

      {/* 居中悬浮 Spotlight 交互模态窗 */}
      {isOpen && (
        <div className="global-search-overlay" onClick={() => setIsOpen(false)}>
          <div className="global-search-modal" onClick={(e) => e.stopPropagation()}>
            {/* 顶栏：模式双选切换与关闭 */}
            <div className="modal-header-tabs">
              <div className="mode-toggle-group">
                <button
                  type="button"
                  className={`mode-toggle-btn ${mode === "search" ? "active" : ""}`}
                  onClick={() => setMode("search")}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <span>全域检索</span>
                </button>
                <button
                  type="button"
                  className={`mode-toggle-btn ${mode === "chat" ? "active" : ""}`}
                  onClick={() => setMode("chat")}
                >
                  <span className="mode-tab-sparkle">✨</span>
                  <span>AI 操盘手问答</span>
                </button>
              </div>
              <button
                type="button"
                className="search-close-btn"
                onClick={() => setIsOpen(false)}
                title="关闭浮窗 (ESC)"
              >
                ESC
              </button>
            </div>

            {/* 模式 A：全域秒搜 */}
            {mode === "search" && (
              <>
                <div className="global-search-input-wrap">
                  <span className="search-input-icon-box">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                  </span>
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="global-search-input"
                    placeholder="输入商品名称、ASIN 代码、研报品类或 1688 合作工厂..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                  />
                  {isSearching && <span className="search-spinner" />}
                </div>

                <div className="global-search-body">
                  {query.trim() === "" ? (
                    <div className="search-empty-hint">
                      <div className="search-empty-badge">Spotlight · 全域秒级检索</div>
                      <h3 className="search-empty-title">输入关键词即可秒级直达全站资源</h3>
                      <p>支持跨模块即时搜索商品案卷、机会研报品类与 1688 合作工厂：</p>
                      <div className="search-tags-hint">
                        <button type="button" onClick={() => setQuery("吸尘器")}>📦 双风道吸尘器</button>
                        <button type="button" onClick={() => setQuery("B0")}>🔍 ASIN 编码</button>
                        <button type="button" onClick={() => setQuery("车载")}>📊 车载选品研报</button>
                        <button type="button" onClick={() => setQuery("厂")}>🏭 1688 源头工厂</button>
                      </div>
                    </div>
                  ) : results.length === 0 && !isSearching ? (
                    <div className="search-no-results">
                      <div className="search-no-results-icon">🔍</div>
                      <p>未找到与「<strong>{query}</strong>」匹配的商品、研报或供应商</p>
                      <small>请尝试更简短的关键词、ASIN 编号或品类名称</small>
                    </div>
                  ) : (
                    <ul className="global-search-list">
                      {results.map((item, idx) => (
                        <li
                          key={`${item.type}-${item.id}`}
                          className={`global-search-item ${idx === selectedIndex ? "active" : ""}`}
                          onClick={() => handleSelectResult(item)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                        >
                          <span className={`search-item-badge badge-${item.type}`}>
                            {item.typeLabel}
                          </span>
                          <div className="search-item-info">
                            <strong className="search-item-title">{item.title}</strong>
                            <span className="search-item-sub">{item.subtitle}</span>
                          </div>
                          <span className="search-item-arrow">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="global-search-footer">
                  <div className="footer-shortcuts">
                    <span><kbd className="footer-kbd">↑</kbd><kbd className="footer-kbd">↓</kbd> 切换选项</span>
                    <span><kbd className="footer-kbd">↵</kbd> 回车跳转</span>
                    <span><kbd className="footer-kbd">ESC</kbd> 退出</span>
                  </div>
                  <span className="footer-brand">AITrade Spotlight</span>
                </div>
              </>
            )}

            {/* 模式 B：AI 业务对话助手 */}
            {mode === "chat" && (
              <div className="chat-mode-container">
                <div className="chat-messages-scroll">
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`chat-bubble-row ${msg.role}`}>
                      <div className="chat-avatar">
                        {msg.role === "assistant" ? "✨" : "👤"}
                      </div>
                      <div className="chat-bubble-card">
                        <div className="chat-bubble-role">
                          {msg.role === "assistant" ? "AITrade 智能业务助手" : "我"}
                        </div>
                        <div className="chat-bubble-text markdown-render">
                          {msg.content.split("\n\n").map((para, pi) => {
                            if (para.startsWith("### ")) {
                              return <h4 key={pi} style={{ margin: "4px 0 8px 0", fontSize: "14px", fontWeight: 700, color: "var(--deep)" }}>{para.replace("### ", "")}</h4>;
                            }
                            return <p key={pi} style={{ margin: "4px 0", lineHeight: 1.55 }}>{para}</p>;
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                  {isAnswering && (
                    <div className="chat-bubble-row assistant">
                      <div className="chat-avatar">✨</div>
                      <div className="chat-bubble-card">
                        <span className="ai-typing-indicator">操盘手 AI 正在深度分析中...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* 快捷业务提问推荐芯片 */}
                <div className="chat-quick-chips">
                  <button type="button" onClick={() => sendChatMessage("帮我分析商品 18% 净利门禁如何倒推采购成本？")}>
                    📊 18% 门禁倒推
                  </button>
                  <button type="button" onClick={() => sendChatMessage("1688 首次询价如何与源头工厂谈 MOQ 和打样？")}>
                    🏭 1688 询价压价
                  </button>
                  <button type="button" onClick={() => sendChatMessage("亚马逊美国站 vs 日本站选品注意哪些差异？")}>
                    ⚖️ 美日站点差异
                  </button>
                  <button type="button" onClick={() => sendChatMessage("Listing 标题与外观如何规避专利与品牌侵权？")}>
                    🛡️ 防侵权排查
                  </button>
                </div>

                {/* 对话输入栏 */}
                <form
                  className="chat-input-bar"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendChatMessage();
                  }}
                >
                  <input
                    ref={chatInputRef}
                    type="text"
                    className="chat-text-input"
                    placeholder="向 AI 咨询选品门禁、1688 询价或平台差异（按 Enter 发送）..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={isAnswering}
                  />
                  <button
                    type="submit"
                    className="button primary chat-send-btn"
                    disabled={!chatInput.trim() || isAnswering}
                  >
                    发送 →
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
