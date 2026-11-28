ALTER TABLE "attempts" ADD COLUMN "clip_card_hash" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "clip_sent_hash" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "clip_remake_failed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "judge_queue" ADD COLUMN "remake" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "judge_queue" ADD COLUMN "card_hash" text;