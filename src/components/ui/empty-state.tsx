import type { ReactNode } from "react";

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headingLevel?: "h1" | "h2" | "h3";
  className?: string;
};

export function EmptyState({
  title,
  description,
  actions,
  headingLevel = "h3",
  className,
}: EmptyStateProps) {
  const Heading = headingLevel;
  return (
    <div className={className ? `empty-state ${className}` : "empty-state"}>
      <Heading>{title}</Heading>
      {description ? <p>{description}</p> : null}
      {actions ? <div className="empty-state-actions button-row">{actions}</div> : null}
    </div>
  );
}
