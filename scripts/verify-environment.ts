import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { connectDatabase } from "../apps/server/src/db.ts";
import { orders } from "../apps/server/src/schema.ts";
import { prepareSimulatorDatabase } from "../apps/simulator/src/database.ts";
import { providerReceipt, simulatorDiagnostics } from "../packages/contracts/src/payment.ts";
import { prepareDatabase } from "./database.ts";
import {
  chooseSubnet,
  cleanup,
  docker,
  identity,
  launchApi,
  manifestType,
  restartSimulator,
  root,
  runEnvironment,
  runPath,
} from "./environment.ts";
import { verifyRefundRestart } from "./verify-refund-restart.ts";

const sentinel = `returns-fixture-${randomUUID()}`;
const previousProviderTimeout = process.env.PROVIDER_TIMEOUT_MS;

async function verifyDemoSupervision() {
  let output = "";
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/demo.ts", "run"], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const exited = new Promise<number | null>((accept, reject) => {
    child.once("exit", accept);
    child.once("error", reject);
  });
  child.stdout.on("data", (chunk: Buffer) => {
    output = `${output}${chunk}`.slice(-65536);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output = `${output}${chunk}`.slice(-65536);
  });
  assert.ok(child.pid);
  const owner = await identity(child.pid);
  let runId: string | undefined;
  let recorded: typeof manifestType.infer | undefined;
  try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      runId = /Starting (codex-returns-test-[a-f0-9-]+)/.exec(output)?.[1];
      if (runId && output.includes(`Disposable demo ${runId}`)) {
        recorded = manifestType.assert(
          JSON.parse(await readFile(join(runPath(runId), "manifest.json"), "utf8")),
        );
        assert.equal(recorded.owner.pid, child.pid);
        break;
      }
      assert.equal(child.exitCode, null, output);
      await delay(100);
    }
    assert.ok(recorded && output.includes(`Disposable demo ${recorded.id}`), output);
    // Reset intentionally replaces the worker; its replacement must still be supervised.
    const reset = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/demo.ts", "reset", recorded.id],
      { cwd: root, stdio: "ignore", windowsHide: true },
    );
    await new Promise<void>((accept, reject) => {
      reset.once("error", reject);
      reset.once("exit", (code) =>
        code === 0 ? accept() : reject(new Error(`Demo reset exited ${code}`)),
      );
    });
    recorded = manifestType.assert(
      JSON.parse(await readFile(join(runPath(recorded.id), "manifest.json"), "utf8")),
    );
    const worker = recorded.children.findLast((entry) => entry.pid === recorded?.workerPid);
    assert.ok(worker);
    assert.deepEqual(await identity(worker.pid), worker);
    process.kill(worker.pid, "SIGKILL");
    const code = await Promise.race([
      exited,
      delay(60000, undefined, { ref: false }).then(() => {
        throw new Error("Demo ignored unexpected worker exit");
      }),
    ]);
    assert.equal(code, 1, output);
    assert.match(output, /Refund worker exited unexpectedly/);
    await assert.rejects(stat(runPath(recorded.id)));
    const result = JSON.parse(await readFile(join(root, ".local", "last-result.json"), "utf8"));
    assert.equal(result.runId, recorded.id);
    assert.equal(result.result, "failed; cleanup verified");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      assert.deepEqual(await identity(child.pid), owner);
      child.kill("SIGKILL");
      await exited;
    }
    if (runId) await recoverRecordedRun(runId);
  }
}
async function recoverRecordedRun(id: string) {
  try {
    await stat(runPath(id));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const latest = manifestType.assert(
    JSON.parse(await readFile(join(runPath(id), "manifest.json"), "utf8")),
  );
  await cleanup(latest);
}
docker(["volume", "create", "--label", "io.returns.verification=sentinel", sentinel]);
try {
  docker([
    "network",
    "create",
    "--internal",
    "--subnet",
    chooseSubnet(),
    "--label",
    "io.returns.verification=sentinel",
    sentinel,
  ]);
  process.env.PROVIDER_TIMEOUT_MS = "5000";
  for (let attempt = 0; attempt < 2; attempt++) {
    await runEnvironment("verify", async (env, manifest) => {
      const { db, pool } = connectDatabase(String(env.DATABASE_URL));
      try {
        await db
          .update(orders)
          .set({ number: "PERSISTED-CHANGE" })
          .where(eq(orders.id, "order-1042"));
        await prepareDatabase(String(env.DATABASE_URL), manifest.id, true);
        const [order] = await db.select().from(orders).where(eq(orders.id, "order-1042"));
        assert.equal(
          order?.number,
          "PERSISTED-CHANGE",
          "migration/seed reruns must preserve demo progress",
        );
        const input = {
          paymentRef: "payment-order-1042",
          idempotencyKey: randomUUID(),
          amountMinor: 3500,
          currency: "USD",
        };
        const headers = {
          authorization: `Bearer ${env.SIMULATOR_API_TOKEN}`,
          "content-type": "application/json",
        };
        const refundPath = `${env.SIMULATOR_URL}/v1/merchants/northline/refunds`;
        const receipt = providerReceipt.assert(
          await (
            await fetch(refundPath, {
              method: "POST",
              headers,
              body: JSON.stringify(input),
              signal: AbortSignal.timeout(5000),
            })
          ).json(),
        );
        await prepareSimulatorDatabase(String(env.SIMULATOR_DATABASE_URL), manifest.id, true);
        await restartSimulator(manifest, env);
        const persisted = providerReceipt.assert(
          await (
            await fetch(`${refundPath}/${input.idempotencyKey}`, {
              headers,
              signal: AbortSignal.timeout(5000),
            })
          ).json(),
        );
        assert.deepEqual(
          persisted,
          receipt,
          "actual simulator restart must preserve the key and outcome",
        );
        const diagnostics = simulatorDiagnostics.assert(
          await (
            await fetch(`${env.SIMULATOR_URL}/control/diagnostics`, {
              headers: { authorization: `Bearer ${env.SIMULATOR_ADMIN_TOKEN}` },
              signal: AbortSignal.timeout(5000),
            })
          ).json(),
        );
        assert.equal(diagnostics.ledger.filter((entry) => entry.refundId === receipt.id).length, 1);
        assert.equal(
          diagnostics.deliveries.filter((entry) => entry.refundId === receipt.id).length,
          2,
        );
        await launchApi(manifest, env);
        await verifyRefundRestart(db, env, manifest);
      } finally {
        await pool.end();
      }
    });
  }
  process.env.RETURNS_INJECT_STARTUP_FAILURE = "1";
  await assert.rejects(runEnvironment("verify"), /failed/);
  delete process.env.RETURNS_INJECT_STARTUP_FAILURE;
  await verifyDemoSupervision();
  assert.ok(docker(["volume", "inspect", sentinel]), "unrelated fixture must survive teardown");

  const before = new Set(await readdir(join(root, ".local", "runs")));
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/environment.ts", "verify"], {
    cwd: root,
    env: { ...process.env, RETURNS_VERIFY_HOLD: "1" },
    stdio: "ignore",
    windowsHide: true,
  });
  if (!child.pid) throw new Error("Cannot launch interruption fixture");
  const owner = await identity(child.pid);
  let recorded: typeof manifestType.infer | undefined;
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      for (const id of await readdir(join(root, ".local", "runs"))) {
        if (before.has(id)) continue;
        try {
          const candidate = manifestType.assert(
            JSON.parse(await readFile(join(runPath(id), "manifest.json"), "utf8")),
          );
          if (candidate.owner.pid === child.pid && candidate.state === "running")
            recorded = candidate;
        } catch {
          /* Atomic fixture startup may still be writing. */
        }
      }
      if (recorded) break;
      await delay(100);
    }
    assert.ok(recorded, "interruption fixture must reach readiness");
    assert.deepEqual(await identity(child.pid), owner);
    child.kill("SIGKILL");
    await new Promise<void>((accept) => child.once("exit", () => accept()));
    await cleanup(recorded);
    await assert.rejects(stat(runPath(recorded.id)));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (recorded) await recoverRecordedRun(recorded.id);
  }
  assert.ok(docker(["network", "inspect", sentinel]), "unrelated fixture must survive teardown");
  console.log(
    "Verified repeatable startup, persisted app/provider data, actual simulator/worker restarts, demo reset and unexpected worker exit, failed startup, abrupt interruption, abandoned-run recovery, and preserved unrelated resources.",
  );
} finally {
  if (previousProviderTimeout === undefined) delete process.env.PROVIDER_TIMEOUT_MS;
  else process.env.PROVIDER_TIMEOUT_MS = previousProviderTimeout;
  delete process.env.RETURNS_INJECT_STARTUP_FAILURE;
  if (docker(["network", "ls", "-q", "--filter", `name=^${sentinel}$`]))
    docker(["network", "rm", sentinel]);
  docker(["volume", "rm", sentinel]);
}
