import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unwatchFile, watchFile } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { type } from "arktype";
import { connectDatabase } from "../apps/server/src/db.ts";
import { connectSimulator } from "../apps/simulator/src/db.ts";
import {
  appTables,
  markFreshDemo,
  providerTables,
  resetDemo,
  verifyDemoOwner,
} from "./demo-reset.ts";
import { type DemoEvidence, recoverDemo, seedDemoScenarios } from "./demo-scenarios.ts";
import {
  applicationEnvironment,
  docker,
  launch,
  launchApi,
  manifestType,
  restartRefundWorker,
  root,
  runEnvironment,
  runPath,
  stopRefundWorker,
} from "./environment.ts";

const resetCommand = type({
  id: "string.uuid",
  runId: "string",
  action: "'reset'",
}).onDeepUndeclaredKey("reject");
const commandResult = type({ id: "string.uuid", "error?": "string" });

function versions() {
  return {
    node: process.versions.node,
    pnpm: process.env.npm_config_user_agent?.split(" ")[0] ?? "not launched with pnpm",
    docker: docker(["version", "--format", "{{.Server.Version}}"]),
    compose: docker(["compose", "version", "--short"]),
    postgres: "18.1-alpine",
  };
}

async function saveEvidence(name: string, value: unknown) {
  await mkdir(join(root, ".local"), { recursive: true });
  await writeFile(join(root, ".local", name), `${JSON.stringify(value, null, 2)}\n`);
}

export async function requestDemoReset(id: string) {
  const directory = runPath(id);
  const manifest = manifestType.assert(
    JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
  );
  assert.equal(manifest.id, id);
  await verifyDemoOwner(manifest);
  const lock = join(directory, "demo-command.lock");
  await writeFile(lock, "reset", { flag: "wx", mode: 0o600 });
  try {
    const command = { id: randomUUID(), runId: id, action: "reset" };
    const temporary = join(directory, `demo-command-${command.id}.tmp`);
    await writeFile(temporary, JSON.stringify(command), { flag: "wx", mode: 0o600 });
    await rename(temporary, join(directory, "demo-command.json"));
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      try {
        const result = commandResult.assert(
          JSON.parse(await readFile(join(directory, "demo-command-result.json"), "utf8")),
        );
        if (result.id === command.id) {
          if (result.error) throw new Error(result.error);
          console.log(
            `Reset and reseeded only the disposable demo ${id}. Reload the browser to sign in again.`,
          );
          return;
        }
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      }
      await verifyDemoOwner(manifest);
      await delay(100);
    }
    throw new Error("Demo reset timed out. Inspect the reset journal before continuing.");
  } finally {
    await rm(lock, { force: true });
  }
}

async function freshScenarios(env: NodeJS.ProcessEnv, manifest: typeof manifestType.infer) {
  await resetDemo(env, manifest);
  const journal = join(runPath(manifest.id), "demo-reset.json");
  try {
    const evidence = await seedDemoScenarios(env, manifest);
    await restartRefundWorker(manifest, env);
    await writeFile(
      journal,
      JSON.stringify({
        runId: manifest.id,
        status: "complete",
        commits: ["application", "simulator"],
      }),
    );
    return evidence;
  } catch (error) {
    await writeFile(
      journal,
      JSON.stringify({
        runId: manifest.id,
        status: "failed",
        phase: "scenario-seed",
        commits: ["application", "simulator"],
      }),
    );
    throw new Error("Demo scenario seed incomplete. Discarding this disposable run.", {
      cause: error,
    });
  }
}

