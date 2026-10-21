import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";
export function connectSimulator(url: string) {
  const pool = new Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", (error) => console.error(`Simulator database: ${error.message}`));
  return { pool, db: drizzle(pool, { schema, casing: "snake_case" }) };
}
export type SimulatorDatabase = ReturnType<typeof connectSimulator>["db"];
export type SimulatorTransaction = Parameters<Parameters<SimulatorDatabase["transaction"]>[0]>[0];
