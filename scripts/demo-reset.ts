import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { connectDatabase } from "../apps/server/src/db.ts";
import { prepareSimulatorDatabase } from "../apps/simulator/src/database.ts";
import { connectSimulator } from "../apps/simulator/src/db.ts";
import { prepareDatabase } from "./database.ts";
import {
  identity,
  launchApi,
  launchSimulator,
  type Manifest,
  root,
  runPath,
  stopApi,
  stopRefundWorker,
  stopSimulator,
} from "./environment.ts";
import { workspaceIdentity } from "./environment-config.ts";

// Explicit lists make an added foreign key fail closed instead of cascading into unknown data.
export const appTables = [
  "merchants",
  "users",
  "memberships",
  "customers",
  "orders",
  "order_lines",
  "order_units",
  "sessions",
  "return_requests",
  "return_units",
  "refund_operations",
  "refund_receipts",
  "provider_event_receipts",
  "refund_jobs",
  "refund_attempts",
  "worker_heartbeat",
  "audit_entries",
  "return_reviews",
];
export const providerTables = ["captures", "simulator_refunds", "ledger", "controls", "deliveries"];

export async function verifyDemoOwner(manifest: Manifest) {
  const workspace = workspaceIdentity(root);
  const owner = await identity(manifest.owner.pid);
  assert.ok(
    manifest.mode === "demo" &&
      manifest.id.startsWith("codex-returns-test-") &&
      manifest.workspace === workspace &&
      manifest.state === "running" &&
      owner?.birth === manifest.owner.birth &&
      owner.commandHash === manifest.owner.commandHash,
    "Reset requires this checkout's active disposable demo supervisor",
  );
}

function databaseUrls(env: NodeJS.ProcessEnv, manifest: Manifest) {
  assert.equal(env.RETURNS_RUN_ID, manifest.id, "Demo environment pairing mismatch");
  const app = new URL(String(env.DATABASE_URL));
  const provider = new URL(String(env.SIMULATOR_DATABASE_URL));
  for (const [url, port, database, user] of [
    [app, manifest.dbPort, "returns_app", "returns_admin"],
    [provider, manifest.simulatorDbPort, "payment_simulator", "simulator_admin"],
  ] as const) {
    assert.ok(
      url.protocol === "postgres:" &&
        url.hostname === "127.0.0.1" &&
        url.port === String(port) &&
        url.pathname === `/${database}` &&
        url.username === user &&
        url.password.length > 0 &&
        !url.search &&
        !url.hash,
      "Reset refuses a database address outside the owned pair",
    );
  }
  return { app: app.href, provider: provider.href };
}

async function verifyMarkers(app: PoolClient, provider: PoolClient, runId: string, demo: boolean) {
  const application = await app.query<{ id: string; runId: string; disposable: number }>(
    'select id, run_id as "runId", disposable from environment_identity order by id',
  );
  const simulator = await provider.query<{ id: string; runId: string; disposable: boolean }>(
    'select id, run_id as "runId", disposable from simulator_identity order by id',
  );
  assert.deepEqual(
    application.rows,
    [
      { id: "returns-demo", runId, disposable: 1 },
      ...(demo ? [{ id: "returns-disposable-demo", runId, disposable: 1 }] : []),
    ],
    "Application disposable-demo identity mismatch",
  );
  assert.deepEqual(
    simulator.rows,
    [
      ...(demo ? [{ id: "payment-disposable-demo", runId, disposable: true }] : []),
      { id: "payment-simulator", runId, disposable: true },
    ],
    "Simulator disposable-demo identity mismatch",
  );
  assert.equal(
    (await app.query<{ name: string }>("select current_database() as name")).rows[0]?.name,
    "returns_app",
  );
  assert.equal(
    (await provider.query<{ name: string }>("select current_database() as name")).rows[0]?.name,
    "payment_simulator",
  );
}

