import { type } from "arktype";
import {
  type Actor,
  actionInput,
  DEMO_NOW,
  type ReturnView,
  recoveryInput,
  refundInput,
  requestInput,
  returnActions,
  returnDetailContract,
  sessionInput,
} from "../../../../packages/contracts/src/index.ts";
import { demoOrders, demoPersonas, recoveryFixture, recoveryOperationId } from "./fixtures.ts";

export const storageKey = "returns-and-refunds.browser-demo";
export const paymentOutcomes = ["success", "lost_response"] as const;
const outcomeContract = type.enumerated(...paymentOutcomes);
const stateContract = type({
  version: "1",
  actorId: "string | null",
  paymentOutcome: outcomeContract,
  returns: returnDetailContract.array().atMostLength(100),
  requests: type({ key: "string.uuid", fingerprint: "string", returnId: "string" })
    .array()
    .atMostLength(100),
  jobs: type({ returnId: "string", dueAt: "number", outcome: outcomeContract })
    .array()
    .atMostLength(100),
  receipts: type({
    operationId: "string.uuid",
    id: "string",
    amountMinor: "number.integer",
    currency: "string",
  })
    .array()
    .atMostLength(100),
});
type DemoState = typeof stateContract.infer;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type HistoryChange = Partial<
  Pick<
    ReturnView["history"][number],
    "fromStatus" | "toStatus" | "refundFromStatus" | "refundToStatus"
  >
>;

function freshState(): DemoState {
  return {
    version: 1,
    actorId: null,
    paymentOutcome: "success",
    returns: [recoveryFixture()],
    requests: [],
    jobs: [],
    receipts: [
      {
        operationId: recoveryOperationId,
        id: "demo-receipt-recovery",
        amountMinor: 3500,
        currency: "USD",
      },
    ],
  };
}

function record(
  request: ReturnView,
  actorName: string,
  event: string,
  reason: string,
  correlationId: string,
  changes: HistoryChange = {},
) {
  request.history.push({
    id: crypto.randomUUID(),
    actorName,
    event,
    reason,
    at: DEMO_NOW,
    correlationId,
    fromStatus: request.status,
    toStatus: request.status,
    operationId: request.refund?.id ?? null,
    refundFromStatus: null,
    refundToStatus: null,
    ...changes,
  });
}

function availableOrders(state: DemoState) {
  const claimed = new Set(
    state.returns
      .filter((request) => request.status !== "closed" || request.closureReason === "refunded")
      .flatMap((request) => request.items.map((item) => item.unitId)),
  );
  return demoOrders.map((order) => ({
    ...order,
    lines: order.lines.map((line) => {
      const units = line.unitValues.flatMap((value, index) =>
        claimed.has(`${line.id}:${index + 1}`) ? [] : [{ id: `${line.id}:${index + 1}`, value }],
      );
      return {
        ...line,
        available: units.length,
        unitValues: units.map((unit) => unit.value),
        units,
      };
    }),
  }));
}

function canRead(actor: Actor, request: ReturnView) {
  const order = demoOrders.find((item) => item.id === request.orderId);
  return (
    order?.merchantId === actor.merchantId &&
    (actor.role !== "customer" || order.customerId === actor.customerId)
  );
}

function confirmRefund(
  state: DemoState,
  request: ReturnView,
  correlationId: string = crypto.randomUUID(),
) {
  const refund = request.refund;
  if (!refund || refund.status === "succeeded") return;
  const receipt = state.receipts.find((item) => item.operationId === refund.id);
  if (!receipt) throw new Error("The simulated payment has not been recorded yet.");
  const previous = refund.status;
  refund.status = "succeeded";
  refund.providerReceiptId = receipt.id;
  refund.updatedAt = DEMO_NOW;
  refund.message = "Simulated payment confirmed. No real money moved.";
  record(request, "Refund processor", "Refund succeeded", refund.message, correlationId, {
    toStatus: "closed",
    refundFromStatus: previous,
    refundToStatus: "succeeded",
  });
  request.status = "closed";
  request.closureReason = "refunded";
  request.refundStatus = "succeeded";
}

// The browser advances simulated jobs when read. It runs no background worker or HTTP API.
function settlePayments(state: DemoState, now: number) {
  const due = state.jobs.filter((job) => job.dueAt <= now);
  for (const job of due) {
    const request = state.returns.find((item) => item.id === job.returnId);
    const refund = request?.refund;
    if (!request || !refund) continue;
    if (!state.receipts.some((receipt) => receipt.operationId === refund.id))
      state.receipts.push({
        operationId: refund.id,
        id: `demo-receipt-${refund.id}`,
        amountMinor: refund.amountMinor,
        currency: refund.currency,
      });
    if (job.outcome === "success") confirmRefund(state, request);
    else {
      refund.status = "unknown";
      refund.message = "Simulated response lost. Check the original refund to confirm its outcome.";
      request.refundStatus = "unknown";
      record(
        request,
        "Refund processor",
        "Refund outcome unknown",
        refund.message,
        crypto.randomUUID(),
        { refundFromStatus: "pending", refundToStatus: "unknown" },
      );
    }
  }
  state.jobs = state.jobs.filter((job) => job.dueAt > now);
  return due.length > 0;
}

