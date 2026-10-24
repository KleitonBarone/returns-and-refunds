import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { writeJson } from "../../scripts/json-file.ts";

it("publishes complete JSON while another command reads repeated updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "returns-manifest-"));
  const path = join(directory, "manifest.json");
  const children = "x".repeat(64 * 1024);
  let stopped = false;
  let reads = 0;
  let invalid = 0;
  try {
    await writeJson(path, { revision: 0, children });
    const reader = (async () => {
      while (!stopped) {
        const raw = await readFile(path, "utf8");
        reads++;
        try {
          JSON.parse(raw);
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          invalid++;
        }
        await delay(1);
      }
    })();
    try {
      for (let revision = 1; revision <= 200; revision++)
        await writeJson(path, { revision, children });
    } finally {
      stopped = true;
      await reader;
    }
    expect(reads).toBeGreaterThan(0);
    expect(invalid).toBe(0);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ revision: 200 });
  } finally {
    await rm(path, { force: true });
    await rmdir(directory);
  }
}, 10000);
