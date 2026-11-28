import { revalidatePath } from "next/cache";

/** 只接受站内相对路径，避免 returnPath 被用作开放重定向 */
export function safeReturnPath(value: FormDataEntryValue | null): string {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\r\n]/.test(raw)) return "/";
  return raw;
}

export function withQuery(path: string, key: "notice" | "error", message: string): string {
  const [base, hash] = path.split("#", 2);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${key}=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`;
}

export function integerFrom(value: FormDataEntryValue | null) {
  const number = Number(String(value ?? "0").replace(/[,\s]/g, ""));
  return Math.round(Number.isFinite(number) ? number : 0);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请检查输入";
}

export function revalidateAISourcing(runId: string) {
  revalidatePath("/");
  revalidatePath("/ai-sourcing");
  revalidatePath(`/ai-sourcing/${runId}`);
}

export function aiSourcingDetailPath(runId: string, key: "notice" | "error", message: string) {
  return `/ai-sourcing/${encodeURIComponent(runId)}?${key}=${encodeURIComponent(message)}`;
}

export function numberOrNull(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").replace(/[$,%\s]/g, "");
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

export function positiveIntegerOrNull(value: FormDataEntryValue | null) {
  const number = integerFrom(value);
  return number > 0 ? number : null;
}

export function dollarsToCents(value: FormDataEntryValue | null) {
  const number = Number(String(value ?? "0").replace(/[$,%\s]/g, ""));
  return Math.round((Number.isFinite(number) ? number : 0) * 100);
}

export function percentToRate(value: FormDataEntryValue | null) {
  const number = Number(String(value ?? "0").replace(/[%\s]/g, ""));
  return Math.min(1, Math.max(0, (Number.isFinite(number) ? number : 0) / 100));
}
