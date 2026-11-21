#!/usr/bin/env node
/**
 * 深浅双模颜色统一审计脚本：
 * 扫描 src/app 与 src/components 中硬编码的浅色背景、浅色渐变、深色文字，
 * 确保全部通过 globals.css 中的语义主题变量（--paper / --surface-subtle / --ink / --muted / --line / --*-soft）管理。
 */
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src/app", "src/components"];
const IGNORE_FILES = new Set([
  "src/app/cases/[id]/report/page.tsx", // A4 打印白纸单据
  "src/components/serp-shelf-test.tsx", // 模拟 Amazon 白底主图货架
]);

const RULES = [
  {
    name: "硬编码浅色背景/渐变",
    regex: /background(?:Color)?\s*:\s*["'`](?:[^"'`]*#(?:fff(?:fff)?|f[0-9a-f]{5}|e[c-f][0-9a-f]{4}|d[c-f][0-9a-f]{4})[^"'`]*)["'`]/gi,
  },
  {
    name: "硬编码深色文字（黑夜模式不可见）",
    regex: /color\s*:\s*["'`]#(?:0[0-9a-f]{5}|1[0-9a-f]{5}|2[0-9a-f]{5}|3[0-9a-f]{5}|4[0-7][0-9a-f]{4})["'`]/gi,
  },
];

function walk(dir) {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const findings = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = file.replace(/\\/g, "/");
    if (IGNORE_FILES.has(rel)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, idx) => {
      for (const rule of RULES) {
        rule.regex.lastIndex = 0;
        const match = rule.regex.exec(line);
        if (match) {
          findings.push({ file: rel, line: idx + 1, rule: rule.name, snippet: match[0] });
        }
      }
    });
  }
}

if (findings.length === 0) {
  console.log("✓ 主题颜色审计通过：0 处硬编码浅背景或深文字。");
  process.exit(0);
}

console.log(`发现 ${findings.length} 处未统一使用主题变量的硬编码颜色：`);
for (const f of findings) {
  console.log(`  - ${f.file}:${f.line} [${f.rule}] ${f.snippet}`);
}
process.exit(1);
