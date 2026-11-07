import { checkConnectorConnection } from "@/lib/connection-diagnostics";
import { loadConnectorEnv } from "@/lib/connector-settings";
import { sanitizeConnectorError } from "@/lib/connectors/security";
import { ConnectorNotConfiguredError } from "@/lib/connectors/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { code?: unknown; actor?: unknown };
    const code = String(payload.code ?? "").trim();
    if (!code) return Response.json({ error: "缺少连接器代码", code: "missing_connector" }, { status: 400 });
    const actor = String(payload.actor ?? "本地管理员").trim();
    // 界面保存的凭证优先于环境变量，无需重启服务
    const env = await loadConnectorEnv();
    const result = await checkConnectorConnection(code, actor, env);
    return Response.json(result);
  } catch (error) {
    if (error instanceof ConnectorNotConfiguredError) {
      return Response.json(
        { error: error.message, code: error.code, connector: error.connector },
        { status: 409 },
      );
    }
    const message = sanitizeConnectorError(error);
    return Response.json({ error: message, code: "connection_check_failed" }, { status: 400 });
  }
}