function createReturn(state: DemoState, actor: Actor, body: unknown) {
  if (actor.role !== "customer") throw new Error("This action requires the customer role");
  const input = requestInput.assert(body);
  const reason = input.reason.trim();
  if (
    reason.length < 3 ||
    !input.items.length ||
    new Set(input.items.map((item) => item.lineId)).size !== input.items.length
  )
    throw new Error("Select items and explain the return in at least three characters.");
  const order = availableOrders(state).find(
    (item) =>
      item.id === input.orderId &&
      item.customerId === actor.customerId &&
      item.merchantId === actor.merchantId,
  );
  if (!order) throw new Error("Order not found");
  const fingerprint = JSON.stringify({
    orderId: input.orderId,
    reason,
    items: input.items
      .map(({ lineId, quantity }) => ({ lineId, quantity }))
      .sort((a, b) => a.lineId.localeCompare(b.lineId)),
  });
  const previous = state.requests.find((item) => item.key === input.requestKey);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new Error("This request key already belongs to different content.");
    const original = state.returns.find((item) => item.id === previous.returnId);
    if (!original || !canRead(actor, original)) throw new Error("Return not found");
    return original;
  }
  if (!order.eligible) throw new Error("The 30-day return window has closed.");
  if (state.returns.length >= 100)
    throw new Error("This demo has reached 100 returns. Reset the demo to start again.");
  const items = input.items.flatMap((selection) => {
    const line = order.lines.find((item) => item.id === selection.lineId);
    if (!line || selection.quantity > line.available)
      throw new Error("Those units are already reserved or refunded.");
    return line.units.slice(0, selection.quantity).map((unit) => ({
      unitId: unit.id,
      amountMinor: unit.value,
      name: line.name,
      variant: line.variant,
    }));
  });
  const request: ReturnView = {
    id: crypto.randomUUID(),
    orderId: order.id,
    orderNumber: order.number,
    customerName: actor.name,
    reason,
    status: "requested",
    closureReason: null,
    refundStatus: null,
    amountMinor: items.reduce((sum, item) => sum + item.amountMinor, 0),
    currency: order.currency,
    requestedAt: DEMO_NOW,
    deadline: order.deadline,
    policyVersion: "merchandise-30d-v1",
    items,
    history: [],
    reviews: [],
    refund: null,
  };
  record(request, actor.name, "Return requested", reason, input.requestKey, { fromStatus: null });
  state.returns.unshift(request);
  state.requests.push({ key: input.requestKey, fingerprint, returnId: request.id });
  return request;
}

function decide(request: ReturnView, actor: Actor, body: unknown) {
  const input = actionInput.assert(body);
  const rule = returnActions.find((item) => item.name === input.action);
  if (!rule || rule.role !== actor.role)
    throw new Error(`This action requires the ${rule?.role ?? "operator"} role`);
  if (request.status !== input.expectedStatus || request.status !== rule.from)
    throw new Error("This return changed or is not ready for this action. Refresh its history.");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error("Explain this action in at least three characters.");
  const rejected = input.action === "reject";
  const failed = input.action === "fail_inspection";
  record(request, actor.name, rule.event, reason, input.correlationId, { toStatus: rule.to });
  if (rule.name === "approve" || rejected)
    request.reviews.push({
      kind: "decision",
      outcome: rejected ? "rejected" : "approved",
      reason,
      actorName: actor.name,
      at: DEMO_NOW,
    });
  if (rule.name === "pass_inspection" || failed)
    request.reviews.push({
      kind: "inspection",
      outcome: failed ? "failed" : "passed",
      reason,
      actorName: actor.name,
      at: DEMO_NOW,
    });
  if (failed)
    record(
      request,
      actor.name,
      "Return closed",
      `Inspection failed: ${reason}`,
      input.correlationId,
      { fromStatus: "inspection_failed", toStatus: "closed" },
    );
  request.status = rejected || failed ? "closed" : rule.to;
  request.closureReason = rejected ? "rejected" : failed ? "inspection_failed" : null;
  return request;
}

