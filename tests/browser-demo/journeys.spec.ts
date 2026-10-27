import { test as base, expect, type Page } from "@playwright/test";

const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
  baseURL: async ({}, use) => {
    const address = process.env.RETURNS_DEMO_URL;
    if (!address) throw new Error("Use pnpm test:demo to start the owned static server");
    await use(address);
  },
});
const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, baseURL }) => {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== baseURL || url.pathname.startsWith("/api"))
      errors.push(`Unexpected request: ${request.url()}`);
  });
});
test.afterEach(async ({ page }) => {
  expect(failures.get(page)).toEqual([]);
});

async function workspace(page: Page, name: string) {
  const button = page.getByRole("button", { name: `${name} workspace`, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}
async function openReturn(page: Page, orderNumber: string) {
  await page
    .getByRole("button", { name: new RegExp(`^Return .+ for ${orderNumber}, Maya Chen,`) })
    .click();
  await expect(page.getByRole("heading", { name: orderNumber, exact: true })).toBeVisible();
}
async function decide(page: Page, name: string) {
  await page
    .getByRole("textbox", { name: "Decision reason", exact: true })
    .fill("The item and policy have been checked.");
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: `Confirm ${name.toLowerCase()}`, exact: true }).click();
  await expect(page.getByRole("group", { name: "Confirm return action" })).toHaveCount(0);
}

test("completes the shared UI without a backend, persists progress, isolates visitors, and resets", async ({
  page,
  browser,
  baseURL,
}, info) => {
  await page.goto("/");
  await expect(page.getByText("Interactive browser demo", { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("unrelated-project", "preserve"));
  // After assets load, the entire workflow still works with the network unavailable.
  await page.context().setOffline(true);
  await workspace(page, "Customer");
  await page.getByRole("button", { name: /^NL-1042 Delivered/ }).click();
  await page
    .getByRole("spinbutton", { name: "Return quantity for Heavyweight cotton tee" })
    .fill("1");
  await page
    .getByRole("textbox", { name: "Why are you returning these items?" })
    .fill("The fit is too large.");
  await page.getByRole("button", { name: "Request return", exact: true }).click();
  await expect(page.getByRole("heading", { name: "NL-1042", exact: true })).toBeVisible();
  await workspace(page, "Support");
  await openReturn(page, "NL-1042");
  await decide(page, "Approve return");
  await workspace(page, "Warehouse");
  await openReturn(page, "NL-1042");
  await decide(page, "Record receipt");
  await decide(page, "Pass inspection");
  await workspace(page, "Finance");
  await openReturn(page, "NL-1042");
  await page
    .getByRole("textbox", { name: "Refund reason", exact: true })
    .fill("Passing inspection confirmed.");
  await page.getByRole("button", { name: "Review refund", exact: true }).click();
  await page.getByRole("button", { name: "Confirm $35.00 refund", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Refund status" }).getByText("Confirmed", { exact: true }),
  ).toBeVisible();
  await page.context().setOffline(false);
  await page.reload();
  await openReturn(page, "NL-1042");
  await expect(
    page.getByRole("region", { name: "Refund status" }).getByText("Confirmed", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("browser-demo-desktop.png"), fullPage: true });

  const other = await browser.newContext();
  try {
    const visitor = await other.newPage();
    await visitor.goto(baseURL ?? "");
    await visitor.getByRole("button", { name: "Start a return", exact: true }).click();
    await expect(
      visitor.getByRole("button", { name: /^Return .+ for NL-1042, Maya Chen,/ }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }

  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm reset", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Confirm reset", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start a return", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset demo", exact: true })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("unrelated-project"))).toBe("preserve");
  await page.reload();
  await expect(page.getByRole("button", { name: "Start a return", exact: true })).toBeVisible();
});

test("recovers the original simulated payment after reload on a narrow screen", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Simulated payment outcome", exact: true })
    .selectOption("lost_response");
  await page.getByRole("button", { name: "Explore refund recovery", exact: true }).click();
  await openReturn(page, "DEMO-UNKNOWN");
  await expect(
    page
      .getByRole("region", { name: "Refund status" })
      .getByText("Outcome unknown", { exact: true }),
  ).toBeVisible();
  await page.getByText("Payment reference", { exact: true }).click();
  const operation = await page.getByText(/^Refund operation /).textContent();
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Simulated payment outcome", exact: true }),
  ).toHaveValue("lost_response");
  await openReturn(page, "DEMO-UNKNOWN");
  await page
    .getByRole("textbox", { name: "Recovery reason", exact: true })
    .fill("Check the original payment outcome.");
  await page.getByRole("button", { name: "Check payment status", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Refund status" }).getByText("Confirmed", { exact: true }),
  ).toBeVisible();
  await page.getByText("Payment reference", { exact: true }).click();
  await expect(page.getByText(/^Refund operation /)).toHaveText(operation ?? "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: info.outputPath("browser-demo-recovered-narrow.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /Back to/ }).click();
  await workspace(page, "Customer");
  await page.getByRole("button", { name: /^NL-1031 Delivered/ }).click();
  await expect(page.getByRole("button", { name: "Request return", exact: true })).toBeDisabled();
  await expect(page.getByText(/The 30-day return window closed/)).toBeVisible();
});

