#!/usr/bin/env node
/**
 * 自动发现并运行 src/ 下的所有单元测试文件（*.test.ts / *.test.tsx）。
 * 支持传入额外参数（如指定单个测试文件路径或 --test-name-pattern）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TEST_ROOT = path.resolve(process.cwd(), "src");

function collectTestFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, out);
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      out.push(path.relative(process.cwd(), full).replace(/\\/g, "/"));
    }
  }
  return out;
}

const extraArgs = process.argv.slice(2);
const hasExplicitFiles = extraArgs.some((arg) => !arg.startsWith("-") && /\.test\.tsx?$/.test(arg));

const testFiles = hasExplicitFiles ? [] : collectTestFiles(TEST_ROOT).sort();
if (!hasExplicitFiles && testFiles.length === 0) {
  console.error("[run-tests] 未在 src/ 下发现任何测试文件");
  process.exit(1);
}

const args = [
  "--test",
  "--test-force-exit",
  "--experimental-strip-types",
  ...extraArgs,
  ...testFiles,
];

const result = spawnSync(process.execPath, args, { stdio: "inherit" });
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
