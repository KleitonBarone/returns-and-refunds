import { type } from "arktype";

export const healthResponse = type({
  service: "'returns-api'",
  runId: "string",
  database: "'ready'",
  demoNow: "string",
});

export const DEMO_NOW = "2026-10-01T12:00:00.000Z";

export function money(minor: number, currency = "USD") {
  if (!Number.isSafeInteger(minor)) throw new Error("Money must be an integer in minor units");
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}
