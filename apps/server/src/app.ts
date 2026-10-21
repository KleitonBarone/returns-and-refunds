import cookie from "@fastify/cookie";
import { type } from "arktype";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import {
  actionInput,
  recoveryInput,
  refundInput,
  requestInput,
  sessionInput,
} from "../../../packages/contracts/src/index.ts";
import { createSession, listPersonas, requireActor, sessionActor } from "./actors.ts";
import type { readConfig } from "./config.ts";
import type { Database } from "./db.ts";
import { decideReturn } from "./decisions.ts";
import { HttpError } from "./domain.ts";
import { createPaymentProvider, type PaymentProvider } from "./provider.ts";
import { acceptProviderEvent, readSigningSecret, verifyProviderEvent } from "./provider-events.ts";
import { checkRefund, retryRefund } from "./refund-recovery.ts";
import { requestRefund } from "./refunds.ts";
import { listOrders, listReturns, requestReturn, returnDetail } from "./returns.ts";
import { environmentIdentity } from "./schema.ts";

export async function createApp(
  db: Database,
  config: ReturnType<typeof readConfig>,
  services: { provider?: PaymentProvider; signingSecret?: string } = {},
) {
  const provider = services.provider ?? createPaymentProvider();
  const signingSecret = services.signingSecret ?? readSigningSecret();
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  await app.register(cookie);
  app.addHook("onRequest", async (request) => {
    if (request.routeOptions.url === "/api/provider-events") return;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.origin !== config.webOrigin
    )
      throw new HttpError(403, "Request origin is not allowed");
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ message: error.message });
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    )
      return reply.code(error.statusCode).send({ message: "Invalid request" });
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    console.error(cause instanceof Error ? cause.message : "Unexpected API failure");
    return reply
      .code(500)
      .send({ message: "Local service unavailable. Inspect the API diagnostics." });
  });
  app.get("/api/session", async (request) => ({
    actor: await sessionActor(db, request),
    personas: await listPersonas(db),
    demoNow: config.demoNow,
  }));
  app.post("/api/session", async (request, reply) => {
    const input = sessionInput(request.body);
    if (input instanceof type.errors) throw new HttpError(400, input.summary);
    const { actor, token } = await createSession(db, input.personaId);
    reply.setCookie("returns_session", token, {
      path: "/api",
      httpOnly: true,
      sameSite: "strict",
      maxAge: 86400,
    });
    return { actor, personas: await listPersonas(db), demoNow: config.demoNow };
  });
  app.get("/api/orders", async (request) =>
    listOrders(db, requireActor(await sessionActor(db, request), "customer"), config.demoNow),
  );
  app.get("/api/returns", async (request) =>
    listReturns(db, requireActor(await sessionActor(db, request))),
  );
  app.get<{ Params: { id: string } }>("/api/returns/:id", async (request) =>
    returnDetail(db, requireActor(await sessionActor(db, request)), request.params.id),
  );
  app.post("/api/returns", async (request, reply) => {
    const actor = requireActor(await sessionActor(db, request), "customer");
    const input = requestInput(request.body);
    if (input instanceof type.errors) throw new HttpError(400, input.summary);
    const result = await requestReturn(db, actor, input, config.demoNow);
    return reply.code(201).send(result);
  });
  app.post<{ Params: { id: string } }>("/api/returns/:id/actions", async (request) => {
    const actor = requireActor(await sessionActor(db, request));
    const input = actionInput(request.body);
    if (input instanceof type.errors) throw new HttpError(400, input.summary);
    return decideReturn(db, actor, request.params.id, input, config.demoNow);
  });
  app.post<{ Params: { id: string } }>("/api/returns/:id/refund", async (request, reply) => {
    const actor = requireActor(await sessionActor(db, request), "finance");
    const input = refundInput(request.body);
    if (input instanceof type.errors) throw new HttpError(400, input.summary);
    await requestRefund(db, actor, request.params.id, input, config.demoNow);
    return reply.code(202).send(await returnDetail(db, actor, request.params.id));
  });
  for (const path of ["check", "retry"] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/returns/:id/refund/${path}`,
      async (request, reply) => {
        const actor = requireActor(await sessionActor(db, request), "finance");
        const input = recoveryInput(request.body);
        if (input instanceof type.errors) throw new HttpError(400, input.summary);
        if (path === "check")
          await checkRefund(db, actor, request.params.id, input, provider, config.demoNow);
        else await retryRefund(db, actor, request.params.id, input, config.demoNow);
        return reply.code(202).send(await returnDetail(db, actor, request.params.id));
      },
    );
  }
  await app.register(async (events) => {
    events.removeContentTypeParser("application/json");
    events.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) =>
      done(null, body),
    );
    events.post("/api/provider-events", async (request) => {
      if (!Buffer.isBuffer(request.body)) throw new HttpError(400, "Raw payment event required");
      const event = verifyProviderEvent(
        request.body,
        request.headers["x-simulator-timestamp"],
        request.headers["x-simulator-signature"],
        signingSecret,
      );
      return acceptProviderEvent(db, event, request.body, provider, config.demoNow);
    });
  });
  app.get("/api/health", async () => {
    const [identity] = await db
      .select()
      .from(environmentIdentity)
      .where(eq(environmentIdentity.id, "returns-demo"));
    if (identity?.runId !== config.runId) throw new Error("Database environment identity mismatch");
    return {
      service: "returns-api",
      runId: config.runId,
      database: "ready",
      demoNow: config.demoNow,
    };
  });
  return app;
}
