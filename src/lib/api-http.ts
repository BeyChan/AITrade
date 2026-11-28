import { sanitizeAiInboxError } from "./ai-inbox/worker.ts";

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

export function apiError(error: unknown, init?: ResponseInit) {
  const status = error instanceof ApiInputError || error instanceof ApiHttpError ? error.status : 500;
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  return Response.json(
    { error: sanitizeAiInboxError(error) },
    { ...init, status, headers },
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

export class ApiHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

export type CorsOptions = {
  methods: string;
  fallbackOrigin?: string;
  allowHeaders?: string;
  maxAgeSeconds?: number;
};

export function corsHeaders(request: Request, options: CorsOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": request.headers.get("origin") || options.fallbackOrigin || "*",
    "Access-Control-Allow-Methods": options.methods,
    "Access-Control-Allow-Headers": options.allowHeaders || "Content-Type",
    Vary: "Origin",
  };
  if (options.maxAgeSeconds) headers["Access-Control-Max-Age"] = String(options.maxAgeSeconds);
  return headers;
}

export function withApiRoute<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return apiError(error);
    }
  };
}
