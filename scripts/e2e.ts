import { existsSync, unwatchFile, watchFile } from "node:fs";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { healthResponse } from "../packages/contracts/src/index.ts";
import { browserCommand } from "./browser-contracts.ts";
import {
  applicationEnvironment,
  foreground,
  launch,
  launchApi,
  prepareBrowserTemp,
  restartApi,
  restartRefundWorker,
  restartSimulator,
  root,
  runEnvironment,
  runPath,
  safeRemove,
  stopApi,
  waitFor,
} from "./environment.ts";

async function preserveArtifacts(directory: string, failed: boolean, browserTemp: string) {
  const source = join(directory, "browser-results");
  if (!existsSync(source)) return;
  const target = join(root, ".local", failed ? "e2e-last-failure" : "e2e-last-success");
  if (existsSync(target)) await safeRemove(target);
  await mkdir(target);
  let bytes = 0;
  let files = 0;
  async function copy(from: string, to: string) {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const input = join(from, entry.name);
      const output = join(to, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await mkdir(output);
        await copy(input, output);
      } else if (/\.(png|md|json|txt)$/.test(entry.name)) {
        const size = (await stat(input)).size;
        if (bytes + size > 32 * 1024 * 1024 || files >= 100) {
          continue;
        }
        await cp(input, output);
        bytes += size;
        files++;
      }
    }
  }
  await copy(source, target);
  await writeFile(
    join(target, "retention.json"),
    JSON.stringify(
      { files, bytes, limitBytes: 32 * 1024 * 1024, source: directory, browserTemp },
      null,
      2,
    ),
  );
}

export async function runBrowserEnvironment(
  mode: "test" | "fail" | "hold" = "test",
  inspect = false,
) {
  await runEnvironment("e2e", async (env, manifest) => {
    const directory = runPath(manifest.id);
    const scratch = await prepareBrowserTemp(manifest);
    const browserEnv = {
      ...env,
      PLAYWRIGHT_BROWSERS_PATH: join(root, ".local", "browsers"),
      RETURNS_BROWSER_RUN_PATH: directory,
      RETURNS_E2E_MODE: mode,
      TMP: scratch,
      TEMP: scratch,
      TMPDIR: scratch,
      CHROME_CONFIG_HOME: join(scratch, "config"),
      XDG_CONFIG_HOME: join(scratch, "config"),
      XDG_CACHE_HOME: join(scratch, "cache"),
      XDG_DATA_HOME: join(scratch, "data"),
    };
    await foreground(
      manifest,
      ["node_modules/vite/bin/vite.js", "build", "--config", "apps/web/vite.config.ts"],
      applicationEnvironment(env),
    );
    await launchApi(manifest, env);
    await launch(
      manifest,
      ["node_modules/vite/bin/vite.js", "preview", "--config", "apps/web/vite.config.ts"],
      applicationEnvironment(env),
    );
    await waitFor(
      `http://127.0.0.1:${manifest.webPort}/api/health`,
      (body) => healthResponse.allows(body) && body.runId === manifest.id,
    );
    const commandPath = join(directory, "browser-command.json");
    let handling = false;
    let previous = "";
    watchFile(commandPath, { interval: 100 }, () => {
      if (handling || !existsSync(commandPath)) return;
      handling = true;
      void (async () => {
        const command = browserCommand.assert(JSON.parse(await readFile(commandPath, "utf8")));
        if (command.id === previous) return;
        previous = command.id;
        try {
          if (command.action === "stop-api") await stopApi(manifest);
          else if (command.action === "start-api") await restartApi(manifest, env);
          else {
            await restartApi(manifest, env);
            await restartRefundWorker(manifest, env);
            await restartSimulator(manifest, env);
          }
          await writeFile(
            join(directory, "browser-command-result.json"),
            JSON.stringify({ id: command.id }),
          );
        } catch (error) {
          await writeFile(
            join(directory, "browser-command-result.json"),
            JSON.stringify({
              id: command.id,
              error: error instanceof Error ? error.message : "Service command failed",
            }),
          );
        }
      })()
        .catch((error: unknown) =>
          console.error(error instanceof Error ? error.message : "Browser command failed"),
        )
        .finally(() => {
          handling = false;
        });
    });
    let failed = true;
    try {
      console.log(
        `Isolated browser environment ${manifest.id}: http://127.0.0.1:${manifest.webPort}`,
      );
      if (inspect) {
        const resumePath = join(directory, "resume-request");
        console.log(
          `Inspection paused. Press Enter or create ${resumePath} to run tests and clean up.`,
        );
        await new Promise<void>((accept) => {
          const resume = () => {
            unwatchFile(resumePath);
            process.stdin.removeListener("data", resume);
            accept();
          };
          process.stdin.once("data", resume);
          watchFile(resumePath, { interval: 100 }, (info) => {
            if (info.nlink > 0) resume();
          });
        });
      }
      await foreground(
        manifest,
        ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.config.ts"],
        browserEnv,
      );
      failed = false;
    } finally {
      unwatchFile(commandPath);
      await preserveArtifacts(directory, failed, scratch);
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runBrowserEnvironment(
    process.argv.includes("--inject-failure")
      ? "fail"
      : process.argv.includes("--hold")
        ? "hold"
        : "test",
    process.argv.includes("--inspect"),
  );
