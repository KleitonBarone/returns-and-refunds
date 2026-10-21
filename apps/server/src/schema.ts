import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { refundStates, returnStates, roles } from "../../../packages/contracts/src/index.ts";
import type { ProviderEvent, ProviderReceipt } from "../../../packages/contracts/src/payment.ts";

export const environmentIdentity = pgTable("environment_identity", {
  id: text().primaryKey(),
  runId: text().notNull(),
  disposable: integer().notNull(),
});
export const merchants = pgTable("merchants", { id: text().primaryKey(), name: text().notNull() });
export const users = pgTable("users", { id: text().primaryKey(), name: text().notNull() });
export const memberships = pgTable(
  "memberships",
  {
    merchantId: text()
      .notNull()
      .references(() => merchants.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    role: text({ enum: roles }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.merchantId, t.userId] })],
);
export const customers = pgTable(
  "customers",
  {
    id: text().primaryKey(),
    merchantId: text()
      .notNull()
      .references(() => merchants.id),
    userId: text()
      .notNull()
      .references(() => users.id),
  },
  (t) => [unique().on(t.id, t.merchantId), unique().on(t.merchantId, t.userId)],
);
export const orders = pgTable(
  "orders",
  {
    id: text().primaryKey(),
    number: text().notNull(),
    merchantId: text()
      .notNull()
      .references(() => merchants.id),
    customerId: text().notNull(),
    paymentRef: text().notNull().unique(),
    capturedMinor: integer().notNull(),
    currency: text().notNull().default("USD"),
    deliveredAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.customerId, t.merchantId],
      foreignColumns: [customers.id, customers.merchantId],
    }),
    check("positive_capture", sql`${t.capturedMinor} > 0`),
    check("currency_code", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);
