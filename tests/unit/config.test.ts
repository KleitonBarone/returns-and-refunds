import { describe, expect, it } from "vitest";
import { readConfig } from "../../apps/server/src/config.ts";
import { money } from "../../packages/contracts/src/index.ts";

describe("configuration boundaries", () => {
  it("rejects missing database and invalid ports", () => {
    expect(() => readConfig({})).toThrow("Invalid configuration");
    expect(() =>
      readConfig({ DATABASE_URL: "postgres://localhost/demo", API_PORT: "not-a-port" }),
    ).toThrow();
    expect(() => readConfig({ DATABASE_URL: "https://example.com" })).toThrow("PostgreSQL");
  });
  it("uses the server demo clock and safe minor-unit formatting", () => {
    expect(readConfig({ DATABASE_URL: "postgres://localhost/demo" }).demoNow).toBe(
      "2026-10-01T12:00:00.000Z",
    );
    expect(money(3500)).toBe("$35.00");
    expect(() => money(35.5)).toThrow();
  });
});
