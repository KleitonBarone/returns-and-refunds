import { describe, expect, it } from "vitest";
import { recoveryId } from "../../apps/web/src/demo/fixtures.ts";
import { createBrowserDemo, storageKey } from "../../apps/web/src/demo/model.ts";
import {
  ordersContract,
  returnDetailContract,
  returnsContract,
  sessionContract,
} from "../../packages/contracts/src/index.ts";

type Demo = ReturnType<typeof createBrowserDemo>;
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function persona(demo: Demo, personaId: string) {
  return sessionContract.assert(demo.request("/session", { personaId }));
}
function request(demo: Demo, key = crypto.randomUUID()) {
  persona(demo, "customer-maya");
  return returnDetailContract.assert(
    demo.request("/returns", {
      orderId: "order-1042",
      requestKey: key,
      reason: "The tee is too large.",
      items: [{ lineId: "order-1042-tee", quantity: 1 }],
    }),
  );
}
function inspect(demo: Demo, id: string) {
  for (const [personaId, action, expectedStatus] of [
    ["support-ava", "approve", "requested"],
    ["warehouse-jules", "receive", "approved"],
    ["warehouse-jules", "pass_inspection", "received"],
  ] as const) {
    persona(demo, personaId);
    demo.request(`/returns/${id}/actions`, {
      action,
      expectedStatus,
      reason: "Condition verified.",
      correlationId: crypto.randomUUID(),
    });
  }
  persona(demo, "finance-sam");
}
function refund(demo: Demo, id: string, expectedAmountMinor = 3500) {
  return returnDetailContract.assert(
    demo.request(`/returns/${id}/refund`, {
      expectedAmountMinor,
      reason: "Inspection passed.",
      correlationId: crypto.randomUUID(),
    }),
  );
}

