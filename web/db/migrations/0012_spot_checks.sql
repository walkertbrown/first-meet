CREATE TABLE "spot_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meet_id" uuid NOT NULL,
	"lifter_id" uuid NOT NULL,
	"job_id" uuid,
	"bot" jsonb,
	"person" jsonb,
	"referee_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spot_checks" ADD CONSTRAINT "spot_checks_meet_id_meets_id_fk" FOREIGN KEY ("meet_id") REFERENCES "meets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_checks" ADD CONSTRAINT "spot_checks_lifter_id_lifters_id_fk" FOREIGN KEY ("lifter_id") REFERENCES "lifters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_checks" ADD CONSTRAINT "spot_checks_job_id_referee_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "referee_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_checks" ADD CONSTRAINT "spot_checks_referee_id_lifters_id_fk" FOREIGN KEY ("referee_id") REFERENCES "lifters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spot_checks_lifter" ON "spot_checks" USING btree ("lifter_id");--> statement-breakpoint
CREATE INDEX "spot_checks_meet" ON "spot_checks" USING btree ("meet_id");