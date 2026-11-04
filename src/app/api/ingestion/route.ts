import { parseCsv } from "@/lib/csv";
import { ConnectorNotConfiguredError } from "@/lib/connectors/keepa";
import {
  importCandidatesCsv,
  importKeepaByAsins,
  importQuotesCsv,
  importSuppliersCsv,
} from "@/lib/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_ROWS: Record<string, number> = {
  candidates: 200,
  suppliers: 1_000,
  quotes: 1_000,
};

type IngestionKind = "candidates" | "suppliers" | "quotes" | "keepa";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "请求体不能超过 3 MB", code: "payload_too_large" }, { status: 413 });
  }

  try {
    const formData = await request.formData();
    const kind = String(formData.get("kind") || "candidates") as IngestionKind;

    if (kind === "keepa") {
      const asins = parseAsins(String(formData.get("asins") || ""));
      if (asins.length === 0) throw new Error("请至少填写一个 ASIN");
      if (asins.length > 100) throw new Error("单次 Keepa 同步最多 100 个 ASIN");
      const marketplace = String(formData.get("marketplace") || "US").trim().toUpperCase();
      const result = await importKeepaByAsins({ asins, marketplace, actor: "运营人员" });
      return Response.json({ ...result, kind });
    }

    if (!(kind in MAX_ROWS)) {
      return Response.json({ error: `不支持的导入类型：${kind}`, code: "unsupported_kind" }, { status: 400 });
    }

    const file = formData.get("file");
    let csvText = String(formData.get("csvText") || "");
    let fileName = String(formData.get("fileName") || "").trim();
    let entryMode = "pasted_text";

    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_CSV_BYTES) {
        return Response.json({ error: "CSV 文件不能超过 2 MB", code: "payload_too_large" }, { status: 413 });
      }
      csvText = await file.text();
      fileName = fileName || file.name;
      entryMode = "file_upload";
    }

    if (!csvText.trim()) throw new Error("请选择 CSV 文件或粘贴 CSV 内容");
    if (Buffer.byteLength(csvText, "utf8") > MAX_CSV_BYTES) {
      return Response.json({ error: "CSV 内容不能超过 2 MB", code: "payload_too_large" }, { status: 413 });
    }

    const rowCount = Math.max(0, parseCsv(csvText).length - 1);
    if (rowCount > MAX_ROWS[kind]) {
      return Response.json(
        { error: `单次最多导入 ${MAX_ROWS[kind]} 行，当前为 ${rowCount} 行`, code: "too_many_rows" },
        { status: 400 },
      );
    }

    const options = {
      fileName: fileName || undefined,
      query: { entryMode, rowCount },
    };
    const result =
      kind === "candidates"
        ? await importCandidatesCsv(csvText, { ...options, actor: "运营人员" })
        : kind === "suppliers"
          ? await importSuppliersCsv(csvText, { ...options, actor: "采购人员" })
          : await importQuotesCsv(csvText, { ...options, actor: "采购人员" });

    return Response.json({ ...result, kind });
  } catch (error) {
    if (error instanceof ConnectorNotConfiguredError) {
      return Response.json(
        { error: error.message, code: error.code, connector: error.connector },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : "导入失败";
    return Response.json({ error: message, code: "ingestion_failed" }, { status: 400 });
  }
}

function parseAsins(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,，;；]+/)
        .map((asin) => asin.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}
