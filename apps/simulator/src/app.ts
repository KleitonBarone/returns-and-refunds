import { setTimeout as delay } from "node:timers/promises";
import { type } from "arktype";
import { desc, eq } from "drizzle-orm";
import Fastify from "fastify";
import {
  captureInput,
  controlInput,
  enqueueEventInput,
  providerReceipt,
  refundSubmission,
} from "../../../packages/contracts/src/payment.ts";
import type { readSimulatorConfig } from "./config.ts";
import type { SimulatorDatabase } from "./db.ts";
import { deliverBatch, enqueueEvents } from "./events.ts";
import {
  configurePayment,
  lookupRefund,
  receiptFields,
  SimulatorError,
  submitRefund,
} from "./refunds.ts";
import { captures, deliveries, ledger, simulatorIdentity, simulatorRefunds } from "./schema.ts";

const deliveryInput = type({ "refundId?": "string.uuid" }).onDeepUndeclaredKey("reject");
export async function createSimulator(
  db: SimulatorDatabase,
  config: ReturnType<typeof readSimulatorConfig>,
) {
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  app.addHook("onRequest", async (request) => {
    if (request.routeOptions.url === "/health") return;
    const expected = request.routeOptions.url?.startsWith("/control/")
      ? config.adminToken
      : config.apiToken;
    if (request.headers.authorization !== `Bearer ${expected}`)
      throw new SimulatorError(401, "Simulator credential required");
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SimulatorError)
      return reply.code(error.statusCode).send({ message: error.message });
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    )
      return reply.code(error.statusCode).send({ message: "Invalid simulator request" });
    console.error(error instanceof Error ? error.message : "Simulator failure");
    return reply.code(500).send({ message: "Simulator unavailable" });
  });
  app.get("/health", async () => {
    const [identity] = await db
      .select()
      .from(simulatorIdentity)
      .where(eq(simulatorIdentity.id, "payment-simulator"));
    if (identity?.runId !== config.runId) throw new Error("Simulator identity mismatch");
    return { service: "payment-simulator", runId: config.runId, database: "ready" };
  });
  app.post<{ Params: { merchantId: string } }>(
    "/v1/merchants/:merchantId/refunds",
    async (request, reply) => {
      const input = refundSubmission(request.body);
      if (input instanceof type.errors) throw new SimulatorError(400, input.summary);
      const result = await submitRefund(db, request.params.merchantId, input, config.demoNow);
      if (result.kind === "retryable")
        return reply
          .code(503)
          .send({ message: "Injected failure before refund write", retryable: true });
      if (result.mode === "drop_response") {
        reply.hijack();
        reply.raw.destroy();
        return;
      }
      if (result.mode === "delay_response") await delay(result.responseDelayMs);
      return reply.code(result.replay ? 200 : 201).send(result.receipt);
    },
  );
  app.get<{ Params: { merchantId: string; key: string } }>(
    "/v1/merchants/:merchantId/refunds/:key",
    async (request) => {
      const receipt = await lookupRefund(db, request.params.merchantId, request.params.key);
      if (!receipt) throw new SimulatorError(404, "Refund key not found");
      return receipt;
    },
  );
  app.post("/control/captures", async (request, reply) => {
    const input = captureInput(request.body);
    if (input instanceof type.errors) throw new SimulatorError(400, input.summary);
    const [created] = await db.insert(captures).values(input).onConflictDoNothing().returning();
    if (!created) throw new SimulatorError(409, "Captured payment already exists");
    return reply.code(201).send(created);
  });
  app.post("/control/payments", async (request) => {
    const input = controlInput(request.body);
    if (input instanceof type.errors) throw new SimulatorError(400, input.summary);
    await configurePayment(db, input);
    return { configured: true };
  });
  app.post("/control/events", async (request) => {
    const input = enqueueEventInput(request.body);
    if (input instanceof type.errors) throw new SimulatorError(400, input.summary);
    const [refund] = await db
      .select(receiptFields)
      .from(simulatorRefunds)
      .where(eq(simulatorRefunds.id, input.refundId));
    if (!refund) throw new SimulatorError(404, "Refund not found");
    const receipt = providerReceipt.assert({ ...refund, status: input.status });
    const eventId = await db.transaction((tx) =>
      enqueueEvents(tx, receipt, config.demoNow, input.delayMs, input.copies),
    );
    return { eventId };
  });
  app.post("/control/deliver", async (request) => {
    const input = deliveryInput(request.body ?? {});
    if (input instanceof type.errors) throw new SimulatorError(400, input.summary);
    return { deliveries: await deliverBatch(db, config, input.refundId) };
  });
  app.get("/control/diagnostics", async () => ({
    runId: config.runId,
    ledger: await db.select().from(ledger).orderBy(desc(ledger.recordedAt)).limit(100),
    refunds: await db.select(receiptFields).from(simulatorRefunds).limit(100),
    deliveries: await db
      .select({
        id: deliveries.id,
        eventId: deliveries.eventId,
        refundId: deliveries.refundId,
        runAt: deliveries.runAt,
        deliveredAt: deliveries.deliveredAt,
        attempts: deliveries.attempts,
        lastStatus: deliveries.lastStatus,
      })
      .from(deliveries)
      .limit(100),
  }));
  return app;
}
