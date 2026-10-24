import { describe, expect, it } from "vitest";
import {
  developmentPorts,
  doctorPorts,
  workspaceIdentity,
} from "../../scripts/environment-config.ts";

describe("workspace identity", () => {
  it("keeps case-distinct Linux checkouts isolated", () => {
    expect(workspaceIdentity("/tmp/Returns/", "linux")).not.toBe(
      workspaceIdentity("/tmp/returns/", "linux"),
    );
  });

  it("preserves the existing case-insensitive Windows identity", () => {
    expect(workspaceIdentity("C:\\Users\\admin\\repos\\returns-and-refunds\\", "win32")).toBe(
      "bf74efb61236",
    );
    expect(workspaceIdentity("C:\\Repos\\Returns\\", "win32")).toBe(
      workspaceIdentity("c:\\repos\\returns\\", "win32"),
    );
  });
});

describe("environment preflight ports", () => {
  it("checks fixed ports only for development, using its configured values", () => {
    const env = { WEB_PORT: "0", API_PORT: "44321", SIMULATOR_PORT: "44322" };
    expect(doctorPorts([], env)).toEqual([]);
    expect(doctorPorts(["--dev"], env)).toEqual([55432, 44321, 44322, 55433]);
  });

  it("rejects invalid development port configuration", () => {
    for (const value of ["NaN", "-1", "65536", "1.5"])
      expect(() => developmentPorts({ WEB_PORT: value })).toThrow();
  });
});
