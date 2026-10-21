import { type } from "arktype";
import { DEMO_NOW } from "../../../packages/contracts/src/index.ts";

const configuration = type({
  databaseUrl: "string.url",
  port: "0 <= number.integer <= 65535",
  runId: "string > 0",
  apiToken: "string >= 32",
  adminToken: "string >= 32",
  signingSecret: "string >= 32",
  webhookUrl: "string.url",
  demoNow: "string.date.iso",
});
export function readSimulatorConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = configuration.assert({
    databaseUrl: env.SIMULATOR_DATABASE_URL,
    port: Number(env.SIMULATOR_PORT ?? 4322),
    runId: env.RETURNS_RUN_ID,
    apiToken: env.SIMULATOR_API_TOKEN,
    adminToken: env.SIMULATOR_ADMIN_TOKEN,
    signingSecret: env.SIMULATOR_SIGNING_SECRET,
    webhookUrl: env.PAYMENT_WEBHOOK_URL,
    demoNow: env.DEMO_NOW ?? DEMO_NOW,
  });
  for (const [value, protocols] of [
    [config.databaseUrl, ["postgres:", "postgresql:"]],
    [config.webhookUrl, ["http:"]],
  ] as const) {
    const address = new URL(value);
    if (
      !protocols.some((protocol) => protocol === address.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname)
    )
      throw new Error("Simulator requires loopback PostgreSQL and HTTP endpoints");
  }
  if (config.apiToken === config.adminToken)
    throw new Error("Simulator controls require a separate credential");
  return config;
}
