import { writeFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { connectDatabase } from "../../apps/server/src/db.ts";
import {
  auditEntries,
  providerEventReceipts,
  refundOperations,
} from "../../apps/server/src/schema.ts";
import { returnDetailContract } from "../../packages/contracts/src/index.ts";
import { simulatorDiagnostics } from "../../packages/contracts/src/payment.ts";
import {
  control,
  enter,
  expect,
  manifest,
  persona,
  serviceCommand,
  tabTo,
  test,
  typeReason,
  waitForHoldRelease,
} from "./fixtures.ts";

if (process.env.RETURNS_E2E_MODE === "hold") {
  test("hold a real browser for abandoned-run recovery", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Open Maya's orders" })).toBeVisible();
    await waitForHoldRelease();
  });
} else if (process.env.RETURNS_E2E_MODE === "fail") {
  test("deliberate failure retains useful bounded diagnostics", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Open Maya's orders" })).toBeVisible();
    expect("injected browser failure").toBe("expected diagnostic fixture");
  });
} else {
  test("keyboard partial return recovers one refund after service restarts", async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const { pool, db } = connectDatabase(String(process.env.DATABASE_URL));
    try {
      await control("payments", {
        merchantId: "northline",
        paymentRef: "payment-order-1042",
        mode: "drop_response",
        responseDelayMs: 0,
        eventDelayMs: 60000,
        eventCopies: 2,
      });
      await page.goto("/");
      await enter(page, "Open Maya's orders");
      await enter(page, /NL-1042.*Return window open/);
      await expect(
        page.getByRole("button", { name: "Request return", exact: true }),
      ).toBeDisabled();
      const quantity = page.getByRole("spinbutton", { name: /Return quantity for .*tee/ });
      await tabTo(page, quantity);
      await page.keyboard.press("ArrowUp");
      await typeReason(
        page,
        "Why are you returning these items?",
        "The tee fits larger than expected.",
      );
      const response = page.waitForResponse(
        (result) => result.url().endsWith("/api/returns") && result.request().method() === "POST",
      );
      // A real order lock holds the request in flight, without replacing API responses.
      const barrier = await pool.connect();
      try {
        await barrier.query("begin");
        await barrier.query("select id from orders where id = $1 for update", ["order-1042"]);
        await enter(page, "Request return");
        await expect(page.getByRole("button", { name: "Sending request…" })).toBeDisabled();
        await expect(quantity).toBeDisabled();
        await barrier.query("commit");
      } finally {
        await barrier.query("rollback");
        barrier.release();
      }
      const createdResponse = await response;
      expect(createdResponse.status()).toBe(201);
      const created = returnDetailContract.assert(await createdResponse.json());
      expect(created.amountMinor).toBe(3500);
      expect(created.items).toHaveLength(1);
      const row = new RegExp(`^Return ${created.id.slice(0, 8).toUpperCase()} for NL-1042,`);
      await expect(page.getByText("Support will review this request next.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "NL-1042", exact: true })).toBeFocused();
      await page.screenshot({ path: info.outputPath("customer-desktop.png"), fullPage: true });

      await persona(page, "support-ava", "support");
      await enter(page, row);
      await typeReason(page, "Decision reason", "Eligible partial return within the window.");
      await enter(page, "Approve return");
      await expect(page.getByRole("button", { name: "Confirm approve return" })).toBeFocused();
      await enter(page, "Cancel");
      await expect(page.getByRole("heading", { name: "NL-1042", exact: true })).toBeFocused();
      await enter(page, "Approve return");
      await enter(page, "Confirm approve return");
      await expect(
        page.getByText("Approved. Waiting for the warehouse to receive the items."),
      ).toBeVisible();

      await persona(page, "warehouse-jules", "warehouse");
      await enter(page, row);
      for (const [label, reason] of [
        ["Record receipt", "One tee received in the return parcel."],
        ["Pass inspection", "One tee inspected and accepted."],
      ] as const) {
        await typeReason(page, "Decision reason", reason);
        await enter(page, label);
        await enter(page, `Confirm ${label.toLowerCase()}`);
        await expect(
          page.getByRole("button", { name: `Confirm ${label.toLowerCase()}` }),
        ).toHaveCount(0);
      }
      await expect(
        page.getByText("Inspection passed. This return is ready for finance to review the refund."),
      ).toBeVisible();

      await persona(page, "finance-sam", "finance");
      await enter(page, row);
      await typeReason(page, "Refund reason", "Refund the inspected tee to the original payment.");
      await enter(page, "Review refund");
      await expect(
        page.getByRole("button", { name: "Confirm $35.00 refund", exact: true }),
      ).toBeFocused();
      await enter(page, "Confirm $35.00 refund");
      const refundPanel = page.getByRole("region", { name: "Refund status" });
      await expect(refundPanel.getByText("Outcome unknown", { exact: true })).toBeVisible();
      const before = returnDetailContract.assert(
        await (await page.request.get(`/api/returns/${created.id}`)).json(),
      );
      expect(before.refund?.status).toBe("unknown");
      expect(before.status).toBe("inspection_passed");
      const [operation] = await db
        .select()
        .from(refundOperations)
        .where(eq(refundOperations.returnId, created.id));
      expect(operation?.amountMinor).toBe(3500);
      await page.screenshot({
        path: info.outputPath("finance-unknown-desktop.png"),
        fullPage: true,
      });

      await serviceCommand("restart");
      await page.reload();
      await enter(page, row);
      await typeReason(
        page,
        "Recovery reason",
        "Check the original refund after services restarted.",
      );
      await enter(page, "Check payment status");
      await expect(refundPanel.getByText("Confirmed", { exact: true })).toBeVisible();
      const recovered = returnDetailContract.assert(
        await (await page.request.get(`/api/returns/${created.id}`)).json(),
      );
      expect(recovered.refund?.id).toBe(before.refund?.id);
      expect(recovered.status).toBe("closed");
      const provider = simulatorDiagnostics.assert(await control("diagnostics"));
      expect(provider.runId).toBe(manifest.id);
      const ledger = provider.ledger.filter(
        (entry) => entry.refundId === recovered.refund?.providerReceiptId,
      );
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.amountMinor).toBe(3500);
      const event = await control("events", {
        refundId: recovered.refund?.providerReceiptId,
        status: "processing",
        delayMs: 0,
        copies: 3,
      });
      await control("deliver", { refundId: recovered.refund?.providerReceiptId });
      const receipts = await db
        .select()
        .from(providerEventReceipts)
        .where(eq(providerEventReceipts.operationId, String(recovered.refund?.id)));
      expect(receipts.filter((receipt) => receipt.outcome === "ignored")).toHaveLength(1);
      const successAudit = await db
        .select()
        .from(auditEntries)
        .where(
          sql`${auditEntries.operationId} = ${recovered.refund?.id} and ${auditEntries.event} = 'Refund succeeded'`,
        );
      expect(successAudit).toHaveLength(1);
      const finalProvider = simulatorDiagnostics.assert(await control("diagnostics"));
      expect(finalProvider.ledger).toHaveLength(1);
      await writeFile(
        info.outputPath("financial-evidence.json"),
        JSON.stringify(
          {
            runId: manifest.id,
            returnId: created.id,
            operationId: recovered.refund?.id,
            amountMinor: recovered.amountMinor,
            currency: recovered.currency,
            provider: finalProvider,
            delayedEvent: event,
            successAuditCount: successAudit.length,
          },
          null,
          2,
        ),
      );

      await persona(page, "customer-maya", "customer");
      await enter(page, row);
      await expect(refundPanel.getByText("Confirmed", { exact: true })).toBeVisible();
      await expect(
        page.getByText("Check the original refund after services restarted.", { exact: true }),
      ).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole("region", { name: "Customer orders and returns" })).toBeHidden();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("customer-recovered-narrow.png"),
        fullPage: true,
      });
      await enter(page, "Back to orders and returns");
      await expect(page.getByRole("region", { name: "Customer orders and returns" })).toBeFocused();
      await enter(page, /NL-1042.*Return window open/);
      await expect(page.getByText("2 of 3 units available", { exact: true })).toBeVisible();
    } finally {
      await pool.end();
    }
  });

  test("expired order, narrow navigation, empty filter, and service recovery", async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await enter(page, "Open Maya's orders");
    await enter(page, /NL-1031.*Window closed/);
    await expect(page.getByText(/The 30-day return window closed/)).toBeVisible();
    await expect(page.getByRole("spinbutton").first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "Request return", exact: true })).toBeDisabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("expired-narrow.png"), fullPage: true });
    await enter(page, "Back to orders and returns");
    await tabTo(page, page.getByRole("searchbox", { name: "Find returns" }));
    await page.keyboard.insertText("not-an-order");
    await expect(page.getByRole("heading", { name: "No matching returns" })).toBeVisible();
    await enter(page, "Clear filters");
    await expect(page.getByRole("searchbox", { name: "Find returns" })).toHaveValue("");
    await serviceCommand("stop-api");
    try {
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "The workspace is unavailable" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await page.screenshot({
        path: info.outputPath("service-unavailable-narrow.png"),
        fullPage: true,
      });
    } finally {
      await serviceCommand("start-api");
    }
    await enter(page, "Try again");
    await expect(page.getByRole("heading", { name: "Your orders & returns" })).toBeVisible();
    await persona(page, "support-other", "support");
    await expect(page.getByRole("heading", { name: "No return requests yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Return .*NL-1042/ })).toHaveCount(0);
  });
}
