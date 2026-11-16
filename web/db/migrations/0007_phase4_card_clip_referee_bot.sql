CREATE TABLE "referee_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'lamps' NOT NULL,
	"attempt_id" uuid,
	"lifter_id" uuid,
	"status" text DEFAULT 'waiting_frames' NOT NULL,
	"frames" jsonb,
	"frames_ready_at" timestamp with time zone,
	"worker_id" text,
	"lease_until" timestamp with time zone,
	"tries" integer DEFAULT 0 NOT NULL,
	"first_error_at" timestamp with time zone,
	"last_error" text,
	"doubt_reason" text,
	"calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"test_answers" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "clip_shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "by_bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "lamp_notes" jsonb;--> statement-breakpoint
ALTER TABLE "referee_jobs" ADD CONSTRAINT "referee_jobs_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_jobs" ADD CONSTRAINT "referee_jobs_lifter_id_lifters_id_fk" FOREIGN KEY ("lifter_id") REFERENCES "lifters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referee_jobs_ready" ON "referee_jobs" USING btree ("status","frames_ready_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referee_jobs_one_open" ON "referee_jobs" USING btree ("attempt_id","kind") WHERE "referee_jobs"."status" in ('waiting_frames', 'ready', 'running');