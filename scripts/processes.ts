import { type ChildProcess, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type } from "arktype";

export const processIdentity = type({
  pid: "number.integer > 0",
  birth: "string",
  commandHash: "string",
});

export async function identity(pid: number) {
  try {
    if (process.platform === "win32") {
      const raw = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { @{ birth=$p.CreationDate.ToUniversalTime().ToString('o'); cmd=$p.CommandLine } | ConvertTo-Json -Compress }`,
        ],
        { encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
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

export async function matches(expected: typeof processIdentity.infer) {
  const current = await identity(expected.pid);
  return current?.birth === expected.birth && current.commandHash === expected.commandHash;
}

// Intentional restarts remove only the old process's listener; replacements are watched anew.
export function superviseServices(onFailure: (error: Error) => void) {
  const watched = new Map<number, () => void>();
  function expectExit(pid: number) {
    watched.get(pid)?.();
    watched.delete(pid);
  }
  return {
    watch(child: ChildProcess, name: string) {
      if (!child.pid) throw new Error(`Unable to launch ${name}`);
      const pid = child.pid;
      const exited = (code: number | null, signal: NodeJS.Signals | null) => {
        expectExit(pid);
        onFailure(new Error(`${name} exited unexpectedly (${signal ?? code})`));
      };
      const failed = (error: Error) => {
        expectExit(pid);
        onFailure(error);
      };
      child.once("exit", exited);
      child.once("error", failed);
      watched.set(pid, () => {
        child.removeListener("exit", exited);
        child.removeListener("error", failed);
      });
    },
    expectExit,
    close() {
      for (const pid of watched.keys()) expectExit(pid);
    },
  };
}
