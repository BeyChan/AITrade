import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 1688);
const BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL as "chrome" | "msedge" } : {}),
      },
    },
  ],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command: `./node_modules/.bin/next start -p ${PORT}`,
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 90_000,
      },
});
