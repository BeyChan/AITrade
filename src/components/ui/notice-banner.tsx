import type { ReactNode } from "react";

export type NoticeTone = "info" | "warn" | "success" | "danger";

export type NoticeBannerProps = {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  className?: string;
};

export function NoticeBanner({
  tone = "info",
  title,
  children,
  className,
}: NoticeBannerProps) {
  const toneClass =
    tone === "warn"
      ? "warn"
      : tone === "danger"
        ? "warn notice-danger"
        : tone === "success"
          ? "notice-success"
          : "";
  const classes = ["notice", toneClass, className].filter(Boolean).join(" ");
  return (
    <div className={classes} role={tone === "warn" || tone === "danger" ? "alert" : "status"}>
      {title ? <strong>{title}</strong> : null}
      <span>{children}</span>
    </div>
  );
}

export type QueryNoticesProps = {
  notice?: string | null;
  error?: string | null;
  extraError?: string | null;
  extraErrorTitle?: string;
};

export function QueryNotices({
  notice,
  error,
  extraError,
  extraErrorTitle = "任务提示：",
}: QueryNoticesProps) {
  if (!notice && !error && !extraError) return null;
  return (
    <>
      {notice ? <NoticeBanner tone="info" title="已完成：">{notice}</NoticeBanner> : null}
      {error ? <NoticeBanner tone="warn" title="未完成：">{error}</NoticeBanner> : null}
      {extraError ? <NoticeBanner tone="warn" title={extraErrorTitle}>{extraError}</NoticeBanner> : null}
    </>
  );
}
