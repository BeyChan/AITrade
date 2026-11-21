"use client";

type Props = {
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function StudioLoadingCard({ title, subtitle, actionLabel, onAction }: Props) {
  return (
    <div className="panel" style={{ overflow: "hidden" }}>
      <div className="studio-loading-media" style={{ minHeight: "128px", padding: "18px 20px" }}>
        <div className="studio-loading-inner">
          <span className="studio-spinner studio-spinner-lg" aria-hidden="true" />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "13.5px", fontWeight: 700, color: "var(--ink)" }}>{title}</div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>{subtitle}</div>
          </div>
          {actionLabel && onAction ? (
            <button
              type="button"
              className="button ghost"
              style={{ minHeight: "28px", padding: "0 12px", fontSize: "12px", marginTop: "4px" }}
              onClick={onAction}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
