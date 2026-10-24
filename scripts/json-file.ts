import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export async function writeJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporary, path);
        break;
      } catch (error) {
        if (
          process.platform !== "win32" ||
          attempt >= 6 ||
          !(error instanceof Error) ||
          !("code" in error) ||
          !["EPERM", "EACCES", "EBUSY"].includes(String(error.code))
        )
          throw error;
        // Windows readers can briefly lock the destination. Keep its current contents intact.
        await delay(10 * 2 ** attempt);
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
