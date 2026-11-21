import path from "node:path";
import Link from "next/link";
import { ModelProfilesManager } from "@/components/model-profiles-manager";
import { getAIProviderStatus } from "@/lib/ai-provider";
import { getImageProviderStatus } from "@/lib/image-provider";
import { MODEL_VENDOR_PRESETS, listModelProfiles } from "@/lib/model-profiles";
import { getVideoProviderStatus } from "@/lib/video-provider";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ notice?: string; error?: string }>;
};

export default async function SettingsPage({ searchParams }: PageProps) {
  const [query, provider, imageProvider, videoProvider, profiles] = await Promise.all([
    searchParams,
    getAIProviderStatus(),
    getImageProviderStatus(),
    getVideoProviderStatus(),
    listModelProfiles(),
  ]);
  const workingDirectory = process.cwd();
  const configuredDataDirectory = process.env.PGLITE_DATA_DIR || ".data/aitrade";
  const dataDirectory = path.isAbsolute(configuredDataDirectory)
    ? configuredDataDirectory
    : path.resolve(/* turbopackIgnore: true */ workingDirectory, configuredDataDirectory);

  return (
    <div className="page settings-page">
      <div className="breadcrumb"><Link href="/">AI 选品</Link> / 大模型设置</div>

      <section className="hero settings-hero">
        <div>
          <div className="eyebrow">系统设置 · 模型配置中心</div>
          <h1>大模型设置</h1>
          <p>
            统一管理文本、图片、视频三类模型与中转网关。未配置时默认运行在免 Key 本地模板模式；
            模型只负责提出待验证假设与素材草稿，是否立项与上架仍由确定性规则和人工确认决定。
          </p>
        </div>
      </section>

      {query.notice ? <div className="notice"><strong>已完成：</strong>{query.notice}</div> : null}
      {query.error ? <div className="notice warn"><strong>未完成：</strong>{query.error}</div> : null}

      {/* 当前生效默认模型摘要条 */}
      <section className="dashboard-kpi-grid" aria-label="当前生效模型摘要" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="dashboard-kpi-card">
          <div className="kpi-meta">
            <span className="kpi-label">默认文本模型</span>
            <span className={`badge ${provider.configured && provider.provider !== "template" ? "badge-success" : "badge-neutral"}`}>
              {provider.provider === "template" ? "模板模式" : provider.configured ? "已生效" : "待配置"}
            </span>
          </div>
          <div className="kpi-value-row" style={{ marginTop: "6px" }}>
            <strong style={{ fontSize: "15px", fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{provider.model}</strong>
          </div>
          <div className="kpi-sub">
            <span>{provider.label} · {provider.apiKeyConfigured ? provider.apiKeyHint : "未配置 Key"}</span>
          </div>
        </div>

        <div className="dashboard-kpi-card">
          <div className="kpi-meta">
            <span className="kpi-label">默认图片模型</span>
            <span className={`badge ${imageProvider.configured && imageProvider.provider !== "template" ? "badge-success" : "badge-neutral"}`}>
              {imageProvider.provider === "template" ? "提示词模式" : imageProvider.configured ? "已生效" : "待配置"}
            </span>
          </div>
          <div className="kpi-value-row" style={{ marginTop: "6px" }}>
            <strong style={{ fontSize: "15px", fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{imageProvider.model}</strong>
          </div>
          <div className="kpi-sub">
            <span>{imageProvider.label} · {imageProvider.apiKeyConfigured ? imageProvider.apiKeyHint : "未配置 Key"}</span>
          </div>
        </div>

        <div className="dashboard-kpi-card">
          <div className="kpi-meta">
            <span className="kpi-label">默认视频模型</span>
            <span className={`badge ${videoProvider.configured && videoProvider.provider !== "template" ? "badge-success" : "badge-neutral"}`}>
              {videoProvider.provider === "template" ? "分镜脚本模式" : videoProvider.configured ? "已生效" : "待配置"}
            </span>
          </div>
          <div className="kpi-value-row" style={{ marginTop: "6px" }}>
            <strong style={{ fontSize: "15px", fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{videoProvider.model}</strong>
          </div>
          <div className="kpi-sub">
            <span>{videoProvider.label} · {videoProvider.apiKeyConfigured ? videoProvider.apiKeyHint : "未配置 Key"}</span>
          </div>
        </div>
      </section>

      {/* 统一模型配置列表 + 添加/编辑弹窗 + 导入导出 */}
      <ModelProfilesManager initialProfiles={profiles} presets={MODEL_VENDOR_PRESETS} />

      {/* 本机运行位置与安全边界 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "18px" }}>
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
            页面保存的 API Key 与模型列表只对当前数据库目录有效；导出配置默认脱敏不含 API Key，可安全备份或团队共享。
          </p>
        </section>

        <section className="panel settings-info-card settings-security">
          <div className="eyebrow">安全说明</div>
          <h2>安全边界</h2>
          <ul>
            <li>Key 使用 AES-256-GCM 加密后写入本机 <code>.data</code>，页面与列表仅显示末四位。</li>
            <li>连接测试和模型调用均由服务端发起；浏览器不接触完整 Key。</li>
            <li>模型输出仍是假设或草稿，不得伪造销量、评论、供应商报价或商品实拍外观。</li>
            <li>本系统不会自动联系供应商、下单、付款或发布平台。</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
