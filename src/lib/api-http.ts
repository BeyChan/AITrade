import { sanitizeAiInboxError } from "@/lib/ai-inbox/worker";

const MAX_BODY_BYTES = 300_000;

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) throw new ApiInputError("请求体过大", 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiInputError("请求体过大", 413);
  if (!text.trim()) throw new ApiInputError("请求体不能为空", 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiInputError("请求体必须是 JSON", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiInputError("请求体必须是 JSON 对象", 400);
  }
  return parsed as Record<string, unknown>;
}

export function stringField(
  body: Record<string, unknown>,
  key: string,
  options: { required?: boolean; maxLength?: number } = {},
) {
  const raw = body[key];
  if (raw !== undefined && typeof raw !== "string" && typeof raw !== "number") {
    throw new ApiInputError(`${key} 必须是字符串`, 400);
  }
  const value = raw === undefined || raw === null ? "" : String(raw).trim();
  if (options.required && !value) throw new ApiInputError(`缺少 ${key}`, 400);
  if (options.maxLength && value.length > options.maxLength) {
    throw new ApiInputError(`${key} 不能超过 ${options.maxLength} 个字符`, 400);
  }
  return value;
}

export function apiError(error: unknown) {
  const status = error instanceof ApiInputError ? error.status : 400;
  return Response.json(
    { error: sanitizeAiInboxError(error) },
    { status },
  );
}

export class ApiInputError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ApiInputError";
    this.status = status;
  }
}
