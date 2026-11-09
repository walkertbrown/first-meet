CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lifter_id" uuid NOT NULL,
	"meet_id" uuid NOT NULL,
	"lift" text NOT NULL,
	"number" smallint NOT NULL,
	"weight" real NOT NULL,
	"reps_declared" smallint,
	"rep_lights" jsonb,
	"score" real,
	"command_times" jsonb,
	"poses_key" text,
	"status" text DEFAULT 'declared' NOT NULL,
	"video_key" text,
	"recorded_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone,
	"judged_at" timestamp with time zone,
	"call" text,
	"lights" jsonb,
	"reason" text,
	"measures" jsonb,
	"judged_frame_ms" integer,
	"clip_key" text,
	"clip_status" text,
	"referee_id" uuid,
	"spot_checked" boolean DEFAULT false NOT NULL,
	"is_sample_clip" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"meet_id" uuid NOT NULL,
	"lifter_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "awards_meet_id_lifter_id_kind_pk" PRIMARY KEY("meet_id","lifter_id","kind")
);
--> statement-breakpoint
CREATE TABLE "cheers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"from_lifter_id" uuid,
	"from_corner_name" text,
	"to_lifter_id" uuid NOT NULL,
	"attempt_id" uuid,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"attempt_id" uuid,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "flight_hour_votes" (
	"flight_id" uuid NOT NULL,
	"lifter_id" uuid NOT NULL,
	"slot" smallint NOT NULL,
	CONSTRAINT "flight_hour_votes_flight_id_lifter_id_pk" PRIMARY KEY("flight_id","lifter_id")
);
--> statement-breakpoint
CREATE TABLE "flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meet_id" uuid NOT NULL,
	"division" text NOT NULL,
	"block_start" date,
	"number" integer NOT NULL,
	"flight_hour" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "judge_queue" (
	"attempt_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requeued" boolean DEFAULT false NOT NULL,
	"next_try_at" timestamp with time zone DEFAULT now() NOT NULL,
	"worker_id" text,
	"leased_until" timestamp with time zone,
	"clip_seconds" real DEFAULT 30 NOT NULL,
	"started_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "judge_queue_attempt_id_kind_pk" PRIMARY KEY("attempt_id","kind")
);
--> statement-breakpoint
CREATE TABLE "judge_workers" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"attempts_done" integer DEFAULT 0 NOT NULL,
	"ended_at" timestamp with time zone,
	"idle_at" timestamp with time zone,
	"commit" text,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "judged_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"lifter_id" uuid NOT NULL,
	"movement" text NOT NULL,
	"weight" real,
	"reps" smallint NOT NULL,
	"lights" jsonb NOT NULL,
	"all_white" boolean NOT NULL,
	"clip_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"card_name" text NOT NULL,
	"say_it" text DEFAULT '' NOT NULL,
	"birth_year" smallint,
	"age_group" text,
	"hometown" text DEFAULT '' NOT NULL,
	"why_line" text DEFAULT '' NOT NULL,
	"units" text DEFAULT 'lb' NOT NULL,
	"division" text DEFAULT 'barbell' NOT NULL,
	"bar_weight" real,
	"home_weights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"home_meet_weights" jsonb,
	"meet_id" uuid,
	"flight_id" uuid,
	"block_start" date,
	"paid_meet_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"season_pass_until" date,
	"free_entry_credit" boolean DEFAULT false NOT NULL,
	"clip_visibility" text DEFAULT 'judges' NOT NULL,
	"corner_token" text,
	"card_token" text,
	"readiness_answers" jsonb,
	"readiness_ok_at" timestamp with time zone,
	"waiver_ok_at" timestamp with time zone,
	"reminders" boolean DEFAULT true NOT NULL,
	"motion" text DEFAULT 'system' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"sound" boolean DEFAULT true NOT NULL,
	"is_referee" boolean DEFAULT false NOT NULL,
	"is_host" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "lifters_email_unique" UNIQUE("email"),
	CONSTRAINT "lifters_corner_token_unique" UNIQUE("corner_token"),
	CONSTRAINT "lifters_card_token_unique" UNIQUE("card_token")
);
--> statement-breakpoint
CREATE TABLE "meets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"live_at" timestamp with time zone,
	"kind" text NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"stream_video_id" text,
	"stream_started_at" timestamp with time zone,
	"replay_video_id" text,
	"live_minutes" integer DEFAULT 60 NOT NULL,
	"rollcall_rows" smallint DEFAULT 1 NOT NULL,
	CONSTRAINT "meets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "readouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meet_id" uuid NOT NULL,
	"lifter_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"stream_offset_s" real
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"referee_id" uuid,
	"lights" jsonb,
	"reason" text,
	"note" text,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lifter_id" uuid NOT NULL,
	"week" smallint NOT NULL,
	"day" text NOT NULL,
	"scheduled_for" date,
	"started_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"hurt" text,
	"skipped_film" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"movement" text NOT NULL,
	"set_no" smallint NOT NULL,
	"weight" real,
	"reps_target" smallint,
	"reps_done" smallint,
	"feel" text
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_lifter_id_lifters_id_fk" FOREIGN KEY ("lifter_id") REFERENCES "lifters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_meet_id_meets_id_fk" FOREIGN KEY ("meet_id") REFERENCES "meets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_referee_id_lifters_id_fk" FOREIGN KEY ("referee_id") REFERENCES "lifters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_meet_id_meets_id_fk" FOREIGN KEY ("meet_id") REFERENCES "meets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_lifter_id_lifters_id_fk" FOREIGN KEY ("lifter_id") REFERENCES "lifters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheers" ADD CONSTRAINT "cheers_from_lifter_id_lifters_id_fk" FOREIGN KEY ("from_lifter_id") REFERENCES "lifters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheers" ADD CONSTRAINT "cheers_to_lifter_id_lifters_id_fk" FOREIGN KEY ("to_lifter_id") REFERENCES "lifters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheers" ADD CONSTRAINT "cheers_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheers" ADD CONSTRAINT "cheers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_hour_votes" ADD CONSTRAINT "flight_hour_votes_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_hour_votes" ADD CONSTRAINT "flight_hour_votes_lifter_id_lifters_id_fk" FOREIGN KEY ("lifter_id") REFERENCES "lifters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_meet_id_meets_id_fk" FOREIGN KEY ("meet_id") REFERENCES "meets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_queue" ADD CONSTRAINT "judge_queue_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judged_sets" ADD CONSTRAINT "judged_sets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judged_sets" ADD CONSTRAINT "judged_sets_lifter_id_lifters_id_fk" FOREIGN KEY ("lifter_id") REFERENCES "lifters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifters" ADD CONSTRAINT "lifters_meet_id_meets_id_fk" FOREIGN KEY ("meet_id") REFERENCES "meets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifters" ADD CONSTRAINT "lifters_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readouts" ADD CONSTRAINT "readouts_meet_id_meets_id_fk" FOREIGN KEY ("meet_id") REFERENCES "meets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readouts" ADD CONSTRAINT "readouts_lifter_id_lifters_id_fk" FOREIGN KEY ("lifter_id") REFERENCES "lifters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_referee_id_lifters_id_fk" FOREIGN KEY ("referee_id") REFERENCES "lifters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_lifter_id_lifters_id_fk" FOREIGN KEY ("lifter_id") REFERENCES "lifters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_one_per_number" ON "attempts" USING btree ("lifter_id","meet_id","lift","number");--> statement-breakpoint
CREATE INDEX "attempts_status" ON "attempts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "cheers_one_per_sender" ON "cheers" USING btree ("to_lifter_id",coalesce("from_lifter_id"::text, "from_corner_name"),coalesce("attempt_id", "session_id"));--> statement-breakpoint
CREATE INDEX "events_kind_at" ON "events" USING btree ("kind","at");--> statement-breakpoint
CREATE INDEX "judge_queue_waiting" ON "judge_queue" USING btree ("kind","next_try_at") WHERE "judge_queue"."worker_id" is null;--> statement-breakpoint
CREATE INDEX "judge_workers_alive" ON "judge_workers" USING btree ("ended_at");--> statement-breakpoint
CREATE INDEX "judged_sets_lifter" ON "judged_sets" USING btree ("lifter_id","movement");--> statement-breakpoint
CREATE INDEX "lifters_demo_created" ON "lifters" USING btree ("is_demo","created_at");--> statement-breakpoint
CREATE INDEX "reviews_attempt" ON "reviews" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "sessions_lifter" ON "sessions" USING btree ("lifter_id","week","day");