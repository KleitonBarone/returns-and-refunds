import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { ProviderEvent } from "../../../packages/contracts/src/payment.ts";

export const simulatorIdentity = pgTable("simulator_identity", {
  id: text().primaryKey(),
  runId: text().notNull(),
  disposable: boolean().notNull(),
});
export const captures = pgTable(
  "captures",
  {
    merchantId: text().notNull(),
    paymentRef: text().notNull(),
    capturedMinor: integer().notNull(),
    currency: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.merchantId, t.paymentRef] }),
    check("positive_capture", sql`${t.capturedMinor} > 0`),
  ],
);
export const simulatorRefunds = pgTable(
  "simulator_refunds",
  {
    id: uuid().primaryKey(),
    merchantId: text().notNull(),
    paymentRef: text().notNull(),
    idempotencyKey: text().notNull(),
    fingerprint: text().notNull(),
    amountMinor: integer().notNull(),
    currency: text().notNull(),
    status: text({ enum: ["processing", "succeeded", "failed"] }).notNull(),
    failureCode: text(),
  },
  (t) => [
    unique().on(t.merchantId, t.idempotencyKey),
    foreignKey({
      columns: [t.merchantId, t.paymentRef],
      foreignColumns: [captures.merchantId, captures.paymentRef],
    }),
    check("positive_refund", sql`${t.amountMinor} > 0`),
  ],
);
export const ledger = pgTable(
  "ledger",
  {
    refundId: uuid()
      .primaryKey()
      .references(() => simulatorRefunds.id),
    merchantId: text().notNull(),
    paymentRef: text().notNull(),
    amountMinor: integer().notNull(),
    currency: text().notNull(),
    recordedAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [check("positive_ledger_entry", sql`${t.amountMinor} > 0`)],
);
export const controls = pgTable(
  "controls",
  {
    merchantId: text().notNull(),
    paymentRef: text().notNull(),
    mode: text({
      enum: ["success", "reject", "retry_once", "drop_response", "delay_response"],
    }).notNull(),
    failuresRemaining: integer().notNull().default(0),
    responseDelayMs: integer().notNull().default(0),
    eventDelayMs: integer().notNull().default(0),
    eventCopies: integer().notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.merchantId, t.paymentRef] }),
    foreignKey({
      columns: [t.merchantId, t.paymentRef],
      foreignColumns: [captures.merchantId, captures.paymentRef],
    }),
  ],
);
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid().primaryKey(),
    eventId: uuid().notNull(),
    refundId: uuid()
      .notNull()
      .references(() => simulatorRefunds.id),
    payload: jsonb().$type<ProviderEvent>().notNull(),
    runAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
    deliveredAt: timestamp({ withTimezone: true, mode: "string" }),
    attempts: integer().notNull().default(0),
    leaseToken: uuid(),
    leaseUntil: timestamp({ withTimezone: true, mode: "string" }),
    lastStatus: integer(),
  },
  (t) => [index("due_deliveries").on(t.runAt).where(sql`${t.deliveredAt} is null`)],
);
