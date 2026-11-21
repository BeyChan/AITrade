import path from "node:path";
import Link from "next/link";
import {
  clearAIProviderKeyAction,
  clearImageProviderKeyAction,
  saveAISettingsAction,
  saveImageSettingsAction,
  testAISettingsAction,
  testImageSettingsAction,
} from "@/app/actions";
import { getAIProviderStatus } from "@/lib/ai-provider";
import { getImageProviderStatus } from "@/lib/image-provider";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ notice?: string; error?: string }>;
};

export default async function SettingsPage({ searchParams }: PageProps) {
  const [query, provider, imageProvider] = await Promise.all([
    searchParams,
    getAIProviderStatus(),
    getImageProviderStatus(),
  ]);
  const workingDirectory = process.cwd();
  const configuredDataDirectory = process.env.PGLITE_DATA_DIR || ".data/aitrade";
  const dataDirectory = path.isAbsolute(configuredDataDirectory)
    ? configuredDataDirectory
    : path.resolve(/* turbopackIgnore: true */ workingDirectory, configuredDataDirectory);
  const keyPlaceholder = provider.apiKeyConfigured
    ? `已配置 ${provider.apiKeyHint}，留空保留`
    : "输入新的 API Key";
  const imageKeyPlaceholder = imageProvider.apiKeyConfigured
    ? `已配置 ${imageProvider.apiKeyHint}，留空保留`
    : "输入生图 API Key";

  return (
    <div className="page settings-page">
      <div className="breadcrumb"><Link href="/">AI 选品</Link> / 系统设置</div>

      <section className="hero settings-hero">
        <div>
          <div className="eyebrow">系统设置 · 模型连接</div>
          <h1>大模型设置</h1>
          <p>
            默认使用本地模板，无需 API Key。需要生成更具体的选品假设时，可接入 Ollama、OpenAI 兼容或 Anthropic 兼容接口。
            模型只负责提出待验证假设，是否通过仍由证据和确定性规则决定。
          </p>
        </div>
      </section>

      {query.notice ? <div className="notice"><strong>已完成：</strong>{query.notice}</div> : null}
      {query.error ? <div className="notice warn"><strong>未完成：</strong>{query.error}</div> : null}

      <div className="settings-layout">
        <div className="stack">
          <form
            key={`ai-${provider.provider}-${provider.model}-${provider.baseUrl}-${provider.apiKeyHint}`}
            action={saveAISettingsAction}
            className="panel settings-form"
          >
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
                <option value="anthropic-compatible">Anthropic 兼容协议（Claude / 兼容中转 / 自建）</option>
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
                OpenAI 使用 <code>https://api.openai.com/v1</code>，DeepSeek 使用 <code>https://api.deepseek.com/v1</code>，Anthropic 兼容使用 <code>https://api.anthropic.com</code> 或服务商 Anthropic 兼容根地址（自动拼接 <code>/v1/messages</code>，留空保存按服务商自动补全）。
              </small>
            </div>

            <div className="settings-credential-grid full">
              <div className="field">
                <label htmlFor="model">模型名称</label>
                <input
                  id="model"
                  name="model"
                  type="text"
                  defaultValue={provider.provider === "template" || provider.model === "未配置模型" ? "" : provider.model}
                  placeholder="例如 deepseek-chat 或 claude-sonnet-4-5"
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
                <small id="api-key-hint" className="field-hint">
                  仅服务端读取，AES-256-GCM 加密保存，不进入页面 HTML；也支持读取环境变量 <code>AI_API_KEY</code> 或 <code>ANTHROPIC_API_KEY</code>。
                </small>
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

          <form
            key={`image-${imageProvider.provider}-${imageProvider.model}-${imageProvider.baseUrl}-${imageProvider.apiKeyHint}`}
            action={saveImageSettingsAction}
            className="panel settings-form"
          >
            <div className="panel-header">
              <div>
                <div className="eyebrow">视觉生图 · 独立配置</div>
                <h2>视觉生图模型设置</h2>
                <p>供内容工作台文生图与图生图使用；默认仅输出结构化 Prompt，按需切换 Gemini、阿里云百炼、OpenAI 兼容或 Anthropic 兼容生图接口。</p>
              </div>
              <div className="settings-current-summary">
                <span className={`badge ${imageProvider.configured && imageProvider.provider !== "template" ? "badge-success" : "badge-neutral"}`}>
                  {imageProvider.provider === "template" ? "提示词模式" : imageProvider.configured ? "已连接" : "待配置"}
                </span>
                <strong>当前：{imageProvider.model}</strong>
                <small>{imageProvider.apiKeyConfigured ? imageProvider.apiKeyHint : "未配置 Key"}</small>
              </div>
            </div>

            <div className="form-grid settings-form-grid">
              <div className="field full">
                <label htmlFor="imageProvider">生图服务商</label>
                <select id="imageProvider" name="provider" defaultValue={imageProvider.provider}>
                  <option value="template">免 Key 提示词模式（默认，仅生成专业 Prompt）</option>
                  <option value="dashscope">阿里云百炼（通义万相 Wan / Qwen-Image 原生接口）</option>
                  <option value="gemini">Google Gemini 生图（Interactions API · Nano Banana 2.1）</option>
                  <option value="openai-compatible">OpenAI 兼容生图接口（gpt-image-1 / 中转兼容）</option>
                  <option value="anthropic-compatible">Anthropic 兼容协议（Messages 多模态 / 中转兼容）</option>
                </select>
                <small className="field-hint">阿里云百炼推荐 <code>qwen-image-plus</code>、<code>wan2.6-t2i</code> 或 <code>wan2.6-image</code>；Gemini 推荐 <code>gemini-nano-banana-2.1</code>；Anthropic 兼容请填写支持生图的网关模型 ID。</small>
              </div>

              <div className="field full">
                <label htmlFor="imageBaseUrl">Base URL</label>
                <input
                  id="imageBaseUrl"
                  name="baseUrl"
                  type="url"
                  defaultValue={imageProvider.baseUrl}
                  placeholder="https://generativelanguage.googleapis.com"
                  spellCheck={false}
                />
                <small className="field-hint">
                  阿里云百炼使用 <code>https://dashscope.aliyuncs.com</code>（新加坡站用 <code>https://dashscope-intl.aliyuncs.com</code>），Gemini 用 <code>https://generativelanguage.googleapis.com</code>，Anthropic 兼容用 <code>https://api.anthropic.com</code> 或兼容中转根地址，留空保存按服务商自动补全。
                </small>
              </div>

              <div className="settings-credential-grid full">
                <div className="field">
                  <label htmlFor="imageModel">生图模型名称</label>
                  <input
                    id="imageModel"
                    name="model"
                    type="text"
                    defaultValue={imageProvider.provider === "template" || imageProvider.model === "未配置模型" ? "" : imageProvider.model}
                    placeholder="例如 gemini-nano-banana-2.1、qwen-image-plus 或 gpt-image-1"
                    spellCheck={false}
                  />
                  <small className="field-hint">支持 Gemini Nano Banana、阿里云百炼、OpenAI Images 与 Anthropic 兼容网关模型 ID。</small>
                </div>

                <div className="field">
                  <label htmlFor="imageApiKey">生图 API Key</label>
                  <input
                    id="imageApiKey"
                    name="apiKey"
                    type="password"
                    autoComplete="new-password"
                    placeholder={imageKeyPlaceholder}
                    spellCheck={false}
                  />
                  <small className="field-hint">
                    {imageProvider.apiKeyConfigured ? (
                      <span style={{ color: "var(--green)", fontWeight: 700 }}>
                        ✓ 已加密保存 Key（{imageProvider.apiKeyHint}），留空保存将继续沿用，无需重填。
                      </span>
                    ) : (
                      <>
                        支持读取环境变量 <code>IMAGE_API_KEY</code>、<code>DASHSCOPE_API_KEY</code>、<code>GEMINI_API_KEY</code> 或 <code>ANTHROPIC_API_KEY</code>。
                      </>
                    )}
                  </small>
                </div>
              </div>
            </div>

            <div className="settings-actions">
              <div className="field settings-actor">
                <label htmlFor="imageActor">操作人</label>
                <input id="imageActor" name="actor" type="text" defaultValue="本机管理员" maxLength={80} />
                <small className="field-hint">操作会写入审计记录，不记录 Key。</small>
              </div>
              <div className="settings-submit">
                <div className="button-row">
                  <button type="submit" formAction={testImageSettingsAction} formNoValidate className="button secondary">测试生图连接</button>
                  <button type="submit" className="button primary">保存生图设置</button>
                </div>
                <span className="muted">留空保存会保留当前生图 Key。</span>
              </div>
            </div>
          </form>
        </div>

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
            <div className="stack" style={{ gap: 10 }}>
              <form action={clearAIProviderKeyAction}>
                <input type="hidden" name="actor" value="本机管理员" />
                <button type="submit" className="button danger" disabled={provider.apiKeySource !== "database"}>清除文本大模型 Key</button>
              </form>
              <form action={clearImageProviderKeyAction}>
                <input type="hidden" name="actor" value="本机管理员" />
                <button type="submit" className="button danger" disabled={imageProvider.apiKeySource !== "database"}>清除视觉生图 Key</button>
              </form>
            </div>
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
