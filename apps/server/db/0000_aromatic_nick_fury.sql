CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "customers_id_merchantId_unique" UNIQUE("id","merchant_id"),
	CONSTRAINT "customers_merchantId_userId_unique" UNIQUE("merchant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "environment_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"disposable" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"merchant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "memberships_merchant_id_user_id_pk" PRIMARY KEY("merchant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"name" text NOT NULL,
	"variant" text NOT NULL,
	"quantity" integer NOT NULL,
	"net_minor" integer NOT NULL,
	CONSTRAINT "positive_quantity" CHECK ("order_lines"."quantity" > 0),
	CONSTRAINT "nonnegative_line" CHECK ("order_lines"."net_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_units" (
	"id" text PRIMARY KEY NOT NULL,
	"line_id" text NOT NULL,
	"position" integer NOT NULL,
	"net_minor" integer NOT NULL,
	"consumed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_units_lineId_position_unique" UNIQUE("line_id","position"),
	CONSTRAINT "nonnegative_unit" CHECK ("order_units"."net_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"merchant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"payment_ref" text NOT NULL,
	"captured_minor" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orders_paymentRef_unique" UNIQUE("payment_ref"),
	CONSTRAINT "positive_capture" CHECK ("orders"."captured_minor" > 0),
	CONSTRAINT "currency_code" CHECK ("orders"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_units" ADD CONSTRAINT "order_units_line_id_order_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_merchant_id_customers_id_merchant_id_fk" FOREIGN KEY ("customer_id","merchant_id") REFERENCES "public"."customers"("id","merchant_id") ON DELETE no action ON UPDATE no action;