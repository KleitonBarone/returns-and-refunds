import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { root } from "./environment.ts";

execFileSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "install",
    "chromium",
    "--no-shell",
    ...(process.argv.includes("--with-deps") ? ["--with-deps"] : []),
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: join(root, ".local", "browsers"),
      PLAYWRIGHT_SKIP_BROWSER_GC: "0",
    },
    stdio: "inherit",
    windowsHide: true,
  },
);
