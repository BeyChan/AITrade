import Link from "next/link";
import {
  clearAIProviderKeyAction,
  saveAISettingsAction,
  testAISettingsAction,
} from "@/app/actions";
import { getAIProviderStatus } from "@/lib/ai-provider";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ notice?: string; error?: string }>;
};

export default async function SettingsPage({ searchParams }: PageProps) {
  const [query, provider] = await Promise.all([searchParams, getAIProviderStatus()]);
  const keyPlaceholder = provider.apiKeyConfigured
    ? `已配置 ${provider.apiKeyHint}，留空则保留现有 Key`
    : "粘贴 API Key；保存后只显示脱敏尾号";

  return (
    <div className="page settings-page">
      <div className="breadcrumb"><Link href="/">AI 选品</Link> / 系统设置</div>

      <section className="hero settings-hero">
        <div>
          <div className="eyebrow">系统设置 · 模型连接</div>
          <h1>大模型设置</h1>
          <p>
            默认使用本地模板，无需 API Key。需要生成更具体的选品假设时，可接入 Ollama 或 OpenAI 兼容接口。
            模型只负责提出待验证假设，是否通过仍由证据和确定性规则决定。
          </p>
        </div>
      </section>

      {query.notice ? <div className="notice"><strong>已完成：</strong>{query.notice}</div> : null}
      {query.error ? <div className="notice warn"><strong>未完成：</strong>{query.error}</div> : null}

      <div className="settings-layout">
        <form action={saveAISettingsAction} className="panel settings-form">
          <div className="panel-header">
            <div>
              <div className="eyebrow">模型连接</div>
              <h2>模型连接</h2>
              <p>填写后先点“测试连接”确认可用，再保存。测试不会保存表单内容，也不会把 Key 回显到页面。</p>
            </div>
            <div className="settings-current-summary">
              <span className={`badge ${provider.configured ? "badge-success" : "badge-neutral"}`}>
                {provider.configured ? "已连接" : "模板模式"}
              </span>
              <strong>{provider.model}</strong>
              <small>{provider.apiKeyConfigured ? provider.apiKeyHint : "未配置 Key"}</small>
            </div>
          </div>

          <div className="form-grid">
            <div className="field full">
              <label htmlFor="provider">模型服务商</label>
              <select id="provider" name="provider" defaultValue={provider.provider}>
                <option value="template">免 Key 模板模式（默认，无外部请求）</option>
                <option value="ollama">本地 Ollama（数据不出本机）</option>
                <option value="openai-compatible">OpenAI 兼容接口（OpenAI / DeepSeek / 自建服务）</option>
              </select>
              <small className="field-hint">切换服务商后，请同步填写对应的 Base URL 与模型名称。</small>
            </div>

            <div className="field full">
              <label htmlFor="baseUrl">Base URL</label>
              <input
                id="baseUrl"
                name="baseUrl"
                type="url"
                defaultValue={provider.baseUrl}
                placeholder="例如 https://api.openai.com/v1 或 http://127.0.0.1:11434"
                spellCheck={false}
              />
              <small className="field-hint">兼容接口会自动补全 `/v1/chat/completions`；如果填入完整 endpoint，则按原样使用。</small>
            </div>

            <div className="field">
              <label htmlFor="model">模型名称</label>
              <input
                id="model"
                name="model"
                type="text"
                defaultValue={provider.provider === "template" ? "" : provider.model}
                placeholder="例如 gpt-4.1-mini、deepseek-chat、qwen3"
                spellCheck={false}
              />
            </div>

            <div className="field">
              <label htmlFor="apiKey">API Key</label>
              <input
                id="apiKey"
                name="apiKey"
                type="password"
                autoComplete="new-password"
                placeholder={keyPlaceholder}
                spellCheck={false}
              />
              <small className="field-hint">只在服务端读取并加密保存在本机数据目录；不会进入 URL、页面 HTML 或审计日志。</small>
            </div>

            <div className="field full">
              <label htmlFor="actor">操作人</label>
              <input id="actor" name="actor" type="text" defaultValue="本机管理员" maxLength={80} />
              <small className="field-hint">保存设置与清除 Key 都会写入本地操作记录，但不会记录密钥内容。</small>
            </div>
          </div>

          <div className="settings-actions">
            <div className="button-row">
              <button type="submit" formAction={testAISettingsAction} formNoValidate className="button secondary">测试连接</button>
              <button type="submit" className="button primary">保存设置</button>
            </div>
            <span className="muted">密钥不会返回到浏览器；留空保存会保留已有 Key。</span>
          </div>
        </form>

        <aside className="settings-side">
          <section className="panel settings-info-card">
            <h2>配置如何使用</h2>
            <ul className="settings-guide-list">
              <li>页面保存的配置优先于环境变量。</li>
              <li>模型请求失败时回退到本地模板，不阻断选品流程。</li>
              <li>保存后，新建的选品研究批次会使用当前配置。</li>
            </ul>
          </section>

          <section className="panel settings-info-card">
            <h2>清除 API Key</h2>
            <p className="muted">只清除页面保存的 Key。环境变量中的 Key 需要在 `.env.local` 中手动删除。清除后模型生成会自动回退模板模式。</p>
            <form action={clearAIProviderKeyAction}>
              <input type="hidden" name="actor" value="本机管理员" />
              <button type="submit" className="button danger" disabled={provider.apiKeySource !== "database"}>清除已保存的 Key</button>
            </form>
          </section>

          <section className="panel settings-info-card settings-security">
            <div className="eyebrow">安全说明</div>
            <h2>安全边界</h2>
            <ul>
              <li>Key 使用 AES-256-GCM 加密后写入本机 `.data`，页面只显示末四位。</li>
              <li>测试和生成均由服务端发起；浏览器不接触完整 Key。</li>
              <li>模型输出仍是假设，不得伪造销量、评论、供应商、报价或利润。</li>
              <li>本系统不会自动联系供应商、下单、付款或发布平台。</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