async function connections(env: NodeJS.ProcessEnv, manifest: Manifest) {
  await verifyDemoOwner(manifest);
  const urls = databaseUrls(env, manifest);
  const appPool = connectDatabase(urls.app).pool;
  const providerPool = connectSimulator(urls.provider).pool;
  try {
    const app = await appPool.connect();
    try {
      const provider = await providerPool.connect();
      return {
        app,
        provider,
        close: async () => {
          app.release();
          provider.release();
          await Promise.all([appPool.end(), providerPool.end()]);
        },
      };
    } catch (error) {
      app.release();
      throw error;
    }
  } catch (error) {
    await Promise.all([appPool.end(), providerPool.end()]);
    throw error;
  }
}

// Called once on a freshly allocated demo pair, never by the reset command.
export async function markFreshDemo(env: NodeJS.ProcessEnv, manifest: Manifest) {
  const pair = await connections(env, manifest);
  try {
    await verifyMarkers(pair.app, pair.provider, manifest.id, false);
    assert.equal(
      (await pair.app.query<{ n: number }>("select count(*)::int as n from refund_operations"))
        .rows[0]?.n,
      0,
    );
    assert.equal(
      (await pair.provider.query<{ n: number }>("select count(*)::int as n from ledger")).rows[0]
        ?.n,
      0,
    );
    await pair.app.query(
      "insert into environment_identity values ('returns-disposable-demo', $1, 1)",
      [manifest.id],
    );
    await pair.provider.query(
      "insert into simulator_identity values ('payment-disposable-demo', $1, true)",
      [manifest.id],
    );
  } finally {
    await pair.close();
  }
}

// Two databases cannot commit atomically. A partial reset stays stopped and records the failure.
export async function resetDemo(
  env: NodeJS.ProcessEnv,
  manifest: Manifest,
  afterAppCommit?: () => void,
) {
  const pair = await connections(env, manifest);
  const commits: string[] = [];
  const journal = join(runPath(manifest.id), "demo-reset.json");
  let validated = false;
  try {
    await verifyMarkers(pair.app, pair.provider, manifest.id, true);
    validated = true;
    await stopRefundWorker(manifest);
    await stopApi(manifest);
    await stopSimulator(manifest);
    for (const [client, tables, marker] of [
      [pair.app, appTables, "environment_identity"],
      [pair.provider, providerTables, "simulator_identity"],
    ] as const) {
      await client.query("begin");
      await client.query("set local lock_timeout = '3s'");
      await client.query(`lock table ${[marker, ...tables].join(", ")} in access exclusive mode`);
    }
    await verifyMarkers(pair.app, pair.provider, manifest.id, true);
    await writeFile(journal, JSON.stringify({ runId: manifest.id, status: "resetting", commits }));
    await pair.app.query(`truncate ${appTables.join(", ")} restart identity`);
    await pair.provider.query(`truncate ${providerTables.join(", ")} restart identity`);
    await pair.app.query("commit");
    commits.push("application");
    afterAppCommit?.();
    await pair.provider.query("commit");
    commits.push("simulator");
    await prepareDatabase(String(env.DATABASE_URL), manifest.id, true);
    await prepareSimulatorDatabase(String(env.SIMULATOR_DATABASE_URL), manifest.id, true);
    await writeFile(
      journal,
      JSON.stringify({ runId: manifest.id, status: "base-seeded", commits }),
    );
    await launchSimulator(manifest, env);
    await launchApi(manifest, env);
  } catch (error) {
    await Promise.all([pair.app.query("rollback"), pair.provider.query("rollback")]);
    if (validated) {
      let stopped = true;
      for (const stop of [stopRefundWorker, stopApi, stopSimulator]) {
        try {
          await stop(manifest);
        } catch {
          stopped = false;
        }
      }
      await writeFile(journal, JSON.stringify({ runId: manifest.id, status: "failed", commits }));
      throw new Error(
        stopped
          ? "Paired demo reset incomplete. Services remain stopped; discard this disposable run."
          : "Paired demo reset incomplete. Service cleanup requires attention; discard this disposable run.",
        { cause: error },
      );
    }
    throw error;
  } finally {
    await pair.close();
  }
}
