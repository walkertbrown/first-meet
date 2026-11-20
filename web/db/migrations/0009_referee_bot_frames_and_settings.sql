CREATE TABLE "ops_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referee_jobs" ADD COLUMN "frames_tries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "referee_jobs" ADD COLUMN "frames_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referee_jobs" ADD COLUMN "next_try_at" timestamp with time zone;