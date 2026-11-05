import path from "node:path";
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
  const workingDirectory = process.cwd();
  const configuredDataDirectory = process.env.PGLITE_DATA_DIR || ".data/aitrade";
  const dataDirectory = path.isAbsolute(configuredDataDirectory)
    ? configuredDataDirectory
    : path.resolve(/* turbopackIgnore: true */ workingDirectory, configuredDataDirectory);
  const keyPlaceholder = provider.apiKeyConfigured
    ? `已配置 ${provider.apiKeyHint}，留空保留`
    : "输入新的 API Key";

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
              <div className="eyebrow">连接配置</div>
              <h2>模型服务</h2>
              <p>先测试连接，再保存。测试只检查当前表单，不会保存配置或回显 Key。</p>
            </div>
            <div className="settings-current-summary">
              <span className={`badge ${provider.configured && provider.provider !== "template" ? "badge-success" : "badge-neutral"}`}>
                {provider.provider === "template" ? "模板模式" : provider.configured ? "已连接" : "待配置"}
              </span>
              <strong>当前：{provider.model}</strong>
              <small>{provider.apiKeyConfigured ? provider.apiKeyHint : "未配置 Key"}</small>
            </div>
          </div>

          <div className="form-grid settings-form-grid">
            <div className="field full">
              <label htmlFor="provider">模型服务商</label>
              <select id="provider" name="provider" defaultValue={provider.provider} aria-describedby="provider-hint">
                <option value="template">免 Key 模板模式（默认，无外部请求）</option>
                <option value="ollama">本地 Ollama（数据不出本机）</option>
                <option value="openai-compatible">OpenAI 兼容接口（OpenAI / DeepSeek / 自建）</option>
              </select>
              <small id="provider-hint" className="field-hint">服务商、Base URL 和模型名称需要匹配。</small>
            </div>

            <div className="field full">
              <label htmlFor="baseUrl">Base URL</label>
              <input
                id="baseUrl"
                name="baseUrl"
                type="url"
                defaultValue={provider.baseUrl}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
                aria-describedby="base-url-hint"
              />
              <small id="base-url-hint" className="field-hint">
                OpenAI 使用 <code>https://api.openai.com/v1</code>，DeepSeek 使用 <code>https://api.deepseek.com/v1</code>。
              </small>
            </div>

            <div className="settings-credential-grid full">
              <div className="field">
                <label htmlFor="model">模型名称</label>
                <input
                  id="model"
                  name="model"
                  type="text"
                  defaultValue={provider.provider === "template" ? "" : provider.model}
                  placeholder="例如 deepseek-chat"
                  spellCheck={false}
                />
                <small className="field-hint">填写服务商控制台中的准确模型 ID。</small>
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
                  aria-describedby="api-key-hint"
                />
                <small id="api-key-hint" className="field-hint">仅服务端读取，AES-256-GCM 加密保存，不进入页面 HTML。</small>
              </div>
            </div>
          </div>

          <div className="settings-actions">
            <div className="field settings-actor">
              <label htmlFor="actor">操作人</label>
              <input id="actor" name="actor" type="text" defaultValue="本机管理员" maxLength={80} />
              <small className="field-hint">操作会写入本地审计记录，不记录 Key。</small>
            </div>
            <div className="settings-submit">
              <div className="button-row">
                <button type="submit" formAction={testAISettingsAction} formNoValidate className="button secondary">测试连接</button>
                <button type="submit" className="button primary">保存设置</button>
              </div>
              <span className="muted">留空保存会保留当前 Key。</span>
            </div>
          </div>
        </form>

        <aside className="settings-side">
          <section className="panel settings-info-card settings-runtime">
            <div className="eyebrow">本机运行位置</div>
            <h2>当前使用哪套数据</h2>
            <dl>
              <div>
                <dt>工作目录</dt>
                <dd><code>{workingDirectory}</code></dd>
              </div>
              <div>
                <dt>数据库目录</dt>
                <dd><code>{dataDirectory}</code></dd>
              </div>
              <div>
                <dt>Key 文件</dt>
                <dd><code>{`${dataDirectory}.ai-key`}</code></dd>
              </div>
            </dl>
            <p className="muted">
              从不同目录或 worktree 启动会使用不同数据。页面保存的 API Key 只对当前数据库目录有效。
            </p>
          </section>

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
