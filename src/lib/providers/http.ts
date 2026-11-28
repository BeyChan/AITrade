/**
 * 统一的外部 AI / 图片 / 视频供应商公共工具：
 * - API Key 脱敏展示
 * - 错误信息中的密钥/Token 脱敏
 * - 统一 HTTP 错误解析与归一化
 */

export function maskApiKey(value: string): string {
  if (!value) return "";
  const tail = value.length >= 8 ? value.slice(-4) : value.slice(-2);
  return `••••${tail}`;
}

export function redactProviderError(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{16,}/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gi, "[REDACTED]")
    .replace(/x-api-key\s*[=:]\s*\S+/gi, "x-api-key=[REDACTED]")
    .replace(/api[_-]?key\s*[=:]\s*\S+/gi, "api_key=[REDACTED]");
}

export function safeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : "未知错误";
  return redactProviderError(message).slice(0, 300);
}

export async function httpFailure(label: string, response: Response): Promise<Error> {
  let detail = "";
  try {
    const raw = (await response.text()).trim();
    if (raw) {
      try {
        const payload = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
        const fromError = typeof payload.error === "string" ? payload.error : payload.error?.message;
        detail = fromError || payload.message || raw;
      } catch {
        detail = raw;
      }
    }
  } catch {
    // Ignore body read failures.
  }
  const safe = redactProviderError(detail).replace(/\s+/g, " ").slice(0, 240);
  return new Error(safe ? `${label}：HTTP ${response.status}（${safe}）` : `${label}：HTTP ${response.status}`);
}
