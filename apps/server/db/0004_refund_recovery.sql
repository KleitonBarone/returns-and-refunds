CREATE TABLE "provider_event_receipts" (
	"provider" text NOT NULL,
	"event_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "provider_event_receipts_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
ALTER TABLE "refund_operations" ADD COLUMN "last_lookup" text;--> statement-breakpoint
ALTER TABLE "refund_operations" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_event_receipts" ADD CONSTRAINT "provider_event_receipts_operation_id_refund_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."refund_operations"("id") ON DELETE no action ON UPDATE no action;