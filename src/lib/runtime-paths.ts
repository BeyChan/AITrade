import path from "node:path";

/**
 * 统一解析运行期本地数据目录（默认 `<cwd>/.data`）。
 * 使用 `turbopackIgnore: true` 防止 Next.js/Turbopack 将动态本地数据目录追踪进服务端构建产物。
 */
export function getRuntimeDataPath(...segments: string[]): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), ".data", ...segments);
}
