import { createHash } from "node:crypto";
import { type } from "arktype";

export function workspaceIdentity(directory: string, platform = process.platform) {
  const normalized = platform === "win32" ? directory.toLowerCase() : directory;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

const port = type("number.integer >= 0 & number <= 65535");

export function developmentPorts(env: NodeJS.ProcessEnv = process.env) {
  return {
    db: port.assert(Number(env.DB_PORT ?? 55432)),
    api: port.assert(Number(env.API_PORT ?? 4321)),
    web: port.assert(Number(env.WEB_PORT ?? 4320)),
    simulator: port.assert(Number(env.SIMULATOR_PORT ?? 4322)),
    simulatorDb: port.assert(Number(env.SIMULATOR_DB_PORT ?? 55433)),
  };
}

export function doctorPorts(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return args.includes("--dev") ? Object.values(developmentPorts(env)).filter(Boolean) : [];
}
