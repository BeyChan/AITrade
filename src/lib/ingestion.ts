import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { calculateEconomics } from "./economics.ts";
import {
  normalizeSupplierUrl,
  supplierIdentityKey,
  type CandidateImportRow,
  type QuoteImportRow,
  type SupplierImportRow,
} from "./csv.ts";
import { readCandidateCsv } from "./connectors/csv-candidates.ts";
import { readSupplierCsv } from "./connectors/csv-suppliers.ts";
import { readQuoteCsv } from "./connectors/csv-quotes.ts";
import { fetchKeepaCandidates, type KeepaFetchOptions } from "./connectors/keepa.ts";
import { getConnectorReadiness } from "./connectors/registry.ts";
import { sanitizeConnectorError } from "./connectors/security.ts";
import type { ConnectorApiCall, ConnectorRecord, ConnectorResult } from "./connectors/types.ts";
import type {
  DataSourcesDashboard,
  DataSourceRow,
  IngestionRunRow,
} from "./types.ts";

type SqlExecutor = {
  query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

type ImportCounts = {
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
  snapshots: number;
  warnings: string[];
};

export type IngestionSummary = ImportCounts & {
  runId: string;
  sourceCode: string;
  status: "completed" | "partial";
  apiCalls?: ConnectorApiCall[];
};

type IngestionOptions = {
  actor?: string;
  fileName?: string;
  query?: Record<string, unknown>;
  marketOverride?: string;
  platformCode?: string;
};

type SupplierIdentity = {
  platform: string;
  externalSupplierId: string;
  name: string;
  url: string;
  contact: string;
  country: string;
  category: string;
  rating: number | null;
  verified: boolean;
  moq: number | null;
  leadTimeDays: number | null;
  certifications: string;
};

const MAX_WARNINGS = 50;

export async function importCandidatesCsv(csv: string, options: IngestionOptions = {}) {
  return withIngestionRun(
    {
      sourceCode: "csv_candidates",
      importKind: "candidate_csv",
      actor: options.actor ?? "运营人员",
      fileName: options.fileName,
      query: options.query,
    },
    async (runId) => {
      const connector = readCandidateCsv(csv, { marketplace: options.marketOverride });
      return importCandidateConnector(connector, runId, {
        platformCode: options.platformCode || "amazon",
      });
    },
  );
}

export async function importSuppliersCsv(csv: string, options: IngestionOptions = {}) {
  return withIngestionRun(
    {
      sourceCode: "csv_suppliers",
      importKind: "supplier_csv",
      actor: options.actor ?? "采购人员",
      fileName: options.fileName,
      query: options.query,
    },
    async (runId) => {
      const connector = readSupplierCsv(csv);
      return importSupplierConnector(connector, runId);
    },
  );
}

export async function importQuotesCsv(csv: string, options: IngestionOptions = {}) {
  return withIngestionRun(
    {
      sourceCode: "csv_quotes",
      importKind: "quote_csv",
      actor: options.actor ?? "采购人员",
      fileName: options.fileName,
      query: options.query,
    },
    async (runId) => {
      const connector = readQuoteCsv(csv);
      return importQuoteConnector(connector, runId);
    },
  );
}

export async function importKeepaByAsins(input: {
  asins: string[];
  marketplace: string;
  actor?: string;
  runId?: string;
  fetchOptions?: KeepaFetchOptions;
}) {
  return withIngestionRun(
    {
      sourceCode: "keepa",
      importKind: "keepa_product_sync",
      actor: input.actor ?? "运营人员",
      query: { asins: input.asins, marketplace: input.marketplace },
      runId: input.runId,
    },
    async (runId) => {
      const connector = await fetchKeepaCandidates({
        asins: input.asins,
        marketplace: input.marketplace,
        fetchOptions: input.fetchOptions,
      });
      const result = await importCandidateConnector(connector, runId, { platformCode: "amazon" });
      return {
        ...result,
        warnings: [...connector.warnings, ...result.warnings],
        apiCalls: connector.apiCalls ?? [],
      };
    },
  );
}

export async function getDataSourcesDashboard(): Promise<DataSourcesDashboard> {
  const db = await getDb();
  const [sourcesResult, runsResult, statsResult, snapshotsBySource, suppliersBySource, quotesBySource] =
    await Promise.all([
      db.query<DataSourceRow>("SELECT * FROM data_sources ORDER BY created_at ASC"),
      db.query<IngestionRunRow>("SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 20"),
      db.query<{
        real_candidate_count: string;
        supplier_count: string;
        quote_count: string;
        snapshot_count: string;
      }>(`
        SELECT
          (SELECT COUNT(*) FROM product_cases WHERE is_demo = FALSE)::text AS real_candidate_count,
          (SELECT COUNT(*) FROM suppliers)::text AS supplier_count,
          (SELECT COUNT(*) FROM quotes)::text AS quote_count,
          (SELECT COUNT(*) FROM evidence_snapshots)::text AS snapshot_count
      `),
      db.query<{ source_code: string; count: string }>(
        "SELECT source_code, COUNT(*)::text AS count FROM evidence_snapshots GROUP BY source_code",
      ),
      db.query<{ source_code: string; count: string }>(
        "SELECT source_code, COUNT(DISTINCT supplier_id)::text AS count FROM supplier_external_ids GROUP BY source_code",
      ),
      db.query<{ source_code: string; count: string }>(
        "SELECT source_code, COUNT(*)::text AS count FROM quotes WHERE source_code IS NOT NULL GROUP BY source_code",
      ),
    ]);

  const readiness = new Map(getConnectorReadiness().map((source) => [source.code, source]));
  const snapshotCounts = new Map(snapshotsBySource.rows.map((row) => [row.source_code, Number(row.count)]));
  const supplierCounts = new Map(suppliersBySource.rows.map((row) => [row.source_code, Number(row.count)]));
  const quoteCounts = new Map(quotesBySource.rows.map((row) => [row.source_code, Number(row.count)]));

  const sources = sourcesResult.rows.map((source) => {
    const connector = readiness.get(source.code);
    return {
      ...source,
      adapterImplemented: connector?.adapterImplemented ?? false,
      configured: connector?.configured ?? false,
      readiness: connector?.status ?? ("planned" as const),
      credentialEnv: connector?.credentialEnv ?? [],
      note: connector?.note ?? "尚未登记 Connector。",
      externalActions: connector?.externalActions ?? ("none" as const),
      snapshotCount: snapshotCounts.get(source.code) ?? 0,
      supplierCount: supplierCounts.get(source.code) ?? 0,
      quoteCount: quoteCounts.get(source.code) ?? 0,
    };
  });
  const stats = statsResult.rows[0];

  return {
    sources,
    runs: runsResult.rows,
    stats: {
      realCandidateCount: Number(stats?.real_candidate_count ?? 0),
      supplierCount: Number(stats?.supplier_count ?? 0),
      quoteCount: Number(stats?.quote_count ?? 0),
      snapshotCount: Number(stats?.snapshot_count ?? 0),
      configuredApiCount: sources.filter((source) => source.kind === "api" && source.readiness === "configured").length,
    },
  };
}

async function withIngestionRun(
  input: {
    sourceCode: string;
    importKind: string;
    actor: string;
    fileName?: string;
    query?: Record<string, unknown>;
    runId?: string;
  },
  work: (runId: string) => Promise<ImportCounts & { apiCalls?: ConnectorApiCall[] }>,
): Promise<IngestionSummary> {
  const db = await getDb();
  const runId = input.runId ?? randomUUID();
  const actor = input.actor.trim() || "系统";
  await db.query(
    `INSERT INTO ingestion_runs
      (id, source_code, import_kind, status, requested_by, file_name, query)
     VALUES ($1, $2, $3, 'running', $4, $5, $6::jsonb)`,
    [runId, input.sourceCode, input.importKind, actor, input.fileName?.trim() || null, JSON.stringify(input.query ?? {})],
  );

  try {
    const counts = await work(runId);
    const status: "completed" | "partial" = counts.errors > 0 || counts.warnings.length > 0 ? "partial" : "completed";
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE ingestion_runs
         SET status = $1, imported_count = $2, updated_count = $3, skipped_count = $4,
             error_count = $5, snapshot_count = $6, warnings = $7::jsonb, completed_at = NOW()
         WHERE id = $8`,
        [
          status,
          counts.imported,
          counts.updated,
          counts.skipped,
          counts.errors,
          counts.snapshots,
          JSON.stringify(counts.warnings.slice(0, MAX_WARNINGS)),
          runId,
        ],
      );
      await tx.query("UPDATE data_sources SET last_synced_at = NOW() WHERE code = $1", [input.sourceCode]);
      await tx.query(
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'ingestion.completed', 'data_source', $3, $4::jsonb)`,
        [
          randomUUID(),
          actor,
          input.sourceCode,
          JSON.stringify({
            runId,
            importKind: input.importKind,
            fileName: input.fileName ?? null,
            imported: counts.imported,
            updated: counts.updated,
            skipped: counts.skipped,
            errors: counts.errors,
            snapshots: counts.snapshots,
            externalActions: input.sourceCode === "keepa" ? "read_only" : "none",
          }),
        ],
      );
    });
    return { runId, sourceCode: input.sourceCode, status, ...counts };
  } catch (error) {
    const message = sanitizeConnectorError(error);
    await db.query(
      `UPDATE ingestion_runs
       SET status = 'failed', error_count = 1, error_message = $1, completed_at = NOW()
       WHERE id = $2`,
      [message.slice(0, 1000), runId],
    );
    await db.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ingestion.failed', 'data_source', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        input.sourceCode,
        JSON.stringify({
          runId,
          error: message,
          externalActions: input.sourceCode === "keepa" ? "read_only" : "none",
        }),
      ],
    );
    throw error;
  }
}

