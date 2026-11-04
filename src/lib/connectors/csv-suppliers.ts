import { parseSupplierCsv, supplierIdentityKey, type SupplierImportRow } from "../csv.ts";
import { asJsonObject, type ConnectorResult } from "./types.ts";

export function readSupplierCsv(csv: string): ConnectorResult<SupplierImportRow> {
  const rows = parseSupplierCsv(csv);
  return {
    sourceCode: "csv_suppliers",
    warnings: [],
    records: rows.map((row) => {
      const { rawPayload, ...normalized } = row;
      return {
        record: row,
        rawPayload,
        normalizedPayload: asJsonObject(normalized),
        sourceRecordId: supplierIdentityKey(row),
        observedAt: row.observedAt,
        sourceUrl: row.url || null,
      };
    }),
  };
}
