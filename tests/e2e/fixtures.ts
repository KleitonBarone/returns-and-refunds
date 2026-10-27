import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { healthResponse } from "../../packages/contracts/src/index.ts";
import { type browserCommand, browserCommandResult } from "../../scripts/browser-contracts.ts";
import { identity, manifestType, runPath } from "../../scripts/environment.ts";

const directory = process.env.RETURNS_BROWSER_RUN_PATH;
if (!directory) throw new Error("Use pnpm test:e2e");
export const manifest = manifestType.assert(
  JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
);
if (manifest.mode !== "e2e" || directory !== runPath(manifest.id))
  throw new Error("Browser fixtures require an owned disposable run");
export const runDirectory = directory;
const browserErrors = new WeakMap<Page, string[]>();

export const test = base.extend({
  browser: async ({ playwright }, use) => {
    const server = await playwright.chromium.launchServer({
      channel: "chromium",
      headless: true,
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const pid = server.process().pid;
      const processRecord = pid ? await identity(pid) : undefined;
      if (!processRecord) throw new Error("Cannot record browser ownership");
      await writeFile(
        join(runDirectory, "browser-process.json"),
        JSON.stringify({ runId: manifest.id, process: processRecord }),
      );
      const browser = await playwright.chromium.connect(server.wsEndpoint());
      try {
        await use(browser);
      } finally {
        await browser.close();
      }
    } finally {
      await server.close();
    }
  },
});

test.beforeEach(async ({ request, page }) => {
  const messages: string[] = [];
  browserErrors.set(page, messages);
  const record = (message: string) => {
    if (messages.length < 100) messages.push(message.slice(0, 2000));
  };
  page.on("pageerror", (error) => record(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") record(message.text());
  });
  for (const port of [manifest.apiPort, manifest.webPort]) {
    const response = await request.get(`http://127.0.0.1:${port}/api/health`);
    expect(response.ok()).toBe(true);
    expect(healthResponse.assert(await response.json()).runId).toBe(manifest.id);
  }
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    await writeFile(info.outputPath("page.md"), await page.locator("body").ariaSnapshot());
    await writeFile(
      info.outputPath("console-errors.txt"),
      (browserErrors.get(page) ?? []).join("\n"),
    );
  }
});

export async function serviceCommand(action: typeof browserCommand.infer.action) {
  const command = { id: randomUUID(), action };
  const path = join(runDirectory, "browser-command.json");
  await writeFile(`${path}.tmp`, JSON.stringify(command));
  await rename(`${path}.tmp`, path);
  await expect(async () => {
    const result = browserCommandResult.assert(
      JSON.parse(await readFile(join(runDirectory, "browser-command-result.json"), "utf8")),
    );
    expect(result.id).toBe(command.id);
    expect(result.error).toBeUndefined();
  }).toPass({ timeout: 30000, intervals: [100, 250, 500] });
}

export async function control(path: string, body?: unknown) {
  const response = await fetch(`${process.env.SIMULATOR_URL}/control/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${process.env.SIMULATOR_ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Simulator control ${path} returned ${response.status}`);
  const result: unknown = await response.json();
  return result;
}

// Reach controls through the actual tab order, including focus restored after a decision.
export async function tabTo(page: Page, target: Locator) {
  for (let step = 0; step < 80; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Control is unreachable by keyboard: ${await target.getAttribute("aria-label")}`);
}
export async function enter(page: Page, name: string | RegExp) {
  const target = page.getByRole("button", { name, exact: true });
  await expect(target).toBeEnabled();
  await tabTo(page, target);
  await page.keyboard.press("Enter");
}
export async function typeReason(page: Page, label: string, text: string) {
  await tabTo(page, page.getByRole("textbox", { name: label, exact: true }));
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(text);
}
export async function workspace(page: Page, role: string) {
  const label = `${role[0]?.toUpperCase()}${role.slice(1)} workspace`;
  await enter(page, label);
  await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}
export async function waitForHoldRelease() {
  await writeFile(join(runDirectory, "browser-ready"), "ready\n");
  for (let step = 0; step < 900; step++) {
    try {
      await readFile(join(runDirectory, "browser-release"));
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Interruption fixture was not terminated");
}
export { expect };
