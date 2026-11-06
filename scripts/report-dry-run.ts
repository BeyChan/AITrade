#!/usr/bin/env node
/**
 * 报表试算（dry run）：把平台导出的结算单 / 库存快照跑一遍 P3.0 计算管线。
 *
 * 只读文件、只输出 JSON：不写数据库、不建表、不调用模型、不生成行动建议，
 * 也不内置任何业务阈值。所有口径参数必须在 --config 指定的 JSON 里显式给出。
 *
 * 用法：
 *   node --experimental-strip-types scripts/report-dry-run.ts \
 *     --settlement path/to/settlement.tsv \
 *     --inventory path/to/inventory.tsv \
 *     --config path/to/config.json \
 *     --out path/to/result.json
 *
 * config.json 结构（字段含义见 src/lib/operations-pipeline.ts）：
 * {
 *   "settlement": {
 *     "ingestionRunId": "run-1",
 *     "marketplaceCode": "US",
 *     "reportTimezone": "America/Los_Angeles",
 *     "reportingCurrency": "USD",
 *     "decimalFormat": "us"
 *   },
 *   "inventory": {
 *     "ingestionRunId": "run-2",
 *     "marketplaceCode": "US",
 *     "reportTimezone": "America/Los_Angeles",
 *     "reportingCurrency": "USD",
 *     "snapshotDate": "2026-10-31"
 *   },
 *   "policy": "settlement",
 *   "reportingCurrency": "CNY",
 *   "forecastsBySku": { ... },
 *   "inventoryDays": { ... }
 * }
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { runOperationsPipeline, type PipelineOptions } from "../src/lib/operations-pipeline.ts";

const USAGE = `用法: node --experimental-strip-types scripts/report-dry-run.ts
  --settlement <结算报表 TSV> [--inventory <库存快照 TSV>]
  --config <口径配置 JSON> [--out <结果 JSON>]
  [--help]`;

function parseArgs(argv: readonly string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token}\n${USAGE}`);
    }
    const key = token.slice(2);
    if (key === "help") {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for --${key}\n${USAGE}`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${file}: ${(error as Error).message}`);
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`config.${field} must be a non-empty string`);
  }
  return value;
}

function loadConfig(file: string, hasInventory: boolean): PipelineOptions {
  const parsed = JSON.parse(read(file)) as Partial<PipelineOptions>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("config must be a JSON object");
  }
  requireText(parsed.reportingCurrency, "reportingCurrency");
  if (parsed.policy !== "settlement" && parsed.policy !== "order") {
    throw new Error('config.policy must be "settlement" or "order"');
  }
  if (!parsed.settlement) {
    throw new Error("config.settlement is required");
  }
  for (const field of ["ingestionRunId", "marketplaceCode", "reportTimezone", "reportingCurrency"] as const) {
    requireText(parsed.settlement[field], `settlement.${field}`);
  }
  if (parsed.settlement.decimalFormat !== undefined && !["us", "eu"].includes(parsed.settlement.decimalFormat)) {
    throw new Error('config.settlement.decimalFormat must be "us" or "eu"');
  }
  if (hasInventory) {
    if (!parsed.inventory) {
      throw new Error("config.inventory is required when --inventory is provided");
    }
    for (const field of ["ingestionRunId", "marketplaceCode", "reportTimezone", "reportingCurrency", "snapshotDate"] as const) {
      requireText(parsed.inventory[field], `inventory.${field}`);
    }
  }
  return parsed as PipelineOptions;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const settlementFile = requireText(args.settlement, "settlement");
  const configFile = requireText(args.config, "config");
  const inventoryFile = typeof args.inventory === "string" ? args.inventory : undefined;
  const outFile = typeof args.out === "string" ? args.out : undefined;

  const settlementText = read(settlementFile);
  const inventoryText = inventoryFile ? read(inventoryFile) : undefined;
  const configText = read(configFile);
  const options = loadConfig(configFile, inventoryText !== undefined);

  const result = runOperationsPipeline({ settlementText, ...(inventoryText !== undefined ? { inventoryText } : {}) }, options);
  const output = {
    provenance: {
      settlementFile,
      settlementSha256: sha256(settlementText),
      ...(inventoryFile && inventoryText !== undefined
        ? { inventoryFile, inventorySha256: sha256(inventoryText) }
        : {}),
      configFile,
      configSha256: sha256(configText),
      policy: options.policy,
      reportingCurrency: options.reportingCurrency,
    },
    ...result,
  };
  const json = `${JSON.stringify(output, null, 2)}\n`;

  if (outFile) {
    writeFileSync(outFile, json, "utf8");
    process.stderr.write(`已写入 ${outFile}\n`);
  } else {
    process.stdout.write(json);
  }
  process.stderr.write(
    `SKU 期间 ${result.periods.length} 条，归一化 ${result.settlement.lineCount} 行，待处理 ${result.settlement.unmapped.length} 行，警告 ${result.warnings.length} 条。\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`试算失败: ${(error as Error).message}\n`);
  process.exitCode = 1;
}
