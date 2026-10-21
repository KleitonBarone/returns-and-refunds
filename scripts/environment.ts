import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, unwatchFile, watchFile } from "node:fs";
import { mkdir, readdir, readFile, realpath, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { type } from "arktype";
import { connectDatabase } from "../apps/server/src/db.ts";
import { workerHeartbeat } from "../apps/server/src/schema.ts";
import { prepareSimulatorDatabase } from "../apps/simulator/src/database.ts";
import { healthResponse } from "../packages/contracts/src/index.ts";
import { simulatorHealth } from "../packages/contracts/src/payment.ts";
import { browserProcessRecord } from "./browser-contracts.ts";
import { prepareDatabase } from "./database.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const workspace = createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 12);
const runsRoot = join(root, ".local", "runs");
const windows = process.platform === "win32";
const processIdentity = type({ pid: "number.integer > 0", birth: "string", commandHash: "string" });
const manifestType = type({
  id: "string",
  workspace: "string",
  mode: "'dev' | 'integration' | 'verify' | 'e2e'",
  createdAt: "string",
  source: "string",
  owner: processIdentity,
  children: processIdentity.array(),
  dbPort: "number",
  apiPort: "number",
  webPort: "number",
  "simulatorPort?": "number",
  "simulatorDbPort?": "number",
  "simulatorPid?": "number.integer > 0",
  "workerPid?": "number.integer > 0",
  "apiPid?": "number.integer > 0",
  state: "'starting' | 'running' | 'cleaning' | 'failed'",
  dockerEndpoint: "string",
  subnet: "string",
  "keepalivePid?": "number.integer > 0",
});
type Manifest = typeof manifestType.infer;

function command(binary: string, args: string[], options: { input?: string } = {}) {
  return execFileSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    input: options.input,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
function docker(args: string[], options: { input?: string } = {}) {
  return windows
    ? command(
        "wsl",
        [
          "-d",
          "Ubuntu",
          "--cd",
          root
            .replace(/^([A-Za-z]):/, (_, drive: string) => `/mnt/${drive.toLowerCase()}`)
            .replaceAll("\\", "/"),
          "--exec",
          "docker",
          "--context",
          "default",
          ...args,
        ],
        options,
      )
    : command("docker", ["--context", "default", ...args], options);
}
async function identity(pid: number) {
  try {
    if (windows) {
      const raw = command("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { @{ birth=$p.CreationDate.ToUniversalTime().ToString('o'); cmd=$p.CommandLine } | ConvertTo-Json -Compress }`,
      ]);
      if (!raw) return undefined;
      const record = type({ birth: "string", cmd: "string" }).assert(JSON.parse(raw));
      return {
        pid,
        birth: record.birth,
        commandHash: createHash("sha256").update(record.cmd).digest("hex"),
      };
    }
    const [info, cmd] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf8"),
      readFile(`/proc/${pid}/cmdline`, "utf8"),
    ]);
    const fields = info.slice(info.lastIndexOf(")") + 2).split(" ");
    // Exited processes can retain their PID with an empty command line until reaped.
    if (fields[0] === "Z" || fields[0] === "X") return undefined;
    return {
      pid,
      birth: fields[19] ?? "",
      commandHash: createHash("sha256").update(cmd).digest("hex"),
    };
  } catch (error) {
    try {
      process.kill(pid, 0);
    } catch (probe) {
      if (probe instanceof Error && "code" in probe && probe.code === "ESRCH") return undefined;
      throw new Error(`Cannot establish ownership of process ${pid}`);
    }
    throw new Error(`Cannot establish ownership of live process ${pid}`, { cause: error });
  }
}
async function matches(expected: typeof processIdentity.infer) {
  const current = await identity(expected.pid);
  return current?.birth === expected.birth && current.commandHash === expected.commandHash;
}
// Browser profiles and crash data live below a unique run directory, including after parent death.
async function ownedBrowserProcesses(directory: string) {
  const marker = resolve(directory);
  if (relative(join(root, ".local", "runs"), marker).startsWith(".."))
    throw new Error("Browser marker leaves run storage");
  const pids = windows
    ? command("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe', 'chrome_crashpad_handler.exe') -and $_.CommandLine -and $_.CommandLine.IndexOf('${marker.replaceAll("'", "''")}', [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -ExpandProperty ProcessId`,
      ])
        .split(/\s+/)
        .filter(Boolean)
        .map(Number)
    : (await readdir("/proc")).filter((name) => /^\d+$/.test(name)).map(Number);
  const owned: Array<typeof processIdentity.infer> = [];
  for (const pid of pids) {
    if (!windows) {
      try {
        if (!(await readFile(`/proc/${pid}/cmdline`, "utf8")).includes(marker)) continue;
      } catch {
        continue;
      }
    }
    const record = await identity(pid);
    if (record) owned.push(record);
  }
  return owned;
}
function runPath(id: string) {
  if (!/^(codex-returns-test-[a-z0-9-]+|returns-dev-[a-f0-9]+)$/.test(id))
    throw new Error("Invalid run identity");
  return join(runsRoot, id);
}
async function save(manifest: Manifest) {
  await writeFile(
    join(runPath(manifest.id), "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
function compose(manifest: Manifest, args: string[]) {
  return docker([
    "compose",
    "-p",
    manifest.id,
    "--env-file",
    `.local/runs/${manifest.id}/compose.env`,
    "-f",
    `.local/runs/${manifest.id}/compose.yaml`,
    ...args,
  ]);
}
async function freePort(preferred = 0) {
  return new Promise<number>((accept, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(preferred, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") {
        socket.close();
        reject(new Error("Cannot assign a port"));
        return;
      }
      socket.close(() => accept(address.port));
    });
  });
}
async function waitFor(url: string, valid: (body: unknown) => boolean, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok && valid(await response.json())) return;
    } catch {
      /* Dependency not ready yet. */
    }
    await delay(100);
  }
  throw new Error(`Readiness timed out: ${url}`);
}
async function safeRemove(directory: string) {
  const absolute = await realpath(directory);
  const allowed = await realpath(join(root, ".local"));
  if (relative(await realpath(root), allowed).startsWith(".."))
    throw new Error("Run storage leaves the workspace");
  const within = relative(allowed, absolute);
  if (!within || within.startsWith("..") || isAbsolute(within))
    throw new Error("Refusing removal outside project-local storage");
  await rm(absolute, { recursive: true, force: false });
}
function ownedResources(manifest: Manifest, kind: "ps" | "volume" | "network") {
  const args = kind === "ps" ? ["ps", "-aq"] : [kind, "ls", "-q"];
  return docker([...args, "--filter", `label=com.docker.compose.project=${manifest.id}`])
    .split(/\s+/)
    .filter(Boolean);
}
function chooseSubnet() {
  const networkIds = docker(["network", "ls", "-q"]).split(/\s+/).filter(Boolean);
  const networks = networkIds.length ? docker(["network", "inspect", ...networkIds]) : "";
  const linuxRoutes = windows
    ? command("wsl", ["-d", "Ubuntu", "--exec", "ip", "-4", "route"])
    : command("ip", ["-4", "route"]);
  const hostRoutes = windows
    ? command("powershell.exe", [
        "-NoProfile",
        "-Command",
        "(Get-NetRoute -AddressFamily IPv4).DestinationPrefix",
      ])
    : "";
  const taken = [
    ...`${networks}\n${linuxRoutes}\n${hostRoutes}`.matchAll(/\b(\d+\.\d+\.\d+\.\d+\/\d+)\b/g),
  ]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined && !/\/(?:0|1)$/.test(value));
  function range(cidr: string) {
    const [address = "", bits = "32"] = cidr.split("/");
    const value = address.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
    const size = 2 ** (32 - Number(bits));
    const lower = Math.floor(value / size) * size;
    return { lower, upper: lower + size - 1 };
  }
  const occupied = taken.map(range);
  const offset = Number.parseInt(randomUUID().slice(0, 8), 16) % 2048;
  for (let index = 0; index < 2048; index++) {
    const slot = (offset + index) % 2048;
    const second = 232 + Math.floor(slot / 256);
    const third = slot % 256;
    const candidate = `10.${second}.${third}.0/24`;
    const check = range(candidate);
    if (occupied.every((other) => check.upper < other.lower || check.lower > other.upper))
      return candidate;
  }
  throw new Error("No verified free project subnet; configure networking explicitly");
}
async function cleanup(manifest: Manifest, active = false) {
  const outcome = manifest.state === "failed" ? "failed; cleanup verified" : "cleanup verified";
  if (
    manifest.workspace !== workspace ||
    manifest.dockerEndpoint !==
      docker(["context", "inspect", "default", "--format", "{{.Endpoints.docker.Host}}"])
  )
    throw new Error("Cleanup endpoint/workspace mismatch");
  if (!active && (await matches(manifest.owner)))
    throw new Error("Refusing cleanup of an active run");
  manifest.state = "cleaning";
  await save(manifest);
  async function stopChild(child: typeof processIdentity.infer) {
    if (!(await matches(child))) return;
    if (windows) {
      try {
        command("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"]);
      } catch {
        if (await matches(child)) throw new Error(`Cannot stop owned child ${child.pid}`);
      }
    } else {
      process.kill(child.pid, "SIGTERM");
      for (let i = 0; i < 30 && (await matches(child)); i++) await delay(100);
      if (await matches(child)) process.kill(child.pid, "SIGKILL");
    }
  }
  for (const child of [...manifest.children].reverse()) {
    if (child.pid !== manifest.keepalivePid) await stopChild(child);
  }
  const browserRecordPath = join(runPath(manifest.id), "browser-process.json");
  if (manifest.mode === "e2e") {
    if (existsSync(browserRecordPath)) {
      const browser = browserProcessRecord.assert(
        JSON.parse(await readFile(browserRecordPath, "utf8")),
      );
      if (browser.runId !== manifest.id) throw new Error("Browser ownership mismatch");
      await stopChild(browser.process);
    }
    const remaining = await ownedBrowserProcesses(runPath(manifest.id));
    for (const processRecord of remaining.reverse()) await stopChild(processRecord);
    if ((await ownedBrowserProcesses(runPath(manifest.id))).length)
      throw new Error("Run-owned browser processes remain");
  }
  const containers = ownedResources(manifest, "ps");
  for (const container of containers) {
    const label = docker([
      "inspect",
      container,
      "--format",
      '{{index .Config.Labels "io.returns.workspace"}}',
    ]);
    if (label !== workspace) throw new Error("Container ownership mismatch");
  }
  const volumes = ownedResources(manifest, "volume");
  for (const volume of volumes) {
    if (
      docker([
        "volume",
        "inspect",
        volume,
        "--format",
        '{{index .Labels "io.returns.workspace"}}',
      ]) !== workspace
    )
      throw new Error("Volume ownership mismatch");
  }
  for (const network of ownedResources(manifest, "network")) {
    if (
      docker([
        "network",
        "inspect",
        network,
        "--format",
        '{{index .Labels "io.returns.workspace"}}',
      ]) !== workspace
    )
      throw new Error("Network ownership mismatch");
  }
  compose(manifest, [
    "down",
    ...(manifest.mode === "dev" ? [] : ["--volumes"]),
    "--remove-orphans",
    "--timeout",
    "5",
  ]);
  if (
    ownedResources(manifest, "ps").length ||
    ownedResources(manifest, "network").length ||
    (manifest.mode !== "dev" && ownedResources(manifest, "volume").length)
  )
    throw new Error("Run-owned Docker resources remain");
  const keepalive = manifest.children.find((child) => child.pid === manifest.keepalivePid);
  if (keepalive) await stopChild(keepalive);
  for (const child of manifest.children)
    if (await matches(child)) throw new Error(`Owned process ${child.pid} remains`);
  for (const port of [
    manifest.apiPort,
    manifest.webPort,
    manifest.dbPort,
    manifest.simulatorPort,
    manifest.simulatorDbPort,
  ])
    if (port !== undefined) await freePort(port);
  await writeFile(
    join(root, ".local", "last-result.json"),
    `${JSON.stringify({ runId: manifest.id, source: manifest.source, cleanedAt: new Date().toISOString(), retained: manifest.mode === "dev" ? volumes : [], result: outcome }, null, 2)}\n`,
  );
  await safeRemove(runPath(manifest.id));
  console.log(
    `Cleaned ${manifest.id}; ${manifest.mode === "dev" ? "demo volumes preserved" : "no disposable resources retained"}.`,
  );
}
async function launch(
  manifest: Manifest,
  args: string[],
  env: NodeJS.ProcessEnv,
  binary = process.execPath,
) {
  const output = await import("node:fs");
  const logPath = join(runPath(manifest.id), `process-${manifest.children.length}.log`);
  const descriptor = output.openSync(logPath, "w");
  let position = 0;
  function log(chunk: Buffer) {
    if (position + chunk.length > 5 * 1024 * 1024) {
      output.ftruncateSync(descriptor, 0);
      position = 0;
    }
    position += output.writeSync(descriptor, chunk, 0, chunk.length, position);
  }
  const child = spawn(binary, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", log);
  child.stderr.on("data", log);
  child.once("close", () => output.closeSync(descriptor));
  if (!child.pid) throw new Error("Unable to launch process");
  const processRecord = await identity(child.pid);
  if (!processRecord) throw new Error("Child exited before identity capture");
  manifest.children.push(processRecord);
  await save(manifest);
  return child;
}
async function foreground(manifest: Manifest, args: string[], env: NodeJS.ProcessEnv) {
  const child = await launch(manifest, args, env);
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise<void>((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`Check exited with code ${code}`)),
    );
  });
}
export async function launchApi(manifest: Manifest, env: NodeJS.ProcessEnv) {
  const child = await launch(
    manifest,
    ["--import", "tsx", "apps/server/src/api.ts"],
    applicationEnvironment(env),
  );
  manifest.apiPid = child.pid;
  await save(manifest);
  await waitFor(
    `http://127.0.0.1:${manifest.apiPort}/api/health`,
    (body) => healthResponse.allows(body) && body.runId === manifest.id,
  );
  return child;
}
export async function restartApi(manifest: Manifest, env: NodeJS.ProcessEnv) {
  await stopApi(manifest);
  await launchApi(manifest, env);
}
export async function stopApi(manifest: Manifest) {
  const previous = manifest.children.find((child) => child.pid === manifest.apiPid);
  if (!previous) throw new Error("API process not recorded");
  const current = await identity(previous.pid);
  if (!current) return;
  if (!(await matches(previous))) throw new Error("API process ownership mismatch");
  process.kill(previous.pid, "SIGTERM");
  const deadline = Date.now() + 10000;
  while (await matches(previous)) {
    if (Date.now() >= deadline) throw new Error("API did not stop for restart");
    await delay(100);
  }
}
export async function restartSimulator(manifest: Manifest, env: NodeJS.ProcessEnv) {
  const previous = manifest.children.find((child) => child.pid === manifest.simulatorPid);
  if (!previous || !(await matches(previous)))
    throw new Error("Simulator process ownership mismatch");
  process.kill(previous.pid, "SIGTERM");
  const deadline = Date.now() + 10000;
  while (await matches(previous)) {
    if (Date.now() >= deadline) throw new Error("Simulator did not stop for restart");
    await delay(100);
  }
  const child = await launch(
    manifest,
    ["--import", "tsx", "apps/simulator/src/api.ts"],
    simulatorEnvironment(env),
  );
  manifest.simulatorPid = child.pid;
  await save(manifest);
  await waitFor(
    `${env.SIMULATOR_URL}/health`,
    (body) => simulatorHealth.allows(body) && body.runId === manifest.id,
  );
}
export async function waitForRefundWorker(manifest: Manifest, env: NodeJS.ProcessEnv) {
  const { db, pool } = connectDatabase(String(env.DATABASE_URL));
  const deadline = Date.now() + 30000;
  try {
    while (Date.now() < deadline) {
      const records = await db.select().from(workerHeartbeat);
      if (
        records.some(
          (record) =>
            record.runId === manifest.id &&
            record.pid === manifest.workerPid &&
            Date.now() - Date.parse(record.lastSeenAt) < 10000,
        )
      )
        return;
      await delay(100);
    }
    throw new Error("Refund worker readiness timed out");
  } finally {
    await pool.end();
  }
}
export async function restartRefundWorker(manifest: Manifest, env: NodeJS.ProcessEnv) {
  const previous = manifest.children.find((child) => child.pid === manifest.workerPid);
  if (!previous) throw new Error("Refund worker is not recorded");
  const current = await identity(previous.pid);
  if (current) {
    if (current.birth !== previous.birth || current.commandHash !== previous.commandHash)
      throw new Error("Refund worker ownership mismatch");
    process.kill(previous.pid, "SIGTERM");
    const deadline = Date.now() + 10000;
    while (await matches(previous)) {
      if (Date.now() >= deadline) throw new Error("Refund worker did not stop");
      await delay(100);
    }
  }
  const worker = await launch(
    manifest,
    ["--import", "tsx", "apps/server/src/worker.ts"],
    applicationEnvironment(env),
  );
  manifest.workerPid = worker.pid;
  await save(manifest);
  await waitForRefundWorker(manifest, env);
}
export async function crashRefundWorker(manifest: Manifest) {
  if (manifest.mode === "dev" || !manifest.id.startsWith("codex-returns-test-"))
    throw new Error("Crash fixture requires a disposable test run");
  const worker = manifest.children.find((child) => child.pid === manifest.workerPid);
  if (!worker || !(await matches(worker))) throw new Error("Refund worker ownership mismatch");
  process.kill(worker.pid, "SIGKILL");
  const deadline = Date.now() + 5000;
  while (await matches(worker)) {
    if (Date.now() >= deadline) throw new Error("Crash fixture did not stop");
    await delay(100);
  }
}
async function preflight() {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Use Node 24.20.0 or newer in the 24.x line");
  const endpoint = docker([
    "context",
    "inspect",
    "default",
    "--format",
    "{{.Endpoints.docker.Host}}",
  ]);
  if (windows && endpoint !== "unix:///var/run/docker.sock")
    throw new Error("Unexpected WSL Docker endpoint");
  const version = docker(["version", "--format", "{{.Server.Version}}"]);
  const composeVersion = docker(["compose", "version", "--short"]);
  const disk = await statfs(root);
  if (disk.bavail * disk.bsize < 2 * 1024 ** 3)
    throw new Error("At least 2 GiB free space required");
  console.log(
    `Node ${process.versions.node}; Docker ${version}; Compose ${composeVersion}; endpoint ${endpoint}`,
  );
  const stale = existsSync(runsRoot) ? await readdir(runsRoot) : [];
  if (stale.length)
    console.log(`Recorded environments: ${stale.join(", ")}. Use env:clean <id> to inspect.`);
  return endpoint;
}
// The API and worker receive the HTTP credential, never provider SQL or control access.
export function applicationEnvironment(env: NodeJS.ProcessEnv) {
  const scoped = { ...env };
  delete scoped.SIMULATOR_DATABASE_URL;
  delete scoped.SIMULATOR_ADMIN_TOKEN;
  return scoped;
}
export function simulatorEnvironment(env: NodeJS.ProcessEnv) {
  const scoped = { ...env };
  delete scoped.DATABASE_URL;
  return scoped;
}
export async function runEnvironment(
  mode: Manifest["mode"],
  job?: (env: NodeJS.ProcessEnv, manifest: Manifest) => Promise<void>,
) {
  const endpoint = await preflight();
  await mkdir(runsRoot, { recursive: true });
  const id = mode === "dev" ? `returns-dev-${workspace}` : `codex-returns-test-${randomUUID()}`;
  const directory = runPath(id);
  try {
    await stat(directory);
    throw new Error(`Environment already recorded: ${id}`);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const owner = await identity(process.pid);
  if (!owner) throw new Error("Unable to verify supervisor identity");
  const assigned = new Set<number>();
  async function assign(preferred: number) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = await freePort(preferred);
      if (!assigned.has(port)) {
        assigned.add(port);
        return port;
      }
      if (preferred) break;
    }
    throw new Error("Configured service ports must be distinct");
  }
  const dbPort = await assign(mode === "dev" ? Number(process.env.DB_PORT ?? 55432) : 0);
  const apiPort = await assign(mode === "dev" ? Number(process.env.API_PORT ?? 4321) : 0);
  const webPort = await assign(mode === "dev" ? Number(process.env.WEB_PORT ?? 4320) : 0);
  const simulatorPort = await assign(
    mode === "dev" ? Number(process.env.SIMULATOR_PORT ?? 4322) : 0,
  );
  const simulatorDbPort = await assign(
    mode === "dev" ? Number(process.env.SIMULATOR_DB_PORT ?? 55433) : 0,
  );
  const subnet = chooseSubnet();
  await mkdir(directory);
  const manifest: Manifest = {
    id,
    workspace,
    mode,
    createdAt: new Date().toISOString(),
    source: command("git", ["rev-parse", "HEAD"]),
    owner,
    children: [],
    dbPort,
    apiPort,
    webPort,
    simulatorPort,
    simulatorDbPort,
    state: "starting",
    dockerEndpoint: endpoint,
    subnet,
  };
  const password = mode === "dev" ? "fictional-local-demo-only" : randomUUID();
  const simulatorPassword = mode === "dev" ? "fictional-simulator-demo-only" : randomUUID();
  const localCredential = (purpose: string) =>
    mode === "dev"
      ? createHash("sha256").update(`local-demo-only:${workspace}:${purpose}`).digest("hex")
      : randomUUID();
  const env = {
    ...process.env,
    RETURNS_RUN_ID: id,
    DATABASE_URL: `postgres://returns_admin:${password}@127.0.0.1:${dbPort}/returns_app`,
    API_PORT: String(apiPort),
    WEB_PORT: String(webPort),
    WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
    SIMULATOR_DATABASE_URL: `postgres://simulator_admin:${simulatorPassword}@127.0.0.1:${simulatorDbPort}/payment_simulator`,
    SIMULATOR_PORT: String(simulatorPort),
    SIMULATOR_URL: `http://127.0.0.1:${simulatorPort}`,
    SIMULATOR_API_TOKEN: localCredential("provider-http"),
    SIMULATOR_ADMIN_TOKEN: localCredential("provider-controls"),
    SIMULATOR_SIGNING_SECRET: localCredential("event-signing"),
    SIMULATOR_DELIVERY_AUTOSTART: mode === "dev" ? "1" : "0",
    PAYMENT_WEBHOOK_URL: `http://127.0.0.1:${apiPort}/api/provider-events`,
  };
  await writeFile(join(directory, "compose.yaml"), await readFile(join(root, "compose.yaml")));
  await writeFile(
    join(directory, "compose.env"),
    `RETURNS_RUN_ID=${id}\nRETURNS_WORKSPACE=${workspace}\nRETURNS_DB_PORT=${dbPort}\nRETURNS_DB_PASSWORD=${password}\nRETURNS_SUBNET=${subnet}\nSIMULATOR_DB_PORT=${simulatorDbPort}\nSIMULATOR_DB_PASSWORD=${simulatorPassword}\n`,
  );
  await writeFile(
    join(directory, "simulator.json"),
    JSON.stringify({ url: env.SIMULATOR_URL, adminToken: env.SIMULATOR_ADMIN_TOKEN }),
    { mode: 0o600 },
  );
  await save(manifest);
  let cleaning: Promise<void> | undefined;
  const finish = () => (cleaning ??= cleanup(manifest, true));
  const stopPath = join(directory, "stop-request");
  let requestStop = () => {};
  const stopped = new Promise<void>((accept) => {
    requestStop = accept;
  });
  watchFile(stopPath, { interval: 200 }, (info) => {
    if (info.nlink > 0) requestStop();
  });
  const interrupted = () => {
    void finish().then(
      () => process.exit(130),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    const lease = windows
      ? await launch(manifest, ["-d", "Ubuntu", "--exec", "sleep", "infinity"], env, "wsl.exe")
      : undefined;
    if (lease) {
      manifest.keepalivePid = lease.pid;
      await save(manifest);
    }
    await writeFile(
      join(directory, "baseline.json"),
      JSON.stringify({
        containers: docker(["ps", "-aq"]),
        volumes: docker(["volume", "ls", "-q"]),
        images: docker(["image", "ls", "-q"]),
      }),
    );
    console.log(`Starting ${id}`);
    for (let attempt = 0; ; attempt++) {
      try {
        compose(manifest, ["up", "-d", "--wait", "--wait-timeout", "60"]);
        break;
      } catch (error) {
        if (
          attempt >= 2 ||
          !(error instanceof Error) ||
          !/overlap|already allocated/i.test(error.message)
        )
          throw error;
        manifest.subnet = chooseSubnet();
        const values = await readFile(join(directory, "compose.env"), "utf8");
        await writeFile(
          join(directory, "compose.env"),
          values.replace(/RETURNS_SUBNET=.*/, `RETURNS_SUBNET=${manifest.subnet}`),
        );
        await save(manifest);
      }
    }
    await prepareDatabase(env.DATABASE_URL, id, mode !== "dev");
    await prepareSimulatorDatabase(env.SIMULATOR_DATABASE_URL, id, mode !== "dev");
    const simulator = await launch(
      manifest,
      ["--import", "tsx", "apps/simulator/src/api.ts"],
      simulatorEnvironment(env),
    );
    manifest.simulatorPid = simulator.pid;
    await save(manifest);
    await waitFor(
      `${env.SIMULATOR_URL}/health`,
      (body) => simulatorHealth.allows(body) && body.runId === id,
    );
    const worker =
      mode !== "integration"
        ? await launch(
            manifest,
            ["--import", "tsx", "apps/server/src/worker.ts"],
            applicationEnvironment(env),
          )
        : undefined;
    if (worker) {
      manifest.workerPid = worker.pid;
      await save(manifest);
      await waitForRefundWorker(manifest, env);
    }
    if (process.env.RETURNS_INJECT_STARTUP_FAILURE === "1")
      throw new Error("Injected startup failure");
    manifest.state = "running";
    await save(manifest);
    if (process.env.RETURNS_VERIFY_HOLD === "1") await stopped;
    else if (job) await job(env, manifest);
    else if (mode === "integration" || mode === "verify")
      await foreground(
        manifest,
        ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.integration.config.ts"],
        env,
      );
    else {
      const api = await launchApi(manifest, env);
      const web = await launch(
        manifest,
        ["node_modules/vite/bin/vite.js", "--config", "apps/web/vite.config.ts"],
        applicationEnvironment(env),
      );
      console.log(
        `Web http://127.0.0.1:${webPort}; API http://127.0.0.1:${apiPort}; simulator ${env.SIMULATOR_URL}; ${id}`,
      );
      await Promise.race([
        stopped,
        new Promise<void>((_, reject) => {
          for (const child of [
            api,
            web,
            simulator,
            ...(worker ? [worker] : []),
            ...(lease ? [lease] : []),
          ])
            child.once("exit", (code) => reject(new Error(`Service exited (${code})`)));
        }),
      ]);
    }
  } catch (error) {
    manifest.state = "failed";
    console.error(
      error instanceof Error
        ? error.message
            .replaceAll(password, "[redacted]")
            .replaceAll(simulatorPassword, "[redacted]")
        : "Environment failed",
    );
    const appLogs = await Promise.all(
      (await readdir(directory))
        .filter((name) => name.endsWith(".log"))
        .map(
          async (name) =>
            `${name}\n${(await readFile(join(directory, name), "utf8")).slice(-128 * 1024)}`,
        ),
    );
    let databaseLogs = "";
    try {
      databaseLogs = compose(manifest, ["logs", "--tail", "150"]);
    } catch {
      databaseLogs = "Compose diagnostics unavailable";
    }
    const logs =
      `${error instanceof Error ? error.message : "Environment failed"}\n${appLogs.join("\n")}\n${databaseLogs}`
        .replaceAll(password, "[redacted]")
        .replaceAll(simulatorPassword, "[redacted]")
        .replaceAll(env.SIMULATOR_API_TOKEN, "[redacted]")
        .replaceAll(env.SIMULATOR_ADMIN_TOKEN, "[redacted]")
        .replaceAll(env.SIMULATOR_SIGNING_SECRET, "[redacted]");
    await writeFile(join(root, ".local", "last-failure.log"), logs.slice(-1024 * 1024));
    throw new Error(`Environment ${id} failed; see .local/last-failure.log`);
  } finally {
    unwatchFile(stopPath);
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
    await finish();
  }
}

async function main() {
  const action = process.argv[2] ?? "doctor";
  if (action === "doctor") {
    await preflight();
    for (const port of [4320, 4321, 4322, 55432, 55433]) await freePort(port);
    return;
  }
  if (action === "integration" || action === "verify" || action === "dev") {
    await runEnvironment(action);
    return;
  }
  if (action !== "stop" && action !== "clean") throw new Error("Unknown environment command");
  if (action === "clean" && process.argv.includes("--all")) {
    if (!existsSync(runsRoot)) return;
    for (const candidate of await readdir(runsRoot)) {
      const record = manifestType.assert(
        JSON.parse(await readFile(join(runPath(candidate), "manifest.json"), "utf8")),
      );
      if (record.id !== candidate || record.workspace !== workspace)
        throw new Error("Manifest identity mismatch");
      if (process.argv.includes("--apply")) await cleanup(record);
      else console.log(`Recorded run ${record.id}, mode ${record.mode}; add --apply to clean`);
    }
    return;
  }
  const id = action === "stop" ? `returns-dev-${workspace}` : process.argv[3];
  if (!id) throw new Error("Use env:clean <run-id> [--apply]");
  if (!existsSync(join(runPath(id), "manifest.json"))) {
    console.log(`No recorded environment: ${id}`);
    return;
  }
  const manifest = manifestType.assert(
    JSON.parse(await readFile(join(runPath(id), "manifest.json"), "utf8")),
  );
  if (manifest.id !== id || manifest.workspace !== workspace)
    throw new Error("Manifest identity mismatch");
  if (action === "stop" && (await matches(manifest.owner))) {
    await writeFile(join(runPath(id), "stop-request"), "stop\n");
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        await stat(join(runPath(id), "manifest.json"));
      } catch {
        console.log("Development shutdown verified");
        return;
      }
      await delay(250);
    }
    throw new Error("Supervisor has not finished shutdown; inspect its manifest before retrying");
  }
  console.log(
    JSON.stringify(
      {
        id,
        mode: manifest.mode,
        children: manifest.children.map((c) => c.pid),
        containers: ownedResources(manifest, "ps"),
        volumes: ownedResources(manifest, "volume"),
        preserveDemoData: manifest.mode === "dev",
      },
      null,
      2,
    ),
  );
  if (action === "stop" || process.argv.includes("--apply")) await cleanup(manifest);
  else console.log("Preview only; add --apply to clean an inactive verified run.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export type { Manifest };
export {
  cleanup,
  docker,
  foreground,
  identity,
  launch,
  manifestType,
  preflight,
  root,
  runPath,
  safeRemove,
  waitFor,
};
