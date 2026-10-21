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
import { healthResponse } from "../packages/contracts/src/index.ts";
import { providerReceipt, simulatorDiagnostics } from "../packages/contracts/src/payment.ts";
import { prepareDatabase } from "./database.ts";
import {
  applicationEnvironment,
  cleanup,
  docker,
  identity,
  launch,
  manifestType,
  restartSimulator,
  root,
  runEnvironment,
  runPath,
  waitFor,
} from "./environment.ts";

const sentinel = `returns-fixture-${randomUUID()}`;
async function recoverRecordedRun(recorded: typeof manifestType.infer) {
  try {
    await stat(runPath(recorded.id));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  await cleanup(recorded);
}
const baselineNetworks = docker(["network", "ls", "-q"]).split(/\s+/).filter(Boolean);
docker(["volume", "create", "--label", "io.returns.verification=sentinel", sentinel]);
try {
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
        await launch(
          manifest,
          ["--import", "tsx", "apps/server/src/api.ts"],
          applicationEnvironment(env),
        );
        await waitFor(
          `http://127.0.0.1:${manifest.apiPort}/api/health`,
          (body) => healthResponse.allows(body) && body.runId === manifest.id,
        );
      } finally {
        await pool.end();
      }
    });
  }
  process.env.RETURNS_INJECT_STARTUP_FAILURE = "1";
  await assert.rejects(runEnvironment("verify"), /failed/);
  delete process.env.RETURNS_INJECT_STARTUP_FAILURE;
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
    if (recorded) await recoverRecordedRun(recorded);
  }
  for (const network of baselineNetworks) assert.ok(docker(["network", "inspect", network]));
  console.log(
    "Verified repeatable startup, persisted app/provider data, actual simulator restart, failed startup, abrupt interruption, abandoned-run recovery, and preserved unrelated resources.",
  );
} finally {
  delete process.env.RETURNS_INJECT_STARTUP_FAILURE;
  docker(["volume", "rm", sentinel]);
}