test("continues in memory when browser storage is blocked", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByText(/Progress lasts for this tab only/).first()).toBeVisible();
  await page.getByRole("button", { name: "Explore refund recovery", exact: true }).click();
  await openReturn(page, "DEMO-UNKNOWN");
  await page
    .getByRole("textbox", { name: "Recovery reason", exact: true })
    .fill("Check this simulated payment.");
  await page.getByRole("button", { name: "Check payment status", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Refund status" }).getByText("Confirmed", { exact: true }),
  ).toBeVisible();
});

test("loads a fresh demo after malformed saved data", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("returns-and-refunds.browser-demo", "not-json"),
  );
  await page.goto("/");
  await expect(page.getByText(/Saved demo data could not be read/)).toBeVisible();
  await page.getByRole("button", { name: "Start a return", exact: true }).click();
  await expect(page.getByRole("button", { name: /^NL-1042 Delivered/ })).toBeVisible();
});

test("keeps alternate customers and merchants in additional scenarios", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("group", { name: "Choose a workspace" }).getByRole("button"),
  ).toHaveCount(4);
  const scenarios = page.getByRole("combobox", { name: "Additional demo scenario", exact: true });
  await expect(scenarios).toBeHidden();
  const customer = page.getByRole("button", { name: "Customer workspace", exact: true });
  await customer.focus();
  await page.keyboard.press("Enter");
  await expect(customer).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Viewing as Maya Chen at Northline Supply.")).toBeVisible();
  await page.getByText("More demo scenarios", { exact: true }).press("Enter");
  await scenarios.selectOption("customer-leo");
  await expect(page.getByRole("button", { name: /^NL-1043 Delivered/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^NL-1042 Delivered/ })).toHaveCount(0);
  await expect(page.getByText("Viewing as Leo Martins at Northline Supply.")).toBeVisible();
  await scenarios.selectOption("customer-other");
  await expect(page.getByRole("button", { name: /^OT-2001 Delivered/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^NL-/ })).toHaveCount(0);
  await expect(page.getByText("Viewing as Noah Smith at Other Store.")).toBeVisible();
  await scenarios.selectOption("support-other");
  await expect(page.getByRole("heading", { name: "No return requests yet" })).toBeVisible();
  await workspace(page, "Finance");
  await expect(page.getByRole("button", { name: /^Return .+ for DEMO-UNKNOWN,/ })).toBeVisible();
  await expect(page.getByText("Viewing as Sam Rivera at Northline Supply.")).toBeVisible();
  await expect(scenarios).toHaveValue("");
});
