import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { manifestType, runPath } from "./scripts/environment.ts";

const directory = process.env.RETURNS_BROWSER_RUN_PATH;
if (!directory) throw new Error("Use pnpm test:e2e so services and fixtures are isolated");
const manifest = manifestType.assert(
  JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")),
);
if (
  manifest.mode !== "e2e" ||
  !manifest.id.startsWith("codex-returns-test-") ||
  directory !== runPath(manifest.id)
)
  throw new Error("Browser tests require an owned disposable environment");
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  globalTimeout: 180000,
  expect: { timeout: 10000 },
  outputDir: join(directory, "browser-results"),
  preserveOutput: "always",
  reporter: [["line"], ["json", { outputFile: join(directory, "browser-results", "report.json") }]],
  use: {
    baseURL: `http://127.0.0.1:${manifest.webPort}`,
    viewport: { width: 1440, height: 1000 },
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "off",
    video:
      process.env.RETURNS_E2E_MODE === "record"
        ? { mode: "on", size: { width: 1440, height: 1000 } }
        : "off",
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
});
