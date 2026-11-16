ALTER TABLE "attempts" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "meets" ADD COLUMN "clip_deadline_at" timestamp with time zone;--> statement-breakpoint
UPDATE "meets" SET "clip_deadline_at" = "closes_at" + interval '6 hours' WHERE "kind" IN ('real', 'test') AND "closes_at" IS NOT NULL AND "clip_deadline_at" IS NULL;