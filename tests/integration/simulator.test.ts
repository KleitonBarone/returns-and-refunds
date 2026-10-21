import { createHmac, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createSimulator } from "../../apps/simulator/src/app.ts";
import { readSimulatorConfig } from "../../apps/simulator/src/config.ts";
import { connectSimulator } from "../../apps/simulator/src/db.ts";
import { deliverNext } from "../../apps/simulator/src/events.ts";
import { captures, deliveries } from "../../apps/simulator/src/schema.ts";
import {
  type controlInput,
  providerEvent,
  providerReceipt,
  simulatorDiagnostics,
} from "../../packages/contracts/src/payment.ts";
import { applicationEnvironment, simulatorEnvironment } from "../../scripts/environment.ts";

const config = readSimulatorConfig();
if (!config.runId.startsWith("codex-returns-test-"))
  throw new Error("Simulator checks require an isolated run");
const { db, pool } = connectSimulator(config.databaseUrl);
afterAll(() => pool.end());
const base = `http://127.0.0.1:${config.port}`;
async function request(
  path: string,
  body?: unknown,
  admin = false,
  signal = AbortSignal.timeout(10000),
) {
  return fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${admin ? config.adminToken : config.apiToken}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}
async function fixture(
  mode: typeof controlInput.infer.mode = "success",
  options: { eventDelayMs?: number; eventCopies?: number; responseDelayMs?: number } = {},
) {
  const paymentRef = `payment-${randomUUID()}`;
  const captured = await request(
    "/control/captures",
    { merchantId: "northline", paymentRef, capturedMinor: 10001, currency: "USD" },
    true,
  );
  expect(captured.status).toBe(201);
  const configured = await request(
    "/control/payments",
    {
      merchantId: "northline",
      paymentRef,
      mode,
      responseDelayMs: options.responseDelayMs ?? 0,
      eventDelayMs: options.eventDelayMs ?? 0,
      eventCopies: options.eventCopies ?? 1,
    },
    true,
  );
  expect(configured.status).toBe(200);
  return { paymentRef, idempotencyKey: randomUUID(), amountMinor: 3334, currency: "USD" };
}
async function diagnostics() {
  return simulatorDiagnostics.assert(
    await (await request("/control/diagnostics", undefined, true)).json(),
  );
}
const submitPath = "/v1/merchants/northline/refunds";
describe("persistent HTTP payment simulator", () => {
  it("keeps one ledger entry for replay and rejects changed content", async () => {
    const input = await fixture();
    const first = await request(submitPath, input);
    expect(first.status).toBe(201);
    const receipt = providerReceipt.assert(await first.json());
    const replay = await request(submitPath, input);
    expect(replay.status).toBe(200);
    expect(providerReceipt.assert(await replay.json())).toEqual(receipt);
    expect((await request(submitPath, { ...input, amountMinor: 3333 })).status).toBe(409);
    const result = await diagnostics();
    expect(result.ledger.filter((row) => row.refundId === receipt.id)).toHaveLength(1);
    expect(result.deliveries.filter((row) => row.refundId === receipt.id)).toHaveLength(2);
  });
  it("enforces capture, merchant, currency and valid integer amounts", async () => {
    const input = await fixture();
    expect((await request("/v1/merchants/other-store/refunds", input)).status).toBe(404);
    expect((await request(submitPath, { ...input, currency: "EUR" })).status).toBe(422);
    for (const amountMinor of [0, -1, 1.5, 2147483648])
      expect((await request(submitPath, { ...input, amountMinor })).status).toBe(400);
    expect((await request(submitPath, { ...input, amountMinor: 10002 })).status).toBe(409);
    expect((await request(submitPath, { ...input, amountMinor: 10001 })).status).toBe(201);
    expect(
      (await request(submitPath, { ...input, idempotencyKey: randomUUID(), amountMinor: 1 }))
        .status,
    ).toBe(409);
    expect(
      (await request(`/v1/merchants/other-store/refunds/${input.idempotencyKey}`)).status,
    ).toBe(404);
  });
  it("serializes competing keys against the captured amount", async () => {
    const input = await fixture();
    const blocker = await pool.connect();
    await blocker.query("begin");
    await blocker.query(
      "select payment_ref from captures where merchant_id=$1 and payment_ref=$2 for update",
      ["northline", input.paymentRef],
    );
    const pending = [1, 2].map(() =>
      request(submitPath, { ...input, idempotencyKey: randomUUID(), amountMinor: 7000 }),
    );
    try {
      const deadline = Date.now() + 5000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const result = await pool.query<{ count: number }>(
          "select count(*)::int as count from pg_stat_activity where wait_event_type='Lock' and query ilike '%for update%'",
        );
        waiting = result.rows[0]?.count ?? 0;
        if (waiting >= 2) break;
        await delay(10);
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
      await blocker.query("commit");
      expect((await Promise.all(pending)).map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      const entries = (await diagnostics()).ledger.filter(
        (row) => row.paymentRef === input.paymentRef,
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]?.amountMinor).toBe(7000);
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await Promise.all(pending);
    }
  });
  it("deduplicates concurrent copies of the same key", async () => {
    const input = await fixture();
    const responses = await Promise.all([request(submitPath, input), request(submitPath, input)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const receipts = await Promise.all(
      responses.map(async (response) => providerReceipt.assert(await response.json())),
    );
    expect(receipts[0]?.id).toBe(receipts[1]?.id);
    expect(
      (await diagnostics()).ledger.filter((row) => row.paymentRef === input.paymentRef),
    ).toHaveLength(1);
  });
  it("persists terminal rejection without a financial ledger write", async () => {
    const input = await fixture("reject");
    const receipt = providerReceipt.assert(await (await request(submitPath, input)).json());
    expect(receipt).toMatchObject({ status: "failed", failureCode: "refund_rejected" });
    expect(providerReceipt.assert(await (await request(submitPath, input)).json()).id).toBe(
      receipt.id,
    );
    expect(
      (await diagnostics()).ledger.filter((row) => row.paymentRef === input.paymentRef),
    ).toHaveLength(0);
  });
  it("rolls back the key and financial write when event scheduling fails", async () => {
    const input = await fixture();
    // The payment reference contains a test-generated UUID, never user input.
    await db.execute(
      sql.raw(
        `alter table deliveries add constraint injected_event_failure check (payload->'refund'->>'paymentRef' <> '${input.paymentRef}')`,
      ),
    );
    try {
      expect((await request(submitPath, input)).status).toBe(500);
      expect((await request(`${submitPath}/${input.idempotencyKey}`)).status).toBe(404);
      const result = await diagnostics();
      expect(result.ledger.filter((row) => row.paymentRef === input.paymentRef)).toHaveLength(0);
      expect(result.refunds.filter((row) => row.paymentRef === input.paymentRef)).toHaveLength(0);
    } finally {
      await db.execute(sql`alter table deliveries drop constraint injected_event_failure`);
    }
    const receipt = providerReceipt.assert(await (await request(submitPath, input)).json());
    expect((await diagnostics()).ledger.filter((row) => row.refundId === receipt.id)).toHaveLength(
      1,
    );
  });
  it("retries a durable pre-write failure under the original key", async () => {
    const input = await fixture("retry_once");
    expect((await request(submitPath, input)).status).toBe(503);
    expect((await request(`${submitPath}/${input.idempotencyKey}`)).status).toBe(404);
    expect(
      (await diagnostics()).refunds.filter((row) => row.idempotencyKey === input.idempotencyKey),
    ).toHaveLength(0);
    const receipt = providerReceipt.assert(await (await request(submitPath, input)).json());
    expect(receipt.status).toBe("succeeded");
    expect((await diagnostics()).ledger.filter((row) => row.refundId === receipt.id)).toHaveLength(
      1,
    );
  });
  it("survives a dropped response after its financial commit", async () => {
    const input = await fixture("drop_response");
    await expect(request(submitPath, input)).rejects.toThrow();
    const recovered = providerReceipt.assert(
      await (await request(`${submitPath}/${input.idempotencyKey}`)).json(),
    );
    expect(recovered.status).toBe("succeeded");
    expect(providerReceipt.assert(await (await request(submitPath, input)).json()).id).toBe(
      recovered.id,
    );
    expect(
      (await diagnostics()).ledger.filter((row) => row.refundId === recovered.id),
    ).toHaveLength(1);
  });
  it("can delay the response while its durable receipt is already queryable", async () => {
    const input = await fixture("delay_response", { responseDelayMs: 1000 });
    await expect(request(submitPath, input, false, AbortSignal.timeout(250))).rejects.toThrow();
    const recovered = providerReceipt.assert(
      await (await request(`${submitPath}/${input.idempotencyKey}`)).json(),
    );
    expect(recovered.status).toBe("succeeded");
    expect(
      (await diagnostics()).ledger.filter((row) => row.refundId === recovered.id),
    ).toHaveLength(1);
  });
  it("reopens server and database connections without losing keys or ledger entries", async () => {
    const input = await fixture();
    const receipt = providerReceipt.assert(await (await request(submitPath, input)).json());
    for (let restart = 0; restart < 2; restart++) {
      const connection = connectSimulator(config.databaseUrl);
      const server = await createSimulator(connection.db, { ...config, port: 0 });
      try {
        const address = await server.listen({ port: 0, host: "127.0.0.1" });
        const lookup = await fetch(`${address}${submitPath}/${input.idempotencyKey}`, {
          headers: { authorization: `Bearer ${config.apiToken}` },
        });
        expect(providerReceipt.assert(await lookup.json())).toEqual(receipt);
      } finally {
        await server.close();
        await connection.pool.end();
      }
    }
    expect((await diagnostics()).ledger.filter((row) => row.refundId === receipt.id)).toHaveLength(
      1,
    );
  });
  it("persists duplicate and delayed events and signs their actual raw delivery bytes", async () => {
    const input = await fixture("success", { eventDelayMs: 60000, eventCopies: 2 });
    const receipt = providerReceipt.assert(await (await request(submitPath, input)).json());
    const received: Array<{ raw: string; timestamp: string; signature: string }> = [];
    const receiver = Fastify();
    receiver.removeContentTypeParser("application/json");
    receiver.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_request, body, done) => done(null, body),
    );
    receiver.post("/api/provider-events", async (request) => {
      expect(typeof request.body).toBe("string");
      if (typeof request.body !== "string") throw new Error("Raw event body required");
      const timestamp = request.headers["x-simulator-timestamp"];
      const signature = request.headers["x-simulator-signature"];
      if (typeof timestamp !== "string" || typeof signature !== "string")
        throw new Error("Missing signature");
      received.push({ raw: request.body, timestamp, signature });
      return { accepted: true };
    });
    await receiver.listen({ port: Number(new URL(config.webhookUrl).port), host: "127.0.0.1" });
    try {
      expect((await request("/control/deliver", { refundId: receipt.id }, true)).status).toBe(200);
      expect(received).toHaveLength(1);
      expect(providerEvent.assert(JSON.parse(received[0]?.raw ?? "null")).refund.status).toBe(
        "processing",
      );
      const later = Date.now() + 60001;
      const restarted = connectSimulator(config.databaseUrl);
      try {
        expect(
          (await deliverNext(restarted.db, config, { now: later, refundId: receipt.id }))
            ?.delivered,
        ).toBe(true);
        expect(
          (await deliverNext(restarted.db, config, { now: later, refundId: receipt.id }))
            ?.delivered,
        ).toBe(true);
      } finally {
        await restarted.pool.end();
      }
      expect(received).toHaveLength(3);
      const events = received.map((delivery) => {
        expect(delivery.signature).toBe(
          createHmac("sha256", config.signingSecret)
            .update(`${delivery.timestamp}.${delivery.raw}`)
            .digest("hex"),
        );
        expect(Math.abs(Date.now() / 1000 - Number(delivery.timestamp))).toBeLessThan(5);
        return providerEvent.assert(JSON.parse(delivery.raw));
      });
      expect(events[1]?.id).toBe(events[2]?.id);
      expect(events[1]?.occurredAt).toBe(config.demoNow);
      expect(events[1]?.refund.status).toBe("succeeded");
      const stored = await db.select().from(deliveries).where(eq(deliveries.refundId, receipt.id));
      expect(stored.every((delivery) => delivery.deliveredAt && delivery.attempts === 1)).toBe(
        true,
      );
    } finally {
      await receiver.close();
    }
  });
  it("retains failed deliveries across connections and retries after their scheduled backoff", async () => {
    const input = await fixture();
    const receipt = providerReceipt.assert(await (await request(submitPath, input)).json());
    const failed = await deliverNext(db, config, { refundId: receipt.id });
    expect(failed).toMatchObject({ delivered: false, fenced: false });
    const [stored] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, failed?.id ?? ""));
    expect(stored).toMatchObject({
      attempts: 1,
      lastStatus: 0,
      deliveredAt: null,
      leaseToken: null,
    });
    const receiver = Fastify();
    receiver.post("/api/provider-events", async () => ({ accepted: true }));
    await receiver.listen({ port: Number(new URL(config.webhookUrl).port), host: "127.0.0.1" });
    const reconnected = connectSimulator(config.databaseUrl);
    try {
      const future = Date.now() + 2000;
      for (let index = 0; index < 2; index++)
        await deliverNext(reconnected.db, config, { refundId: receipt.id, now: future });
      const [retried] = await reconnected.db
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, failed?.id ?? ""));
      expect(retried?.deliveredAt).not.toBeNull();
      expect(retried).toMatchObject({ attempts: 2, lastStatus: 200 });
    } finally {
      await receiver.close();
      await reconnected.pool.end();
    }
  });
  it("fences an earlier sender after another sender reclaims its expired lease", async () => {
    const input = await fixture();
    const receipt = providerReceipt.assert(await (await request(submitPath, input)).json());
    let firstEntered = () => {};
    const entered = new Promise<void>((accept) => {
      firstEntered = accept;
    });
    let releaseFirst = () => {};
    const release = new Promise<void>((accept) => {
      releaseFirst = accept;
    });
    let received = 0;
    const receiver = Fastify();
    receiver.post("/api/provider-events", async () => {
      received++;
      if (received === 1) {
        firstEntered();
        await release;
      }
      return { accepted: true };
    });
    await receiver.listen({ port: Number(new URL(config.webhookUrl).port), host: "127.0.0.1" });
    const now = Date.now();
    const first = deliverNext(db, config, { refundId: receipt.id, now });
    try {
      await Promise.race([
        entered,
        delay(2500, undefined, { ref: false }).then(() => {
          throw new Error("Delivery did not reach its receiver");
        }),
      ]);
      const second = await deliverNext(db, config, { refundId: receipt.id, now: now + 2100 });
      expect(second).toMatchObject({ delivered: true, fenced: false });
      releaseFirst();
      const stale = await first;
      expect(stale?.id).toBe(second?.id);
      expect(stale?.fenced).toBe(true);
      const [stored] = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, stale?.id ?? ""));
      expect(stored?.deliveredAt).not.toBeNull();
      expect(stored?.attempts).toBe(2);
    } finally {
      releaseFirst();
      await first;
      await receiver.close();
    }
  });
  it("keeps provider SQL and control credentials out of the application environment", async () => {
    expect(applicationEnvironment(process.env).SIMULATOR_DATABASE_URL).toBeUndefined();
    expect(applicationEnvironment(process.env).SIMULATOR_ADMIN_TOKEN).toBeUndefined();
    expect(simulatorEnvironment(process.env).DATABASE_URL).toBeUndefined();
    expect((await request("/control/diagnostics")).status).toBe(401);
    expect((await request("/%63ontrol/diagnostics")).status).not.toBe(200);
    const applicationUrl = new URL(String(process.env.DATABASE_URL));
    applicationUrl.port = new URL(config.databaseUrl).port;
    applicationUrl.pathname = "/payment_simulator";
    const denied = new Pool({
      connectionString: applicationUrl.href,
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    try {
      await expect(denied.query("select * from ledger")).rejects.toThrow(/authentication failed/);
    } finally {
      await denied.end();
    }
    expect(
      await db
        .select()
        .from(captures)
        .where(
          and(eq(captures.merchantId, "northline"), eq(captures.paymentRef, "payment-order-1042")),
        ),
    ).toHaveLength(1);
  });
});
