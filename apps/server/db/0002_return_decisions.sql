CREATE TABLE "return_reviews" (
	"return_id" text NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "return_reviews_return_id_kind_pk" PRIMARY KEY("return_id","kind"),
	CONSTRAINT "review_outcome_matches_kind" CHECK (("return_reviews"."kind" = 'decision' and "return_reviews"."outcome" in ('approved', 'rejected')) or ("return_reviews"."kind" = 'inspection' and "return_reviews"."outcome" in ('passed', 'failed')))
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "sequence" integer NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "audit_entries_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "return_requests" ADD COLUMN "closure_reason" text;--> statement-breakpoint
ALTER TABLE "return_reviews" ADD CONSTRAINT "return_reviews_return_id_return_requests_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."return_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_reviews" ADD CONSTRAINT "return_reviews_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;