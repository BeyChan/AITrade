import { rmSync } from "node:fs";

export default function globalTeardown() {
  if (process.env.AITRADE_E2E_MANAGED_DB !== "1") return;
  if (process.env.E2E_KEEP_DB === "1") return;
  const dataDir = process.env.AITRADE_E2E_DB_DIR;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}