function refundReturn(
  state: DemoState,
  request: ReturnView,
  actor: Actor,
  action: string | undefined,
  body: unknown,
  now: number,
) {
  if (actor.role !== "finance") throw new Error("This action requires the finance role");
  if (action === undefined) {
    const input = refundInput.assert(body);
    if (request.refund) return request;
    if (request.status !== "inspection_passed" || input.expectedAmountMinor !== request.amountMinor)
      throw new Error("Passing inspection and the exact merchandise amount are required.");
    if (input.reason.trim().length < 3)
      throw new Error("Explain the refund in at least three characters.");
    const order = demoOrders.find((item) => item.id === request.orderId);
    const reserved = state.returns
      .filter((item) => item.orderId === request.orderId && item.refund)
      .reduce((sum, item) => sum + (item.refund?.amountMinor ?? 0), 0);
    if (!order || reserved + request.amountMinor > order.capturedMinor)
      throw new Error("The refund exceeds the captured amount.");
    request.refund = {
      id: crypto.randomUUID(),
      status: "pending",
      amountMinor: request.amountMinor,
      currency: request.currency,
      requestedAt: DEMO_NOW,
      updatedAt: DEMO_NOW,
      message: null,
      providerReceiptId: null,
      lastLookup: null,
      checkedAt: null,
    };
    request.refundStatus = "pending";
    state.jobs.push({ returnId: request.id, dueAt: now + 700, outcome: state.paymentOutcome });
    record(request, actor.name, "Refund requested", input.reason.trim(), input.correlationId, {
      refundToStatus: "pending",
    });
    return request;
  }
  const input = recoveryInput.assert(body);
  if (input.reason.trim().length < 3)
    throw new Error("Explain the recovery in at least three characters.");
  const refund = request.refund;
  if (!refund) throw new Error("No refund exists for this return.");
  if (action === "check") {
    refund.checkedAt = DEMO_NOW;
    const receipt = state.receipts.find((item) => item.operationId === refund.id);
    refund.lastLookup = receipt ? "found" : "not_found";
    record(request, actor.name, "Refund status checked", input.reason.trim(), input.correlationId);
    if (receipt) confirmRefund(state, request, input.correlationId);
    return request;
  }
  // This demo's lost-response mode always records a payment. A new submission is unnecessary.
  throw new Error(
    "Check the original payment instead. This simulated refund does not need another submission.",
  );
}

export function createBrowserDemo(storage?: StoragePort, now = Date.now) {
  let state = freshState();
  let persistent = Boolean(storage);
  let notice = persistent
    ? ""
    : "Browser storage is unavailable. Progress lasts for this tab only.";
  const listeners = new Set<() => void>();
  try {
    const saved = storage?.getItem(storageKey);
    if (saved) {
      if (saved.length > 512 * 1024) throw new Error("Saved demo is too large");
      state = stateContract.assert(JSON.parse(saved));
    }
  } catch {
    notice = "Saved demo data could not be read. A fresh demo has been loaded.";
  }
  let snapshot = { persistent, notice, paymentOutcome: state.paymentOutcome };
  function save(next: DemoState) {
    state = next;
    if (persistent) {
      try {
        const saved = JSON.stringify(next);
        if (saved.length > 512 * 1024) throw new Error("Saved demo is too large");
        storage?.setItem(storageKey, saved);
      } catch {
        persistent = false;
        notice = "Browser storage is unavailable. Progress lasts for this tab only.";
      }
    }
    if (
      snapshot.persistent !== persistent ||
      snapshot.notice !== notice ||
      snapshot.paymentOutcome !== next.paymentOutcome
    ) {
      snapshot = { persistent, notice, paymentOutcome: next.paymentOutcome };
      for (const listener of listeners) listener();
    }
  }
  function dispatch(draft: DemoState, path: string, body?: unknown): unknown {
    const actor = demoPersonas.find((item) => item.id === draft.actorId) ?? null;
    if (path === "/session") {
      if (body !== undefined) {
        const input = sessionInput.assert(body);
        const chosen = demoPersonas.find((item) => item.id === input.personaId);
        if (!chosen) throw new Error("Demo persona not found");
        draft.actorId = chosen.id;
        return { actor: chosen, personas: demoPersonas, demoNow: DEMO_NOW };
      }
      return { actor, personas: demoPersonas, demoNow: DEMO_NOW };
    }
    if (!actor) throw new Error("Choose a demo persona to continue");
    if (path === "/orders" && body === undefined) {
      if (actor.role !== "customer") throw new Error("Only customers can access their orders");
      return availableOrders(draft).filter(
        (order) => order.merchantId === actor.merchantId && order.customerId === actor.customerId,
      );
    }
    if (path === "/returns")
      return body === undefined
        ? draft.returns.filter((item) => canRead(actor, item))
        : createReturn(draft, actor, body);
    const match = /^\/returns\/([^/]+)(?:\/(actions|refund)(?:\/(check|retry))?)?$/.exec(path);
    const request = draft.returns.find((item) => item.id === match?.[1] && canRead(actor, item));
    if (!match || !request) throw new Error("Return not found");
    if (body === undefined && !match[2]) return request;
    if (body !== undefined && match[2] === "actions" && !match[3])
      return decide(request, actor, body);
    if (body !== undefined && match[2] === "refund")
      return refundReturn(draft, request, actor, match[3], body, now());
    throw new Error("This action is not available in the browser demo.");
  }
  return {
    request(path: string, body?: unknown) {
      const draft = structuredClone(state);
      const advanced = settlePayments(draft, now());
      const result = dispatch(draft, path, body);
      if (body !== undefined || advanced) save(draft);
      return structuredClone(result);
    },
    reset() {
      try {
        storage?.removeItem(storageKey);
      } catch {
        // A denied storage API must not prevent resetting the current in-memory session.
      }
      notice = persistent
        ? ""
        : "Browser storage is unavailable. Progress lasts for this tab only.";
      save(freshState());
    },
    setPaymentOutcome(value: unknown) {
      save({ ...state, paymentOutcome: outcomeContract.assert(value) });
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
