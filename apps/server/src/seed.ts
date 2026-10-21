import { DEMO_NOW } from "../../../packages/contracts/src/index.ts";
import type { Database } from "./db.ts";
import {
  customers,
  environmentIdentity,
  memberships,
  merchants,
  orderLines,
  orders,
  orderUnits,
  users,
} from "./schema.ts";

export const personas = [
  { id: "customer-maya", name: "Maya Chen", role: "customer", merchantId: "northline" },
  { id: "customer-leo", name: "Leo Martins", role: "customer", merchantId: "northline" },
  { id: "support-ava", name: "Ava Brooks", role: "support", merchantId: "northline" },
  { id: "warehouse-jules", name: "Jules Park", role: "warehouse", merchantId: "northline" },
  { id: "finance-sam", name: "Sam Rivera", role: "finance", merchantId: "northline" },
  { id: "customer-other", name: "Noah Smith", role: "customer", merchantId: "other-store" },
] as const;

export async function seed(db: Database, runId: string, disposable: boolean) {
  await db.transaction(async (tx) => {
    await tx
      .insert(environmentIdentity)
      .values({ id: "returns-demo", runId, disposable: disposable ? 1 : 0 })
      .onConflictDoNothing();
    await tx
      .insert(merchants)
      .values([
        { id: "northline", name: "Northline Supply" },
        { id: "other-store", name: "Other Store" },
      ])
      .onConflictDoNothing();
    await tx
      .insert(users)
      .values(personas.map((p) => ({ id: p.id, name: p.name })))
      .onConflictDoNothing();
    await tx
      .insert(memberships)
      .values(personas.map((p) => ({ merchantId: p.merchantId, userId: p.id, role: p.role })))
      .onConflictDoNothing();
    await tx
      .insert(customers)
      .values(
        personas
          .filter((p) => p.role === "customer")
          .map((p) => ({ id: p.id, userId: p.id, merchantId: p.merchantId })),
      )
      .onConflictDoNothing();
    const fixtures = [
      {
        id: "order-1042",
        number: "NL-1042",
        customerId: "customer-maya",
        days: 9,
        merchantId: "northline",
      },
      {
        id: "order-1031",
        number: "NL-1031",
        customerId: "customer-maya",
        days: 35,
        merchantId: "northline",
      },
      {
        id: "order-1043",
        number: "NL-1043",
        customerId: "customer-leo",
        days: 5,
        merchantId: "northline",
      },
      {
        id: "order-other",
        number: "OT-2001",
        customerId: "customer-other",
        days: 4,
        merchantId: "other-store",
      },
    ];
    for (const fixture of fixtures) {
      await tx
        .insert(orders)
        .values({
          id: fixture.id,
          number: fixture.number,
          merchantId: fixture.merchantId,
          customerId: fixture.customerId,
          paymentRef: `payment-${fixture.id}`,
          capturedMinor: 15500,
          deliveredAt: new Date(Date.parse(DEMO_NOW) - fixture.days * 86400000).toISOString(),
        })
        .onConflictDoNothing();
      const lines = [
        {
          id: `${fixture.id}-tee`,
          orderId: fixture.id,
          name: "Heavyweight cotton tee",
          variant: "Washed indigo / M",
          quantity: 3,
          netMinor: 10500,
        },
        {
          id: `${fixture.id}-cap`,
          orderId: fixture.id,
          name: "Canvas field cap",
          variant: "Stone / One size",
          quantity: 1,
          netMinor: 5000,
        },
      ];
      await tx.insert(orderLines).values(lines).onConflictDoNothing();
      for (const line of lines) {
        await tx
          .insert(orderUnits)
          .values(
            Array.from({ length: line.quantity }, (_, index) => ({
              id: `${line.id}:${index + 1}`,
              lineId: line.id,
              position: index + 1,
              netMinor:
                Math.floor(line.netMinor / line.quantity) +
                (index < line.netMinor % line.quantity ? 1 : 0),
            })),
          )
          .onConflictDoNothing();
      }
    }
  });
}
