import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeJson } from "../../scripts/json-file.ts";

it("publishes complete JSON while another command reads repeated updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "returns-manifest-"));
  const path = join(directory, "manifest.json");
  const children = "x".repeat(64 * 1024);
  let reads = 0;
  let invalid = 0;
  try {
    await writeJson(path, { revision: 0, children });
    // Overlap each publication with a read without continuously starving Windows rename retries.
    for (let revision = 1; revision <= 200; revision++) {
      const [raw] = await Promise.all([
        readFile(path, "utf8"),
        writeJson(path, { revision, children }),
      ]);
      reads++;
      try {
        JSON.parse(raw);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        invalid++;
      }
    }
    expect(reads).toBe(200);
    expect(invalid).toBe(0);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ revision: 200 });
  } finally {
    await rm(path, { force: true });
    await rmdir(directory);
  }
}, 10000);
