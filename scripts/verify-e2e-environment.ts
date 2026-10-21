import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type } from "arktype";
import { browserProcessRecord } from "./browser-contracts.ts";
import { runBrowserEnvironment } from "./e2e.ts";
import { cleanup, identity, manifestType, root, runPath } from "./environment.ts";

console.log("Verifying expected browser failure and retained diagnostics.");
const failureStarted = Date.now();
await assert.rejects(runBrowserEnvironment("fail"));
const artifacts = join(root, ".local", "e2e-last-failure");
const retentionPath = join(artifacts, "retention.json");
assert.ok(
  (await stat(retentionPath)).mtimeMs >= failureStarted,
  "diagnostics must belong to this run",
);
const retention = type({ source: "string" }).assert(
  JSON.parse(await readFile(retentionPath, "utf8")),
);
await assert.rejects(stat(retention.source), "failed run must finish verified teardown");
const reportText = await readFile(join(artifacts, "report.json"), "utf8");
const report = type({ stats: { unexpected: "number", expected: "number" } }).assert(
  JSON.parse(reportText),
);
assert.equal(report.stats.unexpected, 1);
assert.equal(report.stats.expected, 0);
assert.match(reportText, /injected browser failure/);
const retained: string[] = [];
let bytes = 0;
async function inspect(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink());
    if (entry.isDirectory()) await inspect(path);
    else {
      retained.push(path);
      bytes += (await stat(path)).size;
      if (/\.(json|md|txt)$/.test(path))
        assert.doesNotMatch(
          await readFile(path, "utf8"),
          /postgres:\/\/[^\s"']+|Bearer [a-f0-9-]{32,}/,
        );
    }
  }
}
await inspect(artifacts);
assert.ok(
  retained.some((path) => path.endsWith("report.json")),
  "retain assertion and stack",
);
assert.ok(
  retained.some((path) => path.endsWith("page.md")),
  "retain accessible page state",
);
assert.ok(
  retained.some((path) => path.endsWith(".png")),
  "retain browser screenshot",
);
assert.ok(bytes < 32 * 1024 * 1024 + 4096 && retained.length <= 101);

console.log("Verifying supervisor death while the real browser is open.");
const child = spawn(process.execPath, ["--import", "tsx", "scripts/e2e.ts", "--hold"], {
  cwd: root,
  env: process.env,
  stdio: "ignore",
  windowsHide: true,
});
if (!child.pid) throw new Error("Cannot launch browser interruption fixture");
const owner = await identity(child.pid);
let recorded: typeof manifestType.infer | undefined;
let browser: typeof browserProcessRecord.infer | undefined;
try {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    for (const id of await readdir(join(root, ".local", "runs"))) {
      const directory = runPath(id);
      try {
        const candidate = manifestType.assert(
          JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
        );
        if (candidate.owner.pid !== child.pid) continue;
        recorded = candidate;
        if (!existsSync(join(directory, "browser-ready"))) continue;
        browser = browserProcessRecord.assert(
          JSON.parse(await readFile(join(directory, "browser-process.json"), "utf8")),
        );
        break;
      } catch {
        /* The manifest or browser ownership record may still be writing. */
      }
    }
    if (browser) break;
    if (child.exitCode !== null || child.signalCode !== null) break;
    await delay(100);
  }
  assert.ok(recorded && browser, "fixture must open its real browser before interruption");
  assert.deepEqual(await identity(child.pid), owner);
  assert.deepEqual(await identity(browser.process.pid), browser.process);
  const exited = new Promise<void>((accept) => child.once("exit", () => accept()));
  child.kill("SIGKILL");
  await exited;
  await cleanup(recorded);
  assert.equal(
    await identity(browser.process.pid),
    undefined,
    "browser must exit with its owned services",
  );
  await assert.rejects(stat(runPath(recorded.id)));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    assert.deepEqual(await identity(child.pid), owner);
    const exited = new Promise<void>((accept) => child.once("exit", () => accept()));
    child.kill("SIGKILL");
    await exited;
  }
  if (recorded && existsSync(runPath(recorded.id))) {
    const latest = manifestType.assert(
      JSON.parse(await readFile(join(runPath(recorded.id), "manifest.json"), "utf8")),
    );
    await cleanup(latest);
  }
}
console.log(
  `Verified bounded failure evidence (${retained.length} files, ${bytes} bytes), browser termination, and complete abandoned-run cleanup.`,
);