async function runDemo(once: boolean) {
  await runEnvironment("demo", async (env, manifest) => {
    // Pin the business clock even if the caller has a different development override.
    env.DEMO_NOW = "2026-10-01T12:00:00.000Z";
    await launchApi(manifest, env);
    await markFreshDemo(env, manifest);
    const record = async (evidence: DemoEvidence) => {
      await saveEvidence("demo-last-run.json", {
        runId: manifest.id,
        source: manifest.source,
        versions: versions(),
        evidence,
      });
    };
    await record(await freshScenarios(env, manifest));
    if (once) return;
    await launch(
      manifest,
      ["node_modules/vite/bin/vite.js", "--config", "apps/web/vite.config.ts"],
      applicationEnvironment(env),
    );
    console.log(
      `Disposable demo ${manifest.id}\nOpen http://127.0.0.1:${manifest.webPort}\nReset: pnpm demo:reset ${manifest.id}\nCtrl+C stops this run and removes both disposable databases.`,
    );
    const directory = runPath(manifest.id);
    const commandPath = join(directory, "demo-command.json");
    const stopPath = join(directory, "stop-request");
    let handling = false;
    let previous = "";
    async function reply(id: string, error?: string) {
      const temporary = join(directory, `demo-result-${id}.tmp`);
      await writeFile(temporary, JSON.stringify({ id, ...(error ? { error } : {}) }), {
        mode: 0o600,
      });
      await rename(temporary, join(directory, "demo-command-result.json"));
    }
    try {
      await new Promise<void>((accept, reject) => {
        watchFile(stopPath, { interval: 100 }, (info) => {
          if (info.nlink > 0) accept();
        });
        watchFile(commandPath, { interval: 100 }, (info) => {
          if (handling || info.nlink === 0) return;
          handling = true;
          void (async () => {
            const command = resetCommand.assert(JSON.parse(await readFile(commandPath, "utf8")));
            if (command.id === previous) return;
            assert.equal(command.runId, manifest.id);
            previous = command.id;
            try {
              await record(await freshScenarios(env, manifest));
              await reply(command.id);
            } catch (error) {
              const message = error instanceof Error ? error.message : "Demo reset failed";
              await reply(command.id, message);
              reject(error);
            }
          })()
            .catch(reject)
            .finally(() => {
              handling = false;
            });
        });
      });
    } finally {
      unwatchFile(commandPath);
      unwatchFile(stopPath);
    }
  });
}

