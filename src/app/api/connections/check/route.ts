import { checkConnectorConnection } from "@/lib/connection-diagnostics";
import { ConnectorNotConfiguredError } from "@/lib/connectors/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { code?: unknown; actor?: unknown };
    const code = String(payload.code ?? "").trim();
    if (!code) return Response.json({ error: "缺少连接器代码", code: "missing_connector" }, { status: 400 });
    const actor = String(payload.actor ?? "本地管理员").trim();
    const result = await checkConnectorConnection(code, actor);
    return Response.json(result);
  } catch (error) {
    if (error instanceof ConnectorNotConfiguredError) {
      return Response.json(
        { error: error.message, code: error.code, connector: error.connector },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : "连接检查失败";
    return Response.json({ error: message, code: "connection_check_failed" }, { status: 400 });
  }
}
