"use client";

import { useEffect, useState, useTransition, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getSpotlightInitialData,
  searchGlobal,
  type SearchResultItem,
  type SpotlightInitialData,
} from "@/lib/search-actions";
import {
  chatWithAiAssistant,
  getCopilotContextPreview,
  type ChatMessage,
  type CopilotContextPreview,
} from "@/lib/ai-assistant-action";

type LauncherMode = "search" | "chat";

const DEFAULT_GREETING: ChatMessage = {
  role: "assistant",
  content: `您好！我是 AITrade 跨境操盘手助手。
我会自动识别你当前所在的页面（商品利润沙盘、1688 寻源、文案与视觉、竞品研报、实盘账本等），提供针对性的 **18% 净利门禁倒推**、**1688 压价话术**、**Listing 合规排查** 与 **实盘偏差诊断**。
也可以随时切回上方「全域检索」秒搜商品、研报、工厂与全站功能。`,
};

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`b-${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={`c-${key++}`} className="chat-inline-code">{token.slice(1, -1)}</code>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function renderAssistantMarkdown(content: string): ReactNode {
  const blocks = content.split(/\n{2,}/);
  return blocks.map((block, bIdx) => {
    const trimmed = block.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("### ")) {
      return (
        <h4 key={bIdx} className="chat-md-h4">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h4>
      );
    }

    const lines = trimmed.split("\n").map((l) => l.trimEnd());
    const isUl = lines.every((l) => /^\s*[-*•]\s+/.test(l));
    if (isUl) {
      return (
        <ul key={bIdx} className="chat-md-list">
          {lines.map((l, li) => (
            <li key={li}>{renderInlineMarkdown(l.replace(/^\s*[-*•]\s+/, ""))}</li>
          ))}
        </ul>
      );
    }

    const isOl = lines.every((l) => /^\s*\d+\.\s+/.test(l));
    if (isOl) {
      return (
        <ol key={bIdx} className="chat-md-list">
          {lines.map((l, li) => (
            <li key={li}>{renderInlineMarkdown(l.replace(/^\s*\d+\.\s+/, ""))}</li>
          ))}
        </ol>
      );
    }

    // 混合行：可能首行是普通段落，后续是列表
    return (
      <div key={bIdx} className="chat-md-block">
        {lines.map((line, li) => {
          if (/^###\s+/.test(line)) {
            return <h4 key={li} className="chat-md-h4">{renderInlineMarkdown(line.replace(/^###\s+/, ""))}</h4>;
          }
          if (/^\s*[-*•]\s+/.test(line)) {
            return <p key={li} className="chat-md-bullet">· {renderInlineMarkdown(line.replace(/^\s*[-*•]\s+/, ""))}</p>;
          }
          return <p key={li} className="chat-md-p">{renderInlineMarkdown(line)}</p>;
        })}
      </div>
    );
  });
}

export function GlobalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchStr = searchParams.toString();

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<LauncherMode>("search");
  const [copilotCtx, setCopilotCtx] = useState<CopilotContextPreview | null>(null);
  const [initialData, setInitialData] = useState<SpotlightInitialData | null>(null);

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
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
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
    if (isOpen && mode === "search") {
      let cancelled = false;
      getSpotlightInitialData()
        .then((data) => {
          if (!cancelled) setInitialData(data);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
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
    }, 140);

    return () => clearTimeout(timer);
  }, [query, mode]);

  function navigateTo(href: string) {
    setIsOpen(false);
    router.push(href);
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
        navigateTo(results[selectedIndex].href);
      } else if (query.trim() && results.length === 0 && !isSearching) {
        handleAskAiFromSearch(query.trim());
      }
    }
  }

  // 识别当前页面上下文（含 pathname + query）
  useEffect(() => {
    if (isOpen) {
      let cancelled = false;
      getCopilotContextPreview(pathname || "/", searchStr)
        .then((ctx) => {
          if (!cancelled) setCopilotCtx(ctx);
        })
        .catch(() => {
          if (!cancelled) setCopilotCtx(null);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [isOpen, mode, pathname, searchStr]);

  async function sendChatMessage(promptText?: string) {
    const textToSend = (promptText ?? chatInput).trim();
    if (!textToSend || isAnswering) return;

    const newHistory: ChatMessage[] = [...chatHistory, { role: "user", content: textToSend }];
    setChatHistory(newHistory);
    setChatInput("");
    setIsAnswering(true);

    try {
      const reply = await chatWithAiAssistant(newHistory, {
        pathname: pathname || "/",
        search: searchStr,
      });
      setChatHistory([
        ...newHistory,
        {
          role: "assistant",
          content: reply.content,
          source: reply.source,
          modelLabel: reply.modelLabel,
        },
      ]);
    } catch {
      setChatHistory([
        ...newHistory,
        {
          role: "assistant",
          content: "AI 响应异常，请检查网络或「设置 → 大模型设置」中的 API Key 配置。",
          source: "local",
          modelLabel: "系统提示",
        },
      ]);
    } finally {
      setIsAnswering(false);
    }
  }

  function handleAskAiFromSearch(term: string) {
    setMode("chat");
    setQuery("");
    void sendChatMessage(`帮我分析或查找与「${term}」相关的选品、成本或运营建议`);
  }

  function handleCopyMessage(idx: number, text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => {
        setCopiedIdx((curr) => (curr === idx ? null : curr));
      }, 1500);
    }).catch(() => {});
  }

  function handleClearChat() {
    setChatHistory([DEFAULT_GREETING]);
    setCopiedIdx(null);
  }

  return (
    <>
      {/* 悬浮在右下角的复合图标胶囊 */}
      <button
        type="button"
        className="floating-assistant-launcher"
        onClick={() => setIsOpen(true)}
        title="打开 AI 操盘手助手与全域搜索 (快捷键 ⌘K 或 Ctrl+K)"
        aria-label="打开 AI 助手与全域搜索"
      >
        <div className="launcher-icon-badge">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="6" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M14.5 14.5L19.5 19.5" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
            <path
              d="M19 1.5C19 3.4 20.6 5 22.5 5C20.6 5 19 6.6 19 8.5C19 6.6 17.4 5 15.5 5C17.4 5 19 3.4 19 1.5Z"
              fill="#93c5fd"
            />
            <circle cx="6" cy="10" r="1.2" fill="#93c5fd" />
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
              <div className="modal-header-right">
                {mode === "chat" && chatHistory.length > 1 ? (
                  <button
                    type="button"
                    className="search-clear-chat-btn"
                    onClick={handleClearChat}
                    title="清空当前对话记录"
                  >
                    清空对话
                  </button>
                ) : null}
                <button
                  type="button"
                  className="search-close-btn"
                  onClick={() => setIsOpen(false)}
                  title="关闭浮窗 (ESC)"
                >
                  ESC
                </button>
              </div>
            </div>

            {/* 模式 A：全域秒搜 + 命令面板 */}
            {mode === "search" && (
              <>
                <div className="global-search-input-wrap">
                  <span className="search-input-icon-box">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                  </span>
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="global-search-input"
                    placeholder="搜商品、ASIN、竞品研报、1688 工厂，或直达功能（如：汇率、备份、生图、实盘）..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                  />
                  {query ? (
                    <button
                      type="button"
                      className="search-input-clear"
                      onClick={() => setQuery("")}
                      aria-label="清空搜索词"
                    >
                      ×
                    </button>
                  ) : null}
                  {isSearching && <span className="search-spinner" />}
                </div>

                <div className="global-search-body">
                  {query.trim() === "" ? (
                    <div className="spotlight-home">
                      {initialData?.recentCases && initialData.recentCases.length > 0 ? (
                        <div className="spotlight-section">
                          <div className="spotlight-section-title">最近商品</div>
                          <ul className="global-search-list">
                            {initialData.recentCases.map((item) => (
                              <li
                                key={`recent-${item.id}`}
                                className="global-search-item"
                                onClick={() => navigateTo(item.href)}
                              >
                                <span className={`search-item-badge badge-${item.type}`}>
                                  {item.typeLabel}
                                </span>
                                <div className="search-item-info">
                                  <strong className="search-item-title">{item.title}</strong>
                                  <span className="search-item-sub">{item.subtitle}</span>
                                </div>
                                {item.quickLinks ? (
                                  <div className="search-item-quicklinks" onClick={(e) => e.stopPropagation()}>
                                    {item.quickLinks.map((ql) => (
                                      <button
                                        key={ql.href}
                                        type="button"
                                        className="search-quicklink-btn"
                                        onClick={() => navigateTo(ql.href)}
                                      >
                                        {ql.label}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div className="spotlight-section">
                        <div className="spotlight-section-title">常用功能直达</div>
                        <div className="spotlight-command-grid">
                          {(initialData?.quickCommands ?? []).map((cmd) => (
                            <button
                              key={cmd.id}
                              type="button"
                              className="spotlight-command-chip"
                              onClick={() => navigateTo(cmd.href)}
                            >
                              <strong>{cmd.title}</strong>
                              <span>{cmd.subtitle}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : results.length === 0 && !isSearching ? (
                    <div className="search-no-results">
                      <p>未找到与「<strong>{query}</strong>」匹配的商品、研报、工厂或功能</p>
                      <small>可尝试更简短的关键词、ASIN 编码，或直接转问 AI 操盘手</small>
                      <button
                        type="button"
                        className="button primary search-fallback-ai-btn"
                        onClick={() => handleAskAiFromSearch(query.trim())}
                      >
                        ✨ 转问 AI 操盘手：关于「{query.trim().slice(0, 18)}」
                      </button>
                    </div>
                  ) : (
                    <ul className="global-search-list">
                      {results.map((item, idx) => (
                        <li
                          key={`${item.type}-${item.id}`}
                          className={`global-search-item ${idx === selectedIndex ? "active" : ""}`}
                          onClick={() => navigateTo(item.href)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                        >
                          <span className={`search-item-badge badge-${item.type}`}>
                            {item.typeLabel}
                          </span>
                          <div className="search-item-info">
                            <strong className="search-item-title">{item.title}</strong>
                            <span className="search-item-sub">{item.subtitle}</span>
                          </div>
                          {item.quickLinks ? (
                            <div className="search-item-quicklinks" onClick={(e) => e.stopPropagation()}>
                              {item.quickLinks.map((ql) => (
                                <button
                                  key={ql.href}
                                  type="button"
                                  className="search-quicklink-btn"
                                  onClick={() => navigateTo(ql.href)}
                                >
                                  {ql.label}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="search-item-arrow">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"></polyline>
                              </svg>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="global-search-footer">
                  <div className="footer-shortcuts">
                    <span><kbd className="footer-kbd">ESC</kbd> 退出</span>
                  </div>
                  <span className="footer-brand">
                    {copilotCtx ? `当前：${copilotCtx.label}` : "AITrade Spotlight"}
                  </span>
                </div>
              </>
            )}

            {/* 模式 B：AI 业务对话助手 */}
            {mode === "chat" && (
              <div className="chat-mode-container">
                {copilotCtx ? (
                  <div className="copilot-context-bar">
                    <span className="copilot-context-dot" />
                    <span className="copilot-context-label">当前页面识别：{copilotCtx.label}</span>
                    <span className="copilot-context-badge mono">{copilotCtx.badge}</span>
                  </div>
                ) : null}
                <div className="chat-messages-scroll">
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`chat-bubble-row ${msg.role}`}>
                      <div className="chat-avatar">
                        {msg.role === "assistant" ? "✨" : "我"}
                      </div>
                      <div className="chat-bubble-card">
                        <div className="chat-bubble-head">
                          <span className="chat-bubble-role">
                            {msg.role === "assistant" ? "AITrade 智能操盘手" : "我"}
                          </span>
                          {msg.role === "assistant" && i > 0 ? (
                            <div className="chat-bubble-tools">
                              {msg.modelLabel ? (
                                <span className={`chat-source-tag ${msg.source === "ai" ? "is-ai" : "is-local"}`}>
                                  {msg.modelLabel}
                                </span>
                              ) : null}
                              {msg.source === "local" ? (
                                <button
                                  type="button"
                                  className="chat-tool-btn"
                                  onClick={() => navigateTo("/settings?tab=models")}
                                >
                                  配置模型
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="chat-tool-btn"
                                onClick={() => handleCopyMessage(i, msg.content)}
                              >
                                {copiedIdx === i ? "已复制" : "复制"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div className="chat-bubble-text markdown-render">
                          {renderAssistantMarkdown(msg.content)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {isAnswering && (
                    <div className="chat-bubble-row assistant">
                      <div className="chat-avatar">✨</div>
                      <div className="chat-bubble-card">
                        <span className="ai-typing-indicator">操盘手 AI 正在结合当前页面数据分析中...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* 快捷业务提问推荐芯片（随当前页面上下文动态切换） */}
                <div className="chat-quick-chips">
                  {(copilotCtx?.quickPrompts ?? [
                    { label: "18% 门禁倒推", prompt: "帮我分析商品 18% 净利门禁如何倒推采购成本？" },
                    { label: "1688 询价压价", prompt: "1688 首次询价如何与源头工厂谈 MOQ 和打样？" },
                    { label: "美日站点差异", prompt: "亚马逊美国站 vs 日本站选品注意哪些差异？" },
                    { label: "防侵权排查", prompt: "Listing 标题与外观如何规避专利与品牌侵权？" },
                  ]).map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => sendChatMessage(chip.prompt)}
                    >
                      {chip.label}
                    </button>
                  ))}
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
                    placeholder="结合当前页面提问（如利润门禁、压价话术、文案优化或实盘偏差）..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={isAnswering}
                  />
                  <button
                    type="submit"
                    className="button primary chat-send-btn"
                    disabled={!chatInput.trim() || isAnswering}
                  >
                    发送
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
