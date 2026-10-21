import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./apps/simulator/src/schema.ts",
  out: "./apps/simulator/db",
  casing: "snake_case",
});