export const orderLines = pgTable(
  "order_lines",
  {
    id: text().primaryKey(),
    orderId: text()
      .notNull()
      .references(() => orders.id),
    name: text().notNull(),
    variant: text().notNull(),
    quantity: integer().notNull(),
    netMinor: integer().notNull(),
  },
  (t) => [
    check("positive_quantity", sql`${t.quantity} > 0`),
    check("nonnegative_line", sql`${t.netMinor} >= 0`),
  ],
);
export const orderUnits = pgTable(
  "order_units",
  {
    id: text().primaryKey(),
    lineId: text()
      .notNull()
      .references(() => orderLines.id),
    position: integer().notNull(),
    netMinor: integer().notNull(),
    consumed: integer().notNull().default(0),
  },
  (t) => [unique().on(t.lineId, t.position), check("nonnegative_unit", sql`${t.netMinor} >= 0`)],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text().primaryKey(),
    userId: text().notNull(),
    merchantId: text().notNull(),
    expiresAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.userId],
      foreignColumns: [memberships.merchantId, memberships.userId],
    }),
  ],
);
export const returnState = pgEnum("return_state", returnStates);
export const returnRequests = pgTable(
  "return_requests",
  {
    id: text().primaryKey(),
    orderId: text()
      .notNull()
      .references(() => orders.id),
    merchantId: text()
      .notNull()
      .references(() => merchants.id),
    customerId: text()
      .notNull()
      .references(() => customers.id),
    requestKey: text().notNull(),
    fingerprint: text().notNull(),
    reason: text().notNull(),
    status: returnState().notNull().default("requested"),
    closureReason: text(),
    amountMinor: integer().notNull(),
    currency: text().notNull(),
    requestedAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
    deadline: timestamp({ withTimezone: true, mode: "string" }).notNull(),
    policyVersion: text().notNull(),
  },
  (t) => [
    unique().on(t.customerId, t.requestKey),
    check("positive_return_amount", sql`${t.amountMinor} > 0`),
  ],
);
export const returnUnits = pgTable(
  "return_units",
  {
    returnId: text()
      .notNull()
      .references(() => returnRequests.id),
    unitId: text()
      .notNull()
      .references(() => orderUnits.id),
    amountMinor: integer().notNull(),
    active: boolean().notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.returnId, t.unitId] }),
    uniqueIndex("one_active_claim_per_unit").on(t.unitId).where(sql`${t.active} = true`),
  ],
);
export const refundState = pgEnum("refund_state", refundStates);
export const refundOperations = pgTable(
  "refund_operations",
  {
    id: uuid().primaryKey(),
    returnId: text()
      .notNull()
      .unique()
      .references(() => returnRequests.id),
    orderId: text()
      .notNull()
      .references(() => orders.id),
    merchantId: text()
      .notNull()
      .references(() => merchants.id),
    createdBy: text()
      .notNull()
      .references(() => users.id),
    correlationId: uuid().notNull(),
    paymentRef: text().notNull(),
    idempotencyKey: text().notNull().unique(),
    fingerprint: text().notNull(),
    amountMinor: integer().notNull(),
    currency: text().notNull(),
    status: refundState().notNull().default("pending"),
    lastError: text(),
    lastLookup: text({ enum: ["found", "not_found", "unavailable"] }),
    checkedAt: timestamp({ withTimezone: true, mode: "string" }),
    requestedAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [check("positive_refund_operation", sql`${t.amountMinor} > 0`)],
);
export const refundReceipts = pgTable("refund_receipts", {
  operationId: uuid()
    .primaryKey()
    .references(() => refundOperations.id),
  providerId: uuid().notNull().unique(),
  receipt: jsonb().$type<ProviderReceipt>().notNull(),
  observedAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
});
export const providerEventReceipts = pgTable(
  "provider_event_receipts",
  {
    provider: text().notNull(),
    eventId: uuid().notNull(),
    operationId: uuid()
      .notNull()
      .references(() => refundOperations.id),
    payloadHash: text().notNull(),
    payload: jsonb().$type<ProviderEvent>().notNull(),
    outcome: text({ enum: ["applied", "ignored", "reconciled"] }).notNull(),
    receivedAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
);
export const refundJobs = pgTable(
  "refund_jobs",
  {
    operationId: uuid()
      .primaryKey()
      .references(() => refundOperations.id),
    runAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
    leaseToken: uuid(),
    leaseUntil: timestamp({ withTimezone: true, mode: "string" }),
    attempts: integer().notNull().default(0),
    completedAt: timestamp({ withTimezone: true, mode: "string" }),
  },
  (t) => [index("due_refund_jobs").on(t.runAt).where(sql`${t.completedAt} is null`)],
);
export const refundAttempts = pgTable("refund_attempts", {
  id: uuid().primaryKey(),
  operationId: uuid()
    .notNull()
    .references(() => refundOperations.id),
  leaseToken: uuid().notNull().unique(),
  startedAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  finishedAt: timestamp({ withTimezone: true, mode: "string" }),
  outcome: text({
    enum: [
      "started",
      "abandoned",
      "fenced",
      "retryable",
      "unknown",
      "processing",
      "succeeded",
      "failed",
    ],
  }).notNull(),
  message: text(),
});
export const workerHeartbeat = pgTable("worker_heartbeat", {
  id: text().primaryKey(),
  runId: text().notNull(),
  pid: integer().notNull(),
  lastSeenAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
});
export const auditEntries = pgTable("audit_entries", {
  id: text().primaryKey(),
  sequence: integer().generatedAlwaysAsIdentity(),
  correlationId: uuid().notNull().defaultRandom(),
  operationId: uuid().references(() => refundOperations.id),
  refundFromStatus: refundState(),
  refundToStatus: refundState(),
  returnId: text()
    .notNull()
    .references(() => returnRequests.id),
  merchantId: text()
    .notNull()
    .references(() => merchants.id),
  actorId: text()
    .notNull()
    .references(() => users.id),
  event: text().notNull(),
  reason: text().notNull(),
  fromStatus: text(),
  toStatus: text().notNull(),
  at: timestamp({ withTimezone: true, mode: "string" }).notNull(),
});
export const returnReviews = pgTable(
  "return_reviews",
  {
    returnId: text()
      .notNull()
      .references(() => returnRequests.id),
    kind: text({ enum: ["decision", "inspection"] }).notNull(),
    outcome: text({ enum: ["approved", "rejected", "passed", "failed"] }).notNull(),
    reason: text().notNull(),
    actorId: text()
      .notNull()
      .references(() => users.id),
    at: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.returnId, t.kind] }),
    check(
      "review_outcome_matches_kind",
      sql`(${t.kind} = 'decision' and ${t.outcome} in ('approved', 'rejected')) or (${t.kind} = 'inspection' and ${t.outcome} in ('passed', 'failed'))`,
    ),
  ],
);
