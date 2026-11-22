import path from "node:path";
import { ModelProfilesManager } from "@/components/model-profiles-manager";
import { WorkspaceBackupCard } from "@/components/workspace-backup-card";
import { GeneralSettingsPanel } from "@/components/general-settings-panel";
import { PageHeader, QueryNotices } from "@/components/ui";
import { getAppMode } from "@/lib/app-mode";
import { getAIProviderStatus } from "@/lib/ai-provider";
import { getImageProviderStatus } from "@/lib/image-provider";
import { MODEL_VENDOR_PRESETS, listModelProfiles } from "@/lib/model-profiles";
import { getVideoProviderStatus } from "@/lib/video-provider";

export const dynamic = "force-dynamic";

type SettingsTab = "general" | "models" | "backup";

type PageProps = {
  searchParams: Promise<{ tab?: string; notice?: string; error?: string }>;
};

function resolveTab(raw?: string): SettingsTab {
  if (raw === "models" || raw === "backup" || raw === "general") return raw;
  return "general";
}

const TAB_META: Record<SettingsTab, { title: string; eyebrow: string; description: string }> = {
  general: {
    title: "常规设置",
    eyebrow: "设置 · 数据模式与运行环境",
    description: "切换真实业务 / 演示沙盒模式，并查看本机数据库目录与安全边界。",
  },
  models: {
    title: "大模型设置",
    eyebrow: "设置 · 文本 / 图片 / 视频模型",
    description: "统一管理文本、图片、视频三类大模型配置，支持一键切换默认模型与脱敏导入导出。",
  },
  backup: {
    title: "数据与备份",
    eyebrow: "设置 · 整库备份、恢复预检与口令保护",
    description: "一键导出脱敏业务备份 JSON，支持恢复前 Dry-run 预检、自动快照与应急恢复指引。",
  },
};

export default async function SettingsPage({ searchParams }: PageProps) {
  const [query, provider, imageProvider, videoProvider, profiles, mode] = await Promise.all([
    searchParams,
    getAIProviderStatus(),
    getImageProviderStatus(),
    getVideoProviderStatus(),
    listModelProfiles(),
    getAppMode(),
  ]);
  const activeTab = resolveTab(query.tab);
  const meta = TAB_META[activeTab];
  const pinEnabled = Boolean(process.env.APP_ACCESS_PIN?.trim());
  const workingDirectory = process.cwd();
  const configuredDataDirectory = process.env.PGLITE_DATA_DIR || ".data/aitrade";
  const dataDirectory = path.isAbsolute(configuredDataDirectory)
    ? configuredDataDirectory
    : path.resolve(/* turbopackIgnore: true */ workingDirectory, configuredDataDirectory);

  return (
    <div className="page settings-page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "设置", href: "/settings?tab=general" },
          { label: meta.title },
        ]}
        eyebrow={meta.eyebrow}
        title={meta.title}
        description={meta.description}
      />

      <QueryNotices notice={query.notice} error={query.error} />

      {activeTab === "general" ? (
        <>
          <GeneralSettingsPanel currentMode={mode} />

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
        </>
      ) : null}

      {activeTab === "models" ? (
        <>
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
        </>
      ) : null}

      {activeTab === "backup" ? (
        <WorkspaceBackupCard pinEnabled={pinEnabled} />
      ) : null}
    </div>
  );
}