async function verifyDemo() {
  await runEnvironment("demo", async (env, manifest) => {
    env.DEMO_NOW = "2026-10-01T12:00:00.000Z";
    await launchApi(manifest, env);
    await markFreshDemo(env, manifest);
    const cycles: { evidence: DemoEvidence; recovery: Awaited<ReturnType<typeof recoverDemo>> }[] =
      [];
    for (let cycle = 0; cycle < 2; cycle++) {
      const evidence = await freshScenarios(env, manifest);
      const recovery = await recoverDemo(env, manifest, evidence);
      cycles.push({ evidence, recovery });
    }
    function financialAssertions(cycle: (typeof cycles)[number]) {
      const { evidence, recovery } = cycle;
      return {
        ...evidence,
        refunds: evidence.refunds.map(
          ({
            returnId: _returnId,
            operationId: _operationId,
            providerId: _providerId,
            ...refund
          }) => refund,
        ),
        inspection: { ...evidence.inspection, returnId: undefined },
        otherMerchant: { ...evidence.otherMerchant, returnId: undefined },
        recovery: {
          status: recovery.status,
          deliveryStatuses: recovery.deliveryStatuses,
          receiptOutcomes: recovery.receiptOutcomes,
          successAuditEntries: recovery.successAuditEntries,
          submissionAttempts: recovery.submissionAttempts,
          ledgerPreserved: recovery.ledgerPreserved,
          confirmedAppAmountMinor: recovery.confirmedAppAmountMinor,
        },
      };
    }
    assert.ok(cycles[0] && cycles[1]);
    assert.deepEqual(financialAssertions(cycles[0]), financialAssertions(cycles[1]));
    await stopRefundWorker(manifest);
    const app = connectDatabase(String(env.DATABASE_URL));
    const provider = connectSimulator(String(env.SIMULATOR_DATABASE_URL));
    const guards = [];
    try {
      async function snapshot() {
        const result: Record<string, string> = {};
        for (const [pool, tables] of [
          [app.pool, ["environment_identity", ...appTables]],
          [provider.pool, ["simulator_identity", ...providerTables]],
        ] as const) {
          for (const table of tables) {
            const { rows } = await pool.query<{ digest: string }>(
              `select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text, '')) as digest from ${table} t`,
            );
            result[table] = String(rows[0]?.digest);
          }
        }
        return result;
      }
      for (const [pool, table, marker, change, restore] of [
        [
          app.pool,
          "environment_identity",
          "returns-demo",
          "update environment_identity set disposable = 0 where id = $1",
          "update environment_identity set disposable = 1 where id = $1",
        ],
        [
          app.pool,
          "environment_identity",
          "returns-disposable-demo",
          "delete from environment_identity where id = $1",
          "insert into environment_identity values ($1, $2, 1)",
        ],
        [
          provider.pool,
          "simulator_identity",
          "payment-simulator",
          "update simulator_identity set run_id = 'another-run' where id = $1",
          "update simulator_identity set run_id = $2 where id = $1",
        ],
        [
          provider.pool,
          "simulator_identity",
          "payment-disposable-demo",
          "delete from simulator_identity where id = $1",
          "insert into simulator_identity values ($1, $2, true)",
        ],
      ] as const) {
        await pool.query(change, [marker]);
        const before = await snapshot();
        try {
          await assert.rejects(resetDemo(env, manifest), /disposable-demo identity mismatch/);
          assert.deepEqual(await snapshot(), before, "Refused reset changed project data");
          guards.push(`${table}/${marker}`);
        } finally {
          await pool.query(restore, restore.includes("$2") ? [marker, manifest.id] : [marker]);
        }
      }
      await assert.rejects(
        resetDemo({ ...env, SIMULATOR_DATABASE_URL: env.DATABASE_URL }, manifest),
        /outside the owned pair/,
      );
      const beforePartial = await provider.pool.query<{ n: number }>(
        "select count(*)::int as n from ledger",
      );
      await assert.rejects(
        resetDemo(env, manifest, () => {
          throw new Error("Injected second database commit failure");
        }),
        /Paired demo reset incomplete/,
      );
      assert.equal(
        (await provider.pool.query<{ n: number }>("select count(*)::int as n from ledger")).rows[0]
          ?.n,
        beforePartial.rows[0]?.n,
      );
      const journal = type({ status: "'failed'", commits: "string[]" }).assert(
        JSON.parse(await readFile(join(runPath(manifest.id), "demo-reset.json"), "utf8")),
      );
      assert.deepEqual(journal.commits, ["application"]);
      for (const port of [manifest.apiPort, manifest.simulatorPort]) {
        await assert.rejects(
          fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }),
        );
      }
      await saveEvidence("demo-last-verification.json", {
        runId: manifest.id,
        source: manifest.source,
        versions: versions(),
        cycles,
        equivalentFinancialAssertions: true,
        resetRefusalsPreservedAllRows: guards,
        mismatchedAddressRefused: true,
        partialCommitFailedStopped: true,
      });
      console.log(
        "Verified two equivalent reset/seed/demo cycles, recovery without reset, untouched data on reset refusals, and a stopped partial reset.",
      );
    } finally {
      await Promise.all([app.pool.end(), provider.pool.end()]);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, argument, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Unexpected arguments. Database URLs are never accepted.");
  if (action === "run" && (!argument || argument === "--once"))
    await runDemo(argument === "--once");
  else if (action === "verify" && !argument) await verifyDemo();
  else if (action === "reset" && argument) await requestDemoReset(argument);
  else throw new Error("Use demo:run [--once], demo:verify, or demo:reset <active-demo-run-id>");
}
