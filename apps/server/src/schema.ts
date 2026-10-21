import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

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
    role: text({ enum: ["customer", "support", "warehouse", "finance"] }).notNull(),
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
