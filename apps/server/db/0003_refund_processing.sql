CREATE TYPE "public"."refund_state" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'unknown');--> statement-breakpoint
CREATE TABLE "refund_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"lease_token" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text NOT NULL,
	"message" text,
	CONSTRAINT "refund_attempts_leaseToken_unique" UNIQUE("lease_token")
);
--> statement-breakpoint
CREATE TABLE "refund_jobs" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refund_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"return_id" text NOT NULL,
	"order_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"created_by" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"payment_ref" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "refund_state" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"requested_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "refund_operations_returnId_unique" UNIQUE("return_id"),
	CONSTRAINT "refund_operations_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "positive_refund_operation" CHECK ("refund_operations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "refund_receipts" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"receipt" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "refund_receipts_providerId_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeat" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"pid" integer NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "refund_from_status" "refund_state";--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "refund_to_status" "refund_state";--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_operation_id_refund_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."refund_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_jobs" ADD CONSTRAINT "refund_jobs_operation_id_refund_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."refund_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_operations" ADD CONSTRAINT "refund_operations_return_id_return_requests_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."return_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_operations" ADD CONSTRAINT "refund_operations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_operations" ADD CONSTRAINT "refund_operations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_operations" ADD CONSTRAINT "refund_operations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_receipts" ADD CONSTRAINT "refund_receipts_operation_id_refund_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."refund_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "due_refund_jobs" ON "refund_jobs" USING btree ("run_at") WHERE "refund_jobs"."completed_at" is null;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_operation_id_refund_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."refund_operations"("id") ON DELETE no action ON UPDATE no action;