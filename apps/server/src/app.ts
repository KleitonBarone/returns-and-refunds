import { eq } from "drizzle-orm";
import Fastify from "fastify";
import type { readConfig } from "./config.ts";
import type { Database } from "./db.ts";
import { environmentIdentity } from "./schema.ts";

export async function createApp(db: Database, config: ReturnType<typeof readConfig>) {
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  app.setErrorHandler((error, _request, reply) => {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    console.error(cause instanceof Error ? cause.message : "Unexpected API failure");
    return reply
      .code(500)
      .send({ message: "Local service unavailable. Inspect the API diagnostics." });
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
