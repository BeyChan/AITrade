import Link from "next/link";
import { ConnectionCheckButton } from "@/components/connection-check";
import { clearConnectorSettingsAction, saveConnectorSettingsAction } from "./actions";
import { getLatestConnectorHealthChecks } from "@/lib/connection-diagnostics";
import { getConnectorSettingsStatus, loadConnectorEnv } from "@/lib/connector-settings";
import { getConnectorReadiness } from "@/lib/connectors/registry";
import type { ConnectorHealthCheckRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ notice?: string; error?: string }>;
};

const statusLabels: Record<string, string> = {
  verified: "只读验证通过",
  credentials_valid: "应用凭证通过",
  failed: "检查失败",
  unsupported: "尚未接入",
  pending: "待验证",
  not_configured: "未配置",
};

const platformOrder = ["amazon_sp_api", "shopify", "ebay", "tiktok_shop", "alibaba_1688"];

export default async function ConnectionsPage({ searchParams }: Props) {
  const query = await searchParams;
  const [healthChecks, env, settingsStatus] = await Promise.all([
    getLatestConnectorHealthChecks(),
    loadConnectorEnv(),
    getConnectorSettingsStatus(),
  ]);
  const sources = getConnectorReadiness(env);
  const checkByCode = new Map(healthChecks.map((check) => [check.source_code, check]));
  const platformSources = platformOrder
    .map((code) => sources.find((source) => source.code === code))
    .filter((source): source is NonNullable<typeof source> => Boolean(source));
  const verifiedCount = healthChecks.filter(
    (check) => check.status === "verified" || check.status === "credentials_valid",
  ).length;

  return (
    <div className="page">
      <div className="breadcrumb"><Link href="/">AI 选品</Link> / 连接中心</div>

      <section className="hero connection-hero">
        <div>
          <div className="eyebrow">连接核验</div>
          <h1>店铺连接先验证，<br />再开放任何写动作。</h1>
          <p>
            这里只执行官方 API 的只读授权检查：Amazon 验证 LWA 与 Seller API，Shopify 读取店铺基本信息，eBay 只验证应用凭证。
            凭证可直接在本页填写，AES-256-GCM 加密后存入本机数据库；页面不回显完整值，审计日志只记录字段名。
          </p>
        </div>
        <Link className="button secondary" href="/data-sources">回到数据源</Link>
      </section>

      {query.notice ? <div className="notice"><strong>已完成：</strong>{query.notice}</div> : null}
      {query.error ? <div className="notice warn"><strong>未完成：</strong>{query.error}</div> : null}

      <section className="metrics-grid" aria-label="连接器指标">
        <article className="metric-card">
          <div className="metric-label">已支持诊断</div>
          <div className="metric-value">3</div>
          <div className="metric-note">Amazon / Shopify / eBay</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">验证通过</div>
          <div className="metric-value">{verifiedCount}</div>
          <div className="metric-note">包含应用凭证级验证</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">写连接</div>
          <div className="metric-value">0</div>
          <div className="metric-note">发布、改价、库存与订单写入均未开放</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">外部动作</div>
          <div className="metric-value connection-readonly-value">READ ONLY</div>
          <div className="metric-note">不发送 RFQ、不定标、不下单或付款</div>
        </article>
      </section>

      <div className="notice source-notice">
        <span className="badge badge-success">CONNECTION GUARD</span>
        <span>
          <strong>“验证通过”不等于“允许发布”。</strong> 当前只确认凭证和只读权限；Amazon、Shopify、eBay 的写 Adapter、平台 dry-run、发布确认和回执仍未实现。
        </span>
      </div>

      <section className="connection-grid">
        {platformSources.map((source) => {
          const latest = checkByCode.get(source.code);
          const supported = source.diagnostic === "seller_read" || source.diagnostic === "application_credentials";
          const displayStatus = supported
            ? latest?.status ?? (source.configured ? "pending" : "not_configured")
            : "unsupported";
          const settings = settingsStatus.get(source.code);
          const fields = settings?.fields ?? [];
          const configuredCount = fields.filter((field) => field.source !== "none").length;
          return (
            <article className="connection-card" key={source.code}>
              <div className="connection-card-head">
                <div>
                  <div className="eyebrow">{source.kind.toUpperCase()}</div>
                  <h2>{source.name}</h2>
                </div>
                <span className={`source-status ${statusClass(displayStatus)}`}>
                  <span className="source-status-dot" />
                  {statusLabels[displayStatus] ?? displayStatus}
                </span>
              </div>
              <p>{source.note}</p>

              <section className="connection-settings">
                <div className="connection-settings-head">
                  凭证设置 · {configuredCount}/{fields.length} 项已配置
                  {settings?.hasUiSettings ? <span className="badge badge-success">本机已保存</span> : null}
                </div>
                <form action={saveConnectorSettingsAction} className="connection-settings-form">
                  <input type="hidden" name="code" value={source.code} />
                  <input type="hidden" name="actor" value="本机管理员" />
                  {fields.map((field) => (
                    <div className="field" key={field.name}>
                      <label htmlFor={`${source.code}-${field.name}`}>{field.name}</label>
                      <input
                        id={`${source.code}-${field.name}`}
                        name={field.name}
                        type={field.sensitive ? "password" : "text"}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={field.source === "none" ? "未配置，请填写" : "已配置，留空保持原值"}
                      />
                      <small className="field-hint">
                        {field.source === "ui"
                          ? "界面已保存（优先于环境变量）"
                          : field.source === "environment"
                            ? "来自环境变量（回退）"
                            : "未配置"}
                      </small>
                    </div>
                  ))}
                  <div className="button-row">
                    <button type="submit" className="button primary compact-button">保存配置</button>
                    <button
                      type="submit"
                      formAction={clearConnectorSettingsAction}
                      className="button danger compact-button"
                      disabled={!settings?.hasUiSettings}
                    >
                      清除已保存配置
                    </button>
                  </div>
                  <p className="muted">
                    凭证加密后写入本机数据库，页面不回显；留空字段保持原值。保存后无需重启服务，运行只读检查即可生效。
                  </p>
                </form>
              </section>

              <div className="connection-check-block">
                <span>最近检查</span>
                {latest ? (
                  <>
                    <strong>{latest.message}</strong>
                    <small>{formatCheckTime(latest)} · {latest.duration_ms} ms · 检查人 {latest.checked_by}</small>
                  </>
                ) : (
                  <small>尚未检查。未配置时不会发起任何外部请求。</small>
                )}
              </div>

              <div className="connection-card-footer">
                <ConnectionCheckButton code={source.code} name={source.name} supported={supported} />
                {source.docsUrl ? (
                  <a className="text-link" href={source.docsUrl} target="_blank" rel="noreferrer">官方文档 ↗</a>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      <section className="panel connection-guide">
        <div className="panel-header">
          <div>
            <h2>安全配置顺序</h2>
            <p>优先在上方卡片的「凭证设置」中填写，无需改 `.env.local`、无需重启。值只保存在本机数据库，不要粘贴到聊天、CSV 或源码。</p>
          </div>
        </div>
        <div className="source-steps connection-steps">
          <span><b>01</b> 在官方开发者平台创建应用，完成店铺或卖家授权。</span>
          <span><b>02</b> 在对应卡片的「凭证设置」中填写并保存；环境变量仍可作为回退。</span>
          <span><b>03</b> 在本页运行只读检查，保存后立即生效；失败时只检查 HTTP 状态、权限范围和官方后台。</span>
          <span><b>04</b> 只读验证通过后，再实现平台 dry-run、人工发布确认和外部回执，不能跳步开放写动作。</span>
        </div>
      </section>
    </div>
  );
}

function statusClass(status: string) {
  if (status === "verified" || status === "credentials_valid") return "configured";
  if (status === "failed") return "failed";
  if (status === "pending") return "pending";
  if (status === "unsupported") return "planned";
  return "not_configured";
}

function formatCheckTime(check: ConnectorHealthCheckRow) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(check.checked_at));
}
