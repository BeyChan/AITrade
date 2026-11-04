import { parseQuoteCsv, supplierIdentityKey, type QuoteImportRow } from "../csv.ts";
import { asJsonObject, type ConnectorResult } from "./types.ts";

export function readQuoteCsv(csv: string): ConnectorResult<QuoteImportRow> {
  const rows = parseQuoteCsv(csv);
  return {
    sourceCode: "csv_quotes",
    warnings: [],
    records: rows.map((row) => {
      const { rawPayload, ...normalized } = row;
      return {
        record: row,
        rawPayload,
        normalizedPayload: asJsonObject(normalized),
        sourceRecordId: `quote:${row.marketplace}:${row.asin || row.caseId}:${supplierIdentityKey({
          platform: row.supplierPlatform,
          externalSupplierId: row.externalSupplierId,
          url: row.supplierUrl,
          name: row.supplierName,
        })}`,
        observedAt: row.observedAt,
        sourceUrl: row.supplierUrl || null,
      };
    }),
  };
}
