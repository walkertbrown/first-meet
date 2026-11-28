CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lifter_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"readout_id" uuid,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"sent_at" timestamp with time zone,
	"provider_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_lifter_id_lifters_id_fk" FOREIGN KEY ("lifter_id") REFERENCES "lifters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_readout_id_readouts_id_fk" FOREIGN KEY ("readout_id") REFERENCES "readouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emails_waiting" ON "emails" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "emails_sent_at" ON "emails" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "readouts_meet_kind" ON "readouts" USING btree ("meet_id","kind");--> statement-breakpoint
CREATE INDEX "readouts_lifter_at" ON "readouts" USING btree ("lifter_id","at");