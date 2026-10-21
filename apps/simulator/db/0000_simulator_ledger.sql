CREATE TABLE "captures" (
	"merchant_id" text NOT NULL,
	"payment_ref" text NOT NULL,
	"captured_minor" integer NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "captures_merchant_id_payment_ref_pk" PRIMARY KEY("merchant_id","payment_ref"),
	CONSTRAINT "positive_capture" CHECK ("captures"."captured_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "controls" (
	"merchant_id" text NOT NULL,
	"payment_ref" text NOT NULL,
	"mode" text NOT NULL,
	"failures_remaining" integer DEFAULT 0 NOT NULL,
	"response_delay_ms" integer DEFAULT 0 NOT NULL,
	"event_delay_ms" integer DEFAULT 0 NOT NULL,
	"event_copies" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "controls_merchant_id_payment_ref_pk" PRIMARY KEY("merchant_id","payment_ref")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"last_status" integer
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"refund_id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"payment_ref" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "positive_ledger_entry" CHECK ("ledger"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "simulator_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"disposable" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulator_refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"payment_ref" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"failure_code" text,
	CONSTRAINT "simulator_refunds_merchantId_idempotencyKey_unique" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "positive_refund" CHECK ("simulator_refunds"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_merchant_id_payment_ref_captures_merchant_id_payment_ref_fk" FOREIGN KEY ("merchant_id","payment_ref") REFERENCES "public"."captures"("merchant_id","payment_ref") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_refund_id_simulator_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."simulator_refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_refund_id_simulator_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."simulator_refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulator_refunds" ADD CONSTRAINT "simulator_refunds_merchant_id_payment_ref_captures_merchant_id_payment_ref_fk" FOREIGN KEY ("merchant_id","payment_ref") REFERENCES "public"."captures"("merchant_id","payment_ref") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "due_deliveries" ON "deliveries" USING btree ("run_at") WHERE "deliveries"."delivered_at" is null;