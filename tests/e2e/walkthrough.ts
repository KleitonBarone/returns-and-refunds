import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { Page, TestInfo } from "@playwright/test";

// Recording captions and reading time are explicit; assertions still wait for real application state.
export function walkthrough(page: Page, info: TestInfo) {
  const recording = process.env.RETURNS_E2E_MODE === "record";
  const captions: { seconds: number; text: string }[] = [];
  let started = 0;
  async function scene(text: string, seconds = 6) {
    if (!recording) return;
    started ||= Date.now();
    captions.push({ seconds: (Date.now() - started) / 1000, text });
    await page.evaluate((caption) => {
      let banner = document.getElementById("walkthrough-caption");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "walkthrough-caption";
        banner.setAttribute("aria-hidden", "true");
        banner.style.cssText =
          "position:fixed;bottom:0;left:0;right:0;z-index:9999;padding:18px 32px;background:#122328f5;color:#fff;border-top:3px solid #c96a44;font:22px/1.5 system-ui;text-align:center;pointer-events:none;white-space:pre-line";
        document.body.append(banner);
      }
      banner.textContent = caption;
    }, text);
    // Flush the caption paint before an otherwise idle reading interval.
    await page.screenshot();
    await delay(seconds * 1000);
  }
  async function finish() {
    if (!recording) return;
    await scene(
      "Two tees remain available. Every decision and refund keeps its history.\nLocal simulation only. No real payments; personas are demo authentication.",
      Math.max(4, 90 - (Date.now() - started) / 1000),
    );
    await writeFile(
      info.outputPath("walkthrough.json"),
      JSON.stringify(
        {
          readingTimeSeconds: (Date.now() - started) / 1000,
          captions,
          narration: "English captions; no spoken audio",
          annotations: "Caption banner added by recording test only",
        },
        null,
        2,
      ),
    );
  }
  return { recording, scene, finish };
}