describe("browser demo", () => {
  it("uses the real UI contracts and scopes orders, returns, and actions to the selected persona", () => {
    const demo = createBrowserDemo();
    expect(() => demo.request("/orders")).toThrow("Choose a demo persona");
    persona(demo, "customer-other");
    expect(ordersContract.assert(demo.request("/orders")).map((order) => order.number)).toEqual([
      "OT-2001",
    ]);
    expect(returnsContract.assert(demo.request("/returns"))).toEqual([]);
    expect(() => demo.request(`/returns/${recoveryId}`)).toThrow("Return not found");
    persona(demo, "support-other");
    expect(() => demo.request("/orders")).toThrow("Only customers");
    persona(demo, "customer-maya");
    expect(() =>
      demo.request(`/returns/${recoveryId}/refund/check`, {
        reason: "Check it.",
        correlationId: crypto.randomUUID(),
      }),
    ).toThrow("finance role");
    expect(() => demo.request("/provider-events", {})).toThrow();
  });

  it("reserves units once, replays equivalent requests, and rejects changed payloads and expired orders", () => {
    const demo = createBrowserDemo();
    const key = crypto.randomUUID();
    const original = request(demo, key);
    const input = {
      orderId: "order-1042",
      requestKey: key,
      reason: "The tee is too large.",
      items: [{ quantity: 1, lineId: "order-1042-tee" }],
    };
    expect(returnDetailContract.assert(demo.request("/returns", input)).id).toBe(original.id);
    expect(() => demo.request("/returns", { ...input, reason: "A different reason." })).toThrow(
      "different content",
    );
    expect(() =>
      demo.request("/returns", {
        ...input,
        requestKey: crypto.randomUUID(),
        items: [{ quantity: 3, lineId: "order-1042-tee" }],
      }),
    ).toThrow("already reserved");
    expect(() =>
      demo.request("/returns", {
        ...input,
        orderId: "order-1031",
        requestKey: crypto.randomUUID(),
        items: [{ quantity: 1, lineId: "order-1031-tee" }],
      }),
    ).toThrow("window has closed");
    expect(original.amountMinor).toBe(3500);
    expect(
      ordersContract.assert(demo.request("/orders")).find((order) => order.id === "order-1042")
        ?.lines[0]?.available,
    ).toBe(2);
  });

  it("rejects stale decisions and releases claims after support rejection", () => {
    const demo = createBrowserDemo();
    const original = request(demo);
    const action = {
      action: "reject",
      expectedStatus: "requested",
      reason: "Outside our return policy.",
      correlationId: crypto.randomUUID(),
    };
    expect(() => demo.request(`/returns/${original.id}/actions`, action)).toThrow("support role");
    persona(demo, "support-ava");
    const closed = returnDetailContract.assert(
      demo.request(`/returns/${original.id}/actions`, action),
    );
    expect(closed.closureReason).toBe("rejected");
    expect(() => demo.request(`/returns/${original.id}/actions`, action)).toThrow("changed");
    persona(demo, "customer-maya");
    expect(
      ordersContract.assert(demo.request("/orders")).find((order) => order.id === "order-1042")
        ?.lines[0]?.available,
    ).toBe(3);
  });

  it("completes the normal workflow with one operation and permanently consumed units", () => {
    let now = 1000;
    const demo = createBrowserDemo(undefined, () => now);
    const original = request(demo);
    persona(demo, "finance-sam");
    expect(() => refund(demo, original.id)).toThrow("Passing inspection");
    inspect(demo, original.id);
    expect(() => refund(demo, original.id, 5000)).toThrow("exact merchandise amount");
    const pending = refund(demo, original.id);
    expect(pending.refund?.status).toBe("pending");
    now += 1000;
    const complete = returnDetailContract.assert(demo.request(`/returns/${original.id}`));
    expect(complete.status).toBe("closed");
    expect(complete.refund?.status).toBe("succeeded");
    expect(complete.refund?.id).toBe(pending.refund?.id);
    expect(refund(demo, original.id).refund?.providerReceiptId).toBe(
      complete.refund?.providerReceiptId,
    );
    expect(complete.history.filter((event) => event.event === "Refund succeeded")).toHaveLength(1);
    persona(demo, "customer-maya");
    expect(
      ordersContract.assert(demo.request("/orders")).find((order) => order.id === "order-1042")
        ?.lines[0]?.available,
    ).toBe(2);
  });

  it("persists pending work, exposes a lost response, and recovers the same operation after reload", () => {
    const storage = memoryStorage();
    let now = 1000;
    const demo = createBrowserDemo(storage, () => now);
    demo.setPaymentOutcome("lost_response");
    const original = request(demo);
    inspect(demo, original.id);
    const pending = refund(demo, original.id);
    now += 1000;
    const restored = createBrowserDemo(storage, () => now);
    const unknown = returnDetailContract.assert(restored.request(`/returns/${original.id}`));
    expect(unknown.refund?.status).toBe("unknown");
    const check = () =>
      returnDetailContract.assert(
        restored.request(`/returns/${original.id}/refund/check`, {
          reason: "Check the original payment.",
          correlationId: crypto.randomUUID(),
        }),
      );
    const recovered = check();
    expect(recovered.refund?.id).toBe(pending.refund?.id);
    expect(recovered.refund?.lastLookup).toBe("found");
    expect(recovered.refund?.providerReceiptId).toBeTruthy();
    expect(check().history.filter((event) => event.event === "Refund succeeded")).toHaveLength(1);
    const reloaded = createBrowserDemo(storage, () => now);
    expect(
      returnDetailContract.assert(reloaded.request(`/returns/${original.id}`)).refund?.id,
    ).toBe(pending.refund?.id);
  });

  it("recovers malformed or incompatible saved data and resets only its owned key", () => {
    const storage = memoryStorage();
    storage.setItem("unrelated-project", "keep me");
    for (const saved of ["not-json", JSON.stringify({ version: 99 })]) {
      storage.setItem(storageKey, saved);
      const demo = createBrowserDemo(storage);
      expect(demo.getSnapshot().notice).toContain("fresh demo");
      const created = request(demo);
      demo.reset();
      expect(storage.getItem("unrelated-project")).toBe("keep me");
      persona(demo, "finance-sam");
      expect(() => demo.request(`/returns/${created.id}`)).toThrow("not found");
      expect(returnsContract.assert(demo.request("/returns"))).toHaveLength(1);
    }
  });

  it("keeps the current session usable when storage reads or writes fail", () => {
    const demo = createBrowserDemo({
      getItem() {
        throw new Error("Denied");
      },
      setItem() {
        throw new Error("Quota");
      },
      removeItem() {
        throw new Error("Denied");
      },
    });
    const created = request(demo);
    expect(demo.getSnapshot().persistent).toBe(false);
    expect(demo.getSnapshot().notice).toContain("this tab only");
    expect(returnDetailContract.assert(demo.request(`/returns/${created.id}`)).id).toBe(created.id);
    demo.reset();
    expect(demo.getSnapshot().notice).toContain("this tab only");
  });

  it("removes old saved progress on reset even after storage becomes full", () => {
    const storage = memoryStorage();
    let full = false;
    const demo = createBrowserDemo({
      ...storage,
      setItem(key, value) {
        if (full) throw new Error("Quota");
        storage.setItem(key, value);
      },
    });
    request(demo);
    storage.setItem("unrelated-project", "preserve");
    full = true;
    persona(demo, "finance-sam");
    expect(demo.getSnapshot().persistent).toBe(false);
    demo.reset();
    expect(storage.getItem(storageKey)).toBeNull();
    expect(storage.getItem("unrelated-project")).toBe("preserve");
    expect(sessionContract.assert(createBrowserDemo(storage).request("/session")).actor).toBeNull();
  });
});