async function importCandidateConnector(
  connector: ConnectorResult<CandidateImportRow>,
  runId: string,
  siteScope: { platformCode: string },
): Promise<ImportCounts> {
  const db = await getDb();
  const counts = emptyCounts(connector.warnings);
  const platformCode = siteScope.platformCode.trim().toLowerCase();

  await db.transaction(async (tx) => {
    const platform = await tx.query<{ code: string }>(
      "SELECT code FROM platforms WHERE code = $1 AND status <> 'disabled' LIMIT 1",
      [platformCode],
    );
    if (!platform.rows[0]) throw new Error(`平台不存在或已停用：${platformCode}`);

    for (const item of connector.records) {
      const row = item.record;
      const caseId = randomUUID();
      const evidenceScore = candidateEvidenceScore(row);
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO product_cases
          (id, asin, marketplace, category, title, url, status, competitor_price_cents,
           monthly_sales_estimate, review_count, rating, notes, owner, evidence_score, is_demo,
           source_code, source_record_id, source_observed_at, currency, monthly_sales_min,
           monthly_sales_max, bsr, keyword, keyword_search_volume, seller_count, variation_count)
         VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, $8, $9, $10, $11, $12, $13, FALSE,
                 $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
         ON CONFLICT (asin, marketplace) DO NOTHING
         RETURNING id`,
        [
          caseId,
          row.asin,
          row.marketplace,
          row.category,
          row.title,
          row.url || null,
          row.competitorPriceCents,
          row.monthlySalesEstimate,
          row.reviewCount,
          row.rating,
          row.notes,
          connector.sourceCode,
          evidenceScore,
          connector.sourceCode,
          row.sourceRecordId,
          row.observedAt,
          row.currency,
          row.monthlySalesMin,
          row.monthlySalesMax,
          row.bsr,
          row.keyword || null,
          row.keywordSearchVolume,
          row.sellerCount,
          row.variationCount,
        ],
      );

      let targetCaseId = inserted.rows[0]?.id;
      if (!targetCaseId) {
        const existing = await tx.query<{ id: string }>(
          "SELECT id FROM product_cases WHERE asin = $1 AND marketplace = $2 LIMIT 1",
          [row.asin, row.marketplace],
        );
        targetCaseId = existing.rows[0]?.id;
      }
      if (!targetCaseId) throw new Error(`无法保存候选品 ${row.asin}`);

      const market = await tx.query<{ code: string }>(
        "SELECT code FROM markets WHERE code = $1 AND status = 'active' LIMIT 1",
        [row.marketplace],
      );
      if (!market.rows[0]) throw new Error(`目标市场不存在或已停用：${row.marketplace}`);

      const siteLink = await tx.query<{ case_id: string }>(
        `INSERT INTO product_case_sites
          (case_id, market_code, platform_code, discovery_source)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (case_id, market_code, platform_code) DO NOTHING
         RETURNING case_id`,
        [targetCaseId, row.marketplace, platformCode, connector.sourceCode],
      );

      if (inserted.rows[0]) {
        const results = await calculateEconomicsSafe(row);
        await tx.query(
          `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_by)
           VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5)`,
          [randomUUID(), targetCaseId, JSON.stringify(row.assumptions), JSON.stringify(results), connector.sourceCode],
        );
        await tx.query(
          `INSERT INTO case_evidence
            (id, case_id, evidence_type, source_type, source_url, title, summary, payload, confidence)
           VALUES ($1, $2, 'market_snapshot', $3, $4, $5, $6, $7::jsonb, 0.700)`,
          [
            randomUUID(),
            targetCaseId,
            connector.sourceCode,
            row.url || null,
            `${connector.sourceCode} 候选品快照`,
            "来自 Connector 的原始商品数据，已保留采集时间和标准化字段；不代表最终采购结论。",
            JSON.stringify(item.normalizedPayload),
          ],
        );
        await tx.query(
          `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
           VALUES ($1, 'connector', 'case.imported', 'product_case', $2, $3::jsonb)`,
          [
            randomUUID(),
            targetCaseId,
            JSON.stringify({
              runId,
              sourceCode: connector.sourceCode,
              sourceRecordId: item.sourceRecordId,
              marketCode: row.marketplace,
              platformCode,
              observedAt: row.observedAt,
              externalActions: "none",
            }),
          ],
        );
        counts.imported += 1;
      } else if (siteLink.rows[0]) {
        counts.updated += 1;
        await tx.query(
          `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
           VALUES ($1, 'connector', 'case.site_linked', 'product_case', $2, $3::jsonb)`,
          [
            randomUUID(),
            targetCaseId,
            JSON.stringify({
              runId,
              sourceCode: connector.sourceCode,
              sourceRecordId: item.sourceRecordId,
              marketCode: row.marketplace,
              platformCode,
              externalActions: "none",
            }),
          ],
        );
      } else {
        counts.skipped += 1;
      }

      if (
        await insertSnapshot(tx, {
          runId,
          caseId: targetCaseId,
          sourceCode: connector.sourceCode,
          evidenceType: "candidate_market",
          item,
        })
      ) {
        counts.snapshots += 1;
      }
    }

    for (const item of connector.additionalEvidence ?? []) {
      if (
        await insertSnapshot(tx, {
          runId,
          caseId: null,
          sourceCode: connector.sourceCode,
          evidenceType: "connector_additional_evidence",
          item,
        })
      ) {
        counts.snapshots += 1;
      }
    }
  });

  return counts;
}

async function importSupplierConnector(
  connector: ConnectorResult<SupplierImportRow>,
  runId: string,
): Promise<ImportCounts> {
  const db = await getDb();
  const counts = emptyCounts(connector.warnings);

  await db.transaction(async (tx) => {
    for (const item of connector.records) {
      const identity: SupplierIdentity = item.record;
      const outcome = await ensureSupplier(tx, identity, connector.sourceCode);
      if (outcome.created) counts.imported += 1;
      else if (outcome.updated) counts.updated += 1;
      else counts.skipped += 1;

      if (
        await insertSnapshot(tx, {
          runId,
          caseId: null,
          sourceCode: connector.sourceCode,
          evidenceType: "supplier_profile",
          item,
        })
      ) {
        counts.snapshots += 1;
      }
      if (outcome.created || outcome.updated) {
        await tx.query(
          `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
           VALUES ($1, 'connector', $2, 'supplier', $3, $4::jsonb)`,
          [
            randomUUID(),
            outcome.created ? "supplier.imported" : "supplier.updated",
            outcome.supplierId,
            JSON.stringify({
              runId,
              sourceCode: connector.sourceCode,
              identityKey: outcome.identityKey,
              externalActions: "none",
            }),
          ],
        );
      }
    }
  });

  return counts;
}

async function importQuoteConnector(
  connector: ConnectorResult<QuoteImportRow>,
  runId: string,
): Promise<ImportCounts> {
  const db = await getDb();
  const counts = emptyCounts(connector.warnings);

  await db.transaction(async (tx) => {
    for (const item of connector.records) {
      const row = item.record;
      const productResult = row.caseId
        ? await tx.query<{ id: string; status: string }>("SELECT id, status FROM product_cases WHERE id = $1 LIMIT 1", [row.caseId])
        : await tx.query<{ id: string; status: string }>(
            "SELECT id, status FROM product_cases WHERE asin = $1 AND marketplace = $2 LIMIT 1",
            [row.asin, row.marketplace],
          );
      const product = productResult.rows[0];
      if (!product) {
        counts.errors += 1;
        addWarning(counts, `未找到候选品 ${row.asin || row.caseId} / ${row.marketplace}，报价已跳过`);
        continue;
      }
      if (product.status !== "approved") {
        counts.errors += 1;
        addWarning(counts, `${row.asin || row.caseId} 尚未立项，报价已跳过`);
        continue;
      }
      const selection = await tx.query<{ id: string }>(
        "SELECT id FROM supplier_selections WHERE case_id = $1 LIMIT 1",
        [product.id],
      );
      if (selection.rows[0]) {
        counts.errors += 1;
        addWarning(counts, `${row.asin || row.caseId} 已完成供应商定标，报价已跳过`);
        continue;
      }

      const supplier = await ensureSupplier(
        tx,
        {
          platform: row.supplierPlatform,
          externalSupplierId: row.externalSupplierId,
          name: row.supplierName,
          url: row.supplierUrl,
          contact: row.supplierContact,
          country: row.supplierCountry,
          category: row.supplierCategory,
          rating: null,
          verified: false,
          moq: row.moq,
          leadTimeDays: row.leadTimeDays,
          certifications: row.certifications,
        },
        connector.sourceCode,
      );

      let rfqResult = await tx.query<{ id: string }>(
        "SELECT id FROM rfqs WHERE case_id = $1 AND supplier_id = $2 ORDER BY created_at ASC LIMIT 1",
        [product.id, supplier.supplierId],
      );
      let rfqId = rfqResult.rows[0]?.id;
      if (!rfqId) {
        rfqId = randomUUID();
        await tx.query(
          `INSERT INTO rfqs (id, case_id, supplier_id, status, requirements)
           VALUES ($1, $2, $3, 'quote_imported', $4::jsonb)`,
          [
            rfqId,
            product.id,
            supplier.supplierId,
            JSON.stringify({
              source: connector.sourceCode,
              runId,
              externalSupplierId: row.externalSupplierId || null,
              supplierUrl: row.supplierUrl || null,
              note: "报价由 CSV 导入；系统未向供应商发送任何消息。",
              externalActions: "none",
            }),
          ],
        );
      }

      const sourceHash = hashPayload({
        supplierIdentity: supplier.identityKey,
        asin: row.asin,
        marketplace: row.marketplace,
        unitPriceCents: row.unitPriceCents,
        freightPerUnitCents: row.freightPerUnitCents,
        dutyRate: row.dutyRate,
        qualityScore: row.qualityScore,
        moq: row.moq,
        leadTimeDays: row.leadTimeDays,
        paymentTerms: row.paymentTerms,
        incoterm: row.incoterm,
        certifications: row.certifications,
        sampleFeeCents: row.sampleFeeCents,
        toolingFeeCents: row.toolingFeeCents,
        validUntil: row.quoteValidUntil,
        currency: row.currency,
        raw: row.rawPayload,
      });
      const duplicateQuote = await tx.query<{ id: string }>(
        "SELECT id FROM quotes WHERE rfq_id = $1 AND source_hash = $2 LIMIT 1",
        [rfqId, sourceHash],
      );
      if (duplicateQuote.rows[0]) {
        counts.skipped += 1;
      } else {
        const quoteId = randomUUID();
        await tx.query(
          `INSERT INTO quotes
            (id, rfq_id, unit_price_cents, freight_per_unit_cents, duty_rate, quality_score,
             moq, lead_time_days, payment_terms, incoterm, certifications, sample_fee_cents,
             tooling_fee_cents, currency, valid_until, source_code, source_hash, observed_at, raw_payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)`,
          [
            quoteId,
            rfqId,
            row.unitPriceCents,
            row.freightPerUnitCents,
            row.dutyRate,
            row.qualityScore,
            row.moq,
            row.leadTimeDays,
            row.paymentTerms || null,
            row.incoterm || null,
            row.certifications || null,
            row.sampleFeeCents,
            row.toolingFeeCents,
            row.currency,
            row.quoteValidUntil,
            connector.sourceCode,
            sourceHash,
            row.observedAt,
            JSON.stringify({
              entryMode: "csv_import",
              runId,
              importedBy: "connector",
              raw: row.rawPayload,
              externalActions: "none",
            }),
          ],
        );
        await tx.query(
          `INSERT INTO quote_documents
            (id, quote_id, document_type, file_url, source_url, checksum, metadata)
           VALUES ($1, $2, 'source_snapshot', NULL, $3, $4, $5::jsonb)`,
          [
            randomUUID(),
            quoteId,
            row.supplierUrl || null,
            sourceHash,
            JSON.stringify({ sourceCode: connector.sourceCode, runId, observedAt: row.observedAt }),
          ],
        );
        await tx.query(
          `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
           VALUES ($1, 'connector', 'quote.imported', 'product_case', $2, $3::jsonb)`,
          [
            randomUUID(),
            product.id,
            JSON.stringify({
              runId,
              quoteId,
              rfqId,
              supplierId: supplier.supplierId,
              unitPriceCents: row.unitPriceCents,
              freightPerUnitCents: row.freightPerUnitCents,
              externalActions: "none",
              rfqSent: false,
            }),
          ],
        );
        counts.imported += 1;
      }

      if (
        await insertSnapshot(tx, {
          runId,
          caseId: product.id,
          sourceCode: connector.sourceCode,
          evidenceType: "supplier_quote",
          item,
        })
      ) {
        counts.snapshots += 1;
      }
    }
  });

  return counts;
}

async function ensureSupplier(tx: SqlExecutor, input: SupplierIdentity, sourceCode: string) {
  const identityKey = supplierIdentityKey(input);
  const normalizedUrl = normalizeSupplierUrl(input.url);
  const mapping = await tx.query<{ supplier_id: string }>(
    "SELECT supplier_id FROM supplier_external_ids WHERE identity_key = $1 LIMIT 1",
    [identityKey],
  );
  let supplierId = mapping.rows[0]?.supplier_id;

  if (!supplierId && normalizedUrl) {
    const urlMatch = await tx.query<{ supplier_id: string }>(
      `SELECT sei.supplier_id
       FROM supplier_external_ids sei
       JOIN suppliers s ON s.id = sei.supplier_id
       WHERE sei.normalized_url = $1 AND lower(s.platform) = lower($2)
       LIMIT 1`,
      [normalizedUrl, input.platform],
    );
    supplierId = urlMatch.rows[0]?.supplier_id;
  }
  if (!supplierId) {
    const nameMatch = await tx.query<{ id: string }>(
      "SELECT id FROM suppliers WHERE lower(name) = lower($1) AND lower(platform) = lower($2) ORDER BY created_at ASC LIMIT 1",
      [input.name, input.platform],
    );
    supplierId = nameMatch.rows[0]?.id;
  }

  if (!supplierId) {
    supplierId = randomUUID();
    await tx.query(
      `INSERT INTO suppliers (id, name, platform, url, contact, country, rating, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        supplierId,
        input.name.trim(),
        input.platform || "manual",
        input.url.trim() || null,
        input.contact.trim() || null,
        input.country.trim() || null,
        input.rating,
        supplierNotes(input),
      ],
    );
    await tx.query(
      `INSERT INTO supplier_external_ids
        (id, supplier_id, source_code, external_id, normalized_url, identity_key, metadata, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
      [
        randomUUID(),
        supplierId,
        sourceCode,
        input.externalSupplierId.trim() || null,
        normalizedUrl || null,
        identityKey,
        JSON.stringify(supplierMetadata(input, sourceCode)),
      ],
    );
    return { supplierId, identityKey, created: true, updated: false };
  }

  const currentResult = await tx.query<{
    name: string;
    platform: string;
    url: string | null;
    contact: string | null;
    country: string | null;
    rating: string | number | null;
    notes: string;
  }>("SELECT name, platform, url, contact, country, rating, notes FROM suppliers WHERE id = $1", [supplierId]);
  const current = currentResult.rows[0];
  if (!current) throw new Error("供应商去重记录失效");
  const next = {
    name: input.name.trim() || current.name,
    platform: input.platform.trim() || current.platform,
    url: input.url.trim() || current.url,
    contact: input.contact.trim() || current.contact,
    country: input.country.trim() || current.country,
    rating: input.rating ?? (current.rating === null ? null : Number(current.rating)),
    notes: input.category || input.certifications ? mergeSupplierNotes(current.notes, supplierNotes(input)) : current.notes,
  };
  const updated =
    next.name !== current.name ||
    next.platform !== current.platform ||
    next.url !== current.url ||
    next.contact !== current.contact ||
    next.country !== current.country ||
    next.rating !== (current.rating === null ? null : Number(current.rating)) ||
    next.notes !== current.notes;
  if (updated) {
    await tx.query(
      `UPDATE suppliers
       SET name = $1, platform = $2, url = $3, contact = $4, country = $5, rating = $6, notes = $7, updated_at = NOW()
       WHERE id = $8`,
      [next.name, next.platform, next.url, next.contact, next.country, next.rating, next.notes, supplierId],
    );
  }
  await tx.query(
    `INSERT INTO supplier_external_ids
      (id, supplier_id, source_code, external_id, normalized_url, identity_key, metadata, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
     ON CONFLICT (identity_key) DO UPDATE
       SET last_seen_at = NOW(), metadata = EXCLUDED.metadata`,
    [
      randomUUID(),
      supplierId,
      sourceCode,
      input.externalSupplierId.trim() || null,
      normalizedUrl || null,
      identityKey,
      JSON.stringify(supplierMetadata(input, sourceCode)),
    ],
  );
  return { supplierId, identityKey, created: false, updated };
}

async function insertSnapshot(
  tx: SqlExecutor,
  input: {
    runId: string;
    caseId: string | null;
    sourceCode: string;
    evidenceType: string;
    item: ConnectorRecord<unknown>;
  },
) {
  const contentHash = hashPayload({
    raw: input.item.rawPayload,
    normalized: input.item.normalizedPayload,
  });
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO evidence_snapshots
      (id, ingestion_run_id, case_id, source_code, source_record_id, evidence_type, source_url,
       raw_payload, normalized_payload, content_hash, observed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
     ON CONFLICT (source_code, source_record_id, evidence_type, content_hash) DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      input.runId,
      input.caseId,
      input.sourceCode,
      input.item.sourceRecordId,
      input.evidenceType,
      input.item.sourceUrl || null,
      JSON.stringify(input.item.rawPayload),
      JSON.stringify(input.item.normalizedPayload),
      contentHash,
      input.item.observedAt,
    ],
  );
  return Boolean(inserted.rows[0]);
}

async function calculateEconomicsSafe(row: CandidateImportRow) {
  return calculateEconomics(row.assumptions);
}

function candidateEvidenceScore(row: CandidateImportRow) {
  const signals = [
    row.monthlySalesMax > 0,
    row.reviewCount > 0,
    Boolean(row.bsr),
    Boolean(row.keyword),
    row.keywordSearchVolume !== null,
    row.sellerCount !== null,
    row.variationCount !== null,
  ].filter(Boolean).length;
  return Math.min(100, 25 + signals * 10);
}

function supplierMetadata(input: SupplierIdentity, sourceCode: string) {
  return {
    sourceCode,
    externalSupplierId: input.externalSupplierId || null,
    category: input.category || null,
    verified: input.verified,
    moq: input.moq,
    leadTimeDays: input.leadTimeDays,
    certifications: input.certifications || null,
    externalActions: "none",
  };
}

function supplierNotes(input: SupplierIdentity) {
  return [
    input.category ? `主营类目：${input.category}` : "",
    input.verified ? "认证状态：已认证" : "",
    input.moq !== null ? `MOQ：${input.moq}` : "",
    input.leadTimeDays !== null ? `交期：${input.leadTimeDays} 天` : "",
    input.certifications ? `认证：${input.certifications}` : "",
  ].filter(Boolean).join("；");
}

function mergeSupplierNotes(current: string, incoming: string) {
  if (!incoming || current.includes(incoming)) return current;
  return [current, incoming].filter(Boolean).join("；");
}

function emptyCounts(warnings: string[] = []): ImportCounts {
  return { imported: 0, updated: 0, skipped: 0, errors: 0, snapshots: 0, warnings: [...warnings] };
}

function addWarning(counts: ImportCounts, warning: string) {
  if (counts.warnings.length < MAX_WARNINGS) counts.warnings.push(warning);
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
