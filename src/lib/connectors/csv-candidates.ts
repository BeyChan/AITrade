import { parseCandidateCsv, type CandidateImportRow } from "../csv.ts";
import { asJsonObject, type ConnectorResult } from "./types.ts";

export function readCandidateCsv(csv: string): ConnectorResult<CandidateImportRow> {
  const rows = parseCandidateCsv(csv);
  return {
    sourceCode: "csv_candidates",
    warnings: [],
    records: rows.map((row) => {
      const { rawPayload, ...normalized } = row;
      return {
        record: row,
        rawPayload,
        normalizedPayload: asJsonObject(normalized),
        sourceRecordId: `${row.marketplace}:${row.sourceRecordId}`,
        observedAt: row.observedAt,
        sourceUrl: row.url || null,
      };
    }),
  };
}
