import Link from "next/link";
import { shortDate } from "@/lib/format";
import type { TerminatedCase } from "@/lib/repository";
import { RestoreCaseButton } from "./case-lifecycle-controls";

/**
 * 已终止商品折叠面板：在哪个列表终止，就在哪个列表恢复。
 * 首页按当前站点传入过滤后的列表；内容工作台传入全量列表。
 */
export function TerminatedCasesPanel({
  entries,
  returnPath,
  id = "terminated-cases",
}: {
  entries: TerminatedCase[];
  returnPath: string;
  id?: string;
}) {
  if (entries.length === 0) return null;

  return (
    <details className="dashboard-terminated" id={id} style={{ borderTop: "1px solid var(--line)" }}>
      <summary style={{ cursor: "pointer", padding: "14px 22px", fontWeight: 700, fontSize: "13px" }}>
        已终止（{entries.length}）· 展开查看原因或恢复
      </summary>
      <div style={{ padding: "0 22px 18px" }}>
        <p className="muted" style={{ fontSize: "12px", lineHeight: "1.5", marginTop: 0 }}>
          终止只改变商品状态，成本模型、报价、定标、证据与 Listing 草稿全部保留；恢复后重新出现在商品进度与内容工作台。此操作不删除任何数据。
        </p>
        {entries.map((entry) => (
          <article
            key={entry.caseItem.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
              padding: "12px 14px",
              marginBottom: "8px",
              border: "1px solid var(--line)",
              borderRadius: "10px",
              background: "#fbfcfa",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: "13px" }}>{entry.caseItem.title}</strong>
              <div className="muted" style={{ fontSize: "11px", marginTop: "4px" }}>
                原因：{entry.reason}
                {entry.archivedAt ? ` · ${shortDate(entry.archivedAt)}` : ""}
                {entry.archivedBy ? ` · ${entry.archivedBy}` : ""}
              </div>
            </div>
            <div className="dashboard-row-actions">
              <Link href={`/cases/${entry.caseItem.id}`} className="button ghost">查看详情</Link>
              <RestoreCaseButton
                caseId={entry.caseItem.id}
                title={entry.caseItem.title}
                returnPath={`${returnPath}#${id}`}
              />
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}
