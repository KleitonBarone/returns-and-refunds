import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./apps/server/src/schema.ts",
  out: "./apps/server/db",
  casing: "snake_case",
});
