import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

export function connectDatabase(url: string) {
  const pool = new Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", (error) => console.error(`Idle database connection: ${error.message}`));
  return { pool, db: drizzle(pool, { schema, casing: "snake_case" }) };
}

export type Database = ReturnType<typeof connectDatabase>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
