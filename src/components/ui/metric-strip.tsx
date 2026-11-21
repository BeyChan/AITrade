import type { ReactNode } from "react";

export type MetricCardItem = {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "default" | "success" | "warn" | "danger";
};

export type MetricGridProps = {
  items: MetricCardItem[];
  columns?: 2 | 3 | 4 | 5;
  ariaLabel?: string;
  className?: string;
};

export function MetricGrid({ items, columns, ariaLabel, className }: MetricGridProps) {
  const colCount = columns ?? (items.length <= 3 ? (items.length as 2 | 3) : 4);
  const colClass = `metrics-grid-cols-${colCount}`;
  return (
    <section
      className={["metrics-grid", colClass, className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
    >
      {items.map((item, idx) => {
        const valueClass =
          item.tone && item.tone !== "default"
            ? `metric-value metric-value-${item.tone}`
            : "metric-value";
        return (
          <article className="metric-card" key={`${item.label}-${idx}`}>
            <div className="metric-label">{item.label}</div>
            <div className={valueClass}>{item.value}</div>
            {item.note ? <div className="metric-note">{item.note}</div> : null}
          </article>
        );
      })}
    </section>
  );
}
