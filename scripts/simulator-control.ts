import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import {
  controlInput,
  simulatorDiagnostics,
  simulatorHealth,
} from "../packages/contracts/src/payment.ts";
import { identity, manifestType, root, runPath } from "./environment.ts";

const runId = `returns-dev-${createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 12)}`;
const directory = runPath(runId);
if (!existsSync(join(directory, "manifest.json")))
  throw new Error("Start this checkout with pnpm dev first");
const manifest = manifestType.assert(
  JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
);
const owner = await identity(manifest.owner.pid);
if (
  manifest.id !== runId ||
  manifest.state !== "running" ||
  owner?.birth !== manifest.owner.birth ||
  owner.commandHash !== manifest.owner.commandHash
)
  throw new Error("The recorded development environment is not active");
const credentials = type({ url: "string.url", adminToken: "string >= 32" }).assert(
  JSON.parse(await readFile(join(directory, "simulator.json"), "utf8")),
);
if (credentials.url !== `http://127.0.0.1:${manifest.simulatorPort}`)
  throw new Error("Simulator endpoint mismatch");
const health = simulatorHealth.assert(
  await (await fetch(`${credentials.url}/health`, { signal: AbortSignal.timeout(2000) })).json(),
);
if (health.runId !== runId) throw new Error("Simulator identity mismatch");
const action = process.argv[2];
const body =
  action === "control"
    ? controlInput.assert({
        merchantId: process.argv[5] ?? "northline",
        paymentRef: process.argv[3],
        mode: process.argv[4],
        responseDelayMs: 1000,
        eventDelayMs: 0,
        eventCopies: 1,
      })
    : undefined;
if (action !== "inspect" && action !== "control")
  throw new Error("Use simulator:inspect or simulator:control <payment-ref> <mode> [merchant]");
const response = await fetch(`${credentials.url}/control/${body ? "payments" : "diagnostics"}`, {
  method: body ? "POST" : "GET",
  headers: {
    authorization: `Bearer ${credentials.adminToken}`,
    "content-type": "application/json",
  },
  body: body ? JSON.stringify(body) : undefined,
  signal: AbortSignal.timeout(2000),
});
if (!response.ok) throw new Error(`Simulator command failed (${response.status})`);
console.log(
  body
    ? `Configured ${body.paymentRef}: ${body.mode}`
    : JSON.stringify(simulatorDiagnostics.assert(await response.json()), null, 2),
);
