import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import {
  getConnectorDiagnosticDefinition,
  runConnectorDiagnostic,
  type ConnectorDiagnosticCode,
  type ConnectorDiagnosticResult,
  type ConnectorEnv,
} from "./connectors/diagnostics.ts";
import type { ConnectorHealthCheckRow } from "./types.ts";

export async function checkConnectorConnection(
  code: string,
  actor = "系统管理员",
  env: ConnectorEnv = process.env,
): Promise<ConnectorDiagnosticResult> {
  const definition = getConnectorDiagnosticDefinition(code);
  if (!definition) throw new Error(`不支持的连接器：${code}`);
  if (!actor.trim()) throw new Error("请填写检查人");

  const result = await runConnectorDiagnostic(code as ConnectorDiagnosticCode, env);
  const db = await getDb();
  const checkId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO connector_health_checks
        (id, source_code, status, verification_level, message, duration_ms, details, checked_by, checked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        checkId,
        result.sourceCode,
        result.status,
        result.verificationLevel,
        result.message,
        result.durationMs,
        JSON.stringify(result.details),
        actor.trim(),
        result.checkedAt,
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'connector.health_checked', 'data_source', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor.trim(),
        result.sourceCode,
        JSON.stringify({
          checkId,
          status: result.status,
          verificationLevel: result.verificationLevel,
          externalActions: result.externalActions,
          credentialsExposed: false,
        }),
      ],
    );
  });
  return result;
}

export async function getLatestConnectorHealthChecks(): Promise<ConnectorHealthCheckRow[]> {
  const db = await getDb();
  const result = await db.query<ConnectorHealthCheckRow>(`
    SELECT DISTINCT ON (source_code) *
    FROM connector_health_checks
    ORDER BY source_code, checked_at DESC
  `);
  return result.rows;
}
