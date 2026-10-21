import { type } from "arktype";
import { DEMO_NOW } from "../../../packages/contracts/src/index.ts";

const configuration = type({
  databaseUrl: "string.url",
  port: "0 <= number.integer <= 65535",
  webOrigin: "string.url",
  runId: "string > 0",
  demoNow: "string.date.iso",
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = configuration({
    databaseUrl: env.DATABASE_URL,
    port: Number(env.API_PORT ?? 4321),
    webOrigin: env.WEB_ORIGIN ?? "http://127.0.0.1:4320",
    runId: env.RETURNS_RUN_ID ?? "returns-dev",
    demoNow: env.DEMO_NOW ?? DEMO_NOW,
  });
  if (result instanceof type.errors) throw new Error(`Invalid configuration: ${result.summary}`);
  const address = new URL(result.databaseUrl);
  if (!["postgres:", "postgresql:"].includes(address.protocol))
    throw new Error("PostgreSQL URL required");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname))
    throw new Error("The local demo requires a loopback PostgreSQL host");
  if (!Number.isFinite(Date.parse(result.demoNow))) throw new Error("Invalid demo clock");
  return result;
}
