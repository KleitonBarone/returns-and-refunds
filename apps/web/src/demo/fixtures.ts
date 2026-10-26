import {
  type Actor,
  DEMO_NOW,
  type OrderView,
  type ReturnView,
} from "../../../../packages/contracts/src/index.ts";

export const demoPersonas: Actor[] = (
  [
    ["customer-maya", "Maya Chen", "customer", "northline"],
    ["customer-leo", "Leo Martins", "customer", "northline"],
    ["support-ava", "Ava Brooks", "support", "northline"],
    ["warehouse-jules", "Jules Park", "warehouse", "northline"],
    ["finance-sam", "Sam Rivera", "finance", "northline"],
    ["customer-other", "Noah Smith", "customer", "other-store"],
    ["support-other", "Robin Ellis", "support", "other-store"],
  ] as const
).map(([id, name, role, merchantId]) => {
  return {
    id,
    name,
    role,
    merchantId,
    merchantName: merchantId === "northline" ? "Northline Supply" : "Other Store",
    customerId: role === "customer" ? id : null,
  };
});

const definitions = [
  { id: "order-1042", number: "NL-1042", customerId: "customer-maya", days: 9 },
  { id: "order-1031", number: "NL-1031", customerId: "customer-maya", days: 35 },
  { id: "order-1043", number: "NL-1043", customerId: "customer-leo", days: 5 },
  { id: "order-other", number: "OT-2001", customerId: "customer-other", days: 4 },
  { id: "order-recovery", number: "DEMO-UNKNOWN", customerId: "customer-maya", days: 6 },
];

export const demoOrders = definitions.map((fixture) => {
  const delivered = Date.parse(DEMO_NOW) - fixture.days * 86400000;
  return {
    ...fixture,
    merchantId: fixture.customerId === "customer-other" ? "other-store" : "northline",
    currency: "USD",
    capturedMinor: 15500,
    deliveredAt: new Date(delivered).toISOString(),
    deadline: new Date(delivered + 30 * 86400000).toISOString(),
    eligible: fixture.days <= 30,
    lines: [
      {
        id: `${fixture.id}-tee`,
        name: "Heavyweight cotton tee",
        variant: "Washed indigo / M",
        quantity: 3,
        available: 3,
        unitValues: [3500, 3500, 3500],
      },
      {
        id: `${fixture.id}-cap`,
        name: "Canvas field cap",
        variant: "Stone / One size",
        quantity: 1,
        available: 1,
        unitValues: [5000],
      },
    ],
  } satisfies OrderView & { customerId: string; merchantId: string };
});

export const recoveryId = "11111111-1111-4111-8111-111111111111";
export const recoveryOperationId = "22222222-2222-4222-8222-222222222222";

export function recoveryFixture(): ReturnView {
  return {
    id: recoveryId,
    orderId: "order-recovery",
    orderNumber: "DEMO-UNKNOWN",
    customerName: "Maya Chen",
    reason: "The tee is larger than expected.",
    status: "inspection_passed",
    closureReason: null,
    refundStatus: "unknown",
    amountMinor: 3500,
    currency: "USD",
    requestedAt: DEMO_NOW,
    deadline: "2026-10-25T12:00:00.000Z",
    policyVersion: "merchandise-30d-v1",
    items: [
      {
        unitId: "order-recovery-tee:1",
        name: "Heavyweight cotton tee",
        variant: "Washed indigo / M",
        amountMinor: 3500,
      },
    ],
    history: [
      {
        actorName: "Maya Chen",
        event: "Return requested",
        fromStatus: null,
        toStatus: "requested",
      },
      {
        actorName: "Ava Brooks",
        event: "Return approved",
        fromStatus: "requested",
        toStatus: "approved",
      },
      {
        actorName: "Jules Park",
        event: "Return received",
        fromStatus: "approved",
        toStatus: "received",
      },
      {
        actorName: "Jules Park",
        event: "Inspection passed",
        fromStatus: "received",
        toStatus: "inspection_passed",
      },
      {
        actorName: "Sam Rivera",
        event: "Refund outcome unknown",
        fromStatus: "inspection_passed",
        toStatus: "inspection_passed",
      },
    ].map((event) => ({
      ...event,
      id: crypto.randomUUID(),
      reason: "Prepared browser recovery scenario.",
      at: DEMO_NOW,
      correlationId: crypto.randomUUID(),
      operationId: event.event.startsWith("Refund") ? recoveryOperationId : null,
      refundFromStatus: null,
      refundToStatus: event.event.startsWith("Refund") ? "unknown" : null,
    })),
    reviews: [
      {
        kind: "decision",
        outcome: "approved",
        reason: "Within the return window.",
        actorName: "Ava Brooks",
        at: DEMO_NOW,
      },
      {
        kind: "inspection",
        outcome: "passed",
        reason: "Original condition verified.",
        actorName: "Jules Park",
        at: DEMO_NOW,
      },
    ],
    refund: {
      id: recoveryOperationId,
      status: "unknown",
      amountMinor: 3500,
      currency: "USD",
      requestedAt: DEMO_NOW,
      updatedAt: DEMO_NOW,
      message: "Simulated response lost. Check the original refund to confirm its outcome.",
      providerReceiptId: null,
      lastLookup: null,
      checkedAt: null,
    },
  };
}
