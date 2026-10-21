CREATE TYPE "public"."return_state" AS ENUM('requested', 'approved', 'received', 'inspection_passed', 'inspection_failed', 'closed');--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"return_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"event" text NOT NULL,
	"reason" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"request_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"reason" text NOT NULL,
	"status" "return_state" DEFAULT 'requested' NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"policy_version" text NOT NULL,
	CONSTRAINT "return_requests_customerId_requestKey_unique" UNIQUE("customer_id","request_key"),
	CONSTRAINT "positive_return_amount" CHECK ("return_requests"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "return_units" (
	"return_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "return_units_return_id_unit_id_pk" PRIMARY KEY("return_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_return_id_return_requests_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."return_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_units" ADD CONSTRAINT "return_units_return_id_return_requests_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."return_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_units" ADD CONSTRAINT "return_units_unit_id_order_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."order_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_merchant_id_user_id_memberships_merchant_id_user_id_fk" FOREIGN KEY ("merchant_id","user_id") REFERENCES "public"."memberships"("merchant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_claim_per_unit" ON "return_units" USING btree ("unit_id") WHERE "return_units"."active" = true;