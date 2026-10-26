import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = fileURLToPath(new URL(".", import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, ".local", "browsers");

export default defineConfig({
  testDir: "./tests/browser-demo",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/browser-demo/setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  globalTimeout: 120000,
  expect: { timeout: 7000 },
  outputDir: ".local/browser-demo-results",
  preserveOutput: "always",
  reporter: [["line"], ["json", { outputFile: ".local/browser-demo-results/report.json" }]],
  use: {
    browserName: "chromium",
    channel: "chromium",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
  },
});
