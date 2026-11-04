export type ConnectorRecord<T> = {
  record: T;
  rawPayload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
  sourceRecordId: string;
  observedAt: string;
  sourceUrl?: string | null;
};

export type ConnectorResult<T> = {
  sourceCode: string;
  records: ConnectorRecord<T>[];
  warnings: string[];
  apiCalls?: ConnectorApiCall[];
};

export type ConnectorApiCall = {
  endpoint: string;
  method: string;
  statusCode: number | null;
  durationMs: number;
  retryCount: number;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
  errorMessage: string | null;
};

export type DataSourceReadiness = {
  code: string;
  name: string;
  kind: "csv" | "api" | "manual" | "feed";
  adapterImplemented: boolean;
  configured: boolean;
  credentialEnv: string[];
  status: "available" | "configured" | "not_configured" | "planned";
  note: string;
  externalActions: "none" | "read_only";
  diagnostic?: "seller_read" | "application_credentials" | "not_available";
  docsUrl?: string;
};

export class ConnectorNotConfiguredError extends Error {
  readonly code = "not_configured";
  readonly connector: string;

  constructor(connector: string) {
    super(`${connector} 尚未配置凭证`);
    this.name = "ConnectorNotConfiguredError";
    this.connector = connector;
  }
}

export function asJsonObject(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
