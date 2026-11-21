import Link from "next/link";
import type { ReactNode } from "react";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export type PageHeaderProps = {
  breadcrumbs?: BreadcrumbItem[];
  backLink?: {
    label: string;
    href: string;
    meta?: ReactNode;
  };
  eyebrow?: ReactNode;
  title: ReactNode;
  titleBadges?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  backLink,
  title,
  titleBadges,
  description,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={className ? `page-header-wrap ${className}` : "page-header-wrap"}>
      {backLink ? (
        <div className="page-header-back">
          <Link href={backLink.href}>{backLink.label}</Link>
          {backLink.meta ? <span className="page-header-back-meta">{backLink.meta}</span> : null}
        </div>
      ) : null}

      <header className="page-header">
        <div className="page-header-main">
          <div className="page-header-title-row">
            <h1 className="page-header-title">{title}</h1>
            {titleBadges ? <div className="page-header-title-badges">{titleBadges}</div> : null}
          </div>
          {description ? <p className="page-header-desc">{description}</p> : null}
          {meta ? <div className="page-header-meta">{meta}</div> : null}
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </header>
    </div>
  );
}
