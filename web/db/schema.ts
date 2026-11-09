// The data (plan 3.2), in Postgres through Drizzle. Migrations are made from this file
// (`npx drizzle-kit generate`) into web/db/migrations/ and run when the web service starts.
// Weights are in her units; times are UTC.
import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, date, index, integer, jsonb, pgTable, primaryKey, real, smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const at = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => at('created_at').notNull().defaultNow();

export type Lift = 'squat' | 'bench' | 'deadlift';
export type Division = 'barbell' | 'home';
export type Light = 'white' | 'red';
export type RepLight = { call: 'white' | 'red' | 'close'; reason: string | null; frame_ms?: number };

export const meets = pgTable('meets', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  opensAt: at('opens_at'),
  closesAt: at('closes_at'),
  liveAt: at('live_at'),
  kind: text('kind').$type<'real' | 'demo' | 'sample'>().notNull(),
  status: text('status').$type<'upcoming' | 'open' | 'closed' | 'final'>().notNull().default('upcoming'),
  streamVideoId: text('stream_video_id'),
  streamStartedAt: at('stream_started_at'),
  replayVideoId: text('replay_video_id'),
  liveMinutes: integer('live_minutes').notNull().default(60),
  rollcallRows: smallint('rollcall_rows').notNull().default(1),
  /** The Monday (Eastern) its 12-week block starts (plan 3.2, item 76): the closed page, 5.8, 5.32. */
  blockStartsOn: date('block_starts_on', { mode: 'string' }),
});

export type HomeWeight = { weight: number; kind: 'pair' | 'bell' };

export const lifters = pgTable('lifters', {
  id: id(),
  // unique and lower-case; null for a demo lifter
  email: text('email').unique(),
  cardName: text('card_name').notNull(),
  sayIt: text('say_it').notNull().default(''),
  birthYear: smallint('birth_year'),
  ageGroup: text('age_group'),
  hometown: text('hometown').notNull().default(''),
  whyLine: text('why_line').notNull().default(''),
  units: text('units').$type<'lb' | 'kg'>().notNull().default('lb'),
  division: text('division').$type<Division>().notNull().default('barbell'),
  barWeight: real('bar_weight'),
  homeWeights: jsonb('home_weights').$type<HomeWeight[]>().notNull().default([]),
  homeMeetWeights: jsonb('home_meet_weights').$type<Partial<Record<Lift, number>>>(),
  meetId: uuid('meet_id').references(() => meets.id),
  flightId: uuid('flight_id').references(() => flights.id),
  blockStart: date('block_start'),
  paidMeetIds: uuid('paid_meet_ids').array().notNull().default(sql`'{}'::uuid[]`),
  seasonPassUntil: date('season_pass_until'),
  freeEntryCredit: boolean('free_entry_credit').notNull().default(false),
  clipVisibility: text('clip_visibility').$type<'judges' | 'flight' | 'link'>().notNull().default('judges'),
  cornerToken: text('corner_token').unique(),
  cardToken: text('card_token').unique(),
  readinessAnswers: jsonb('readiness_answers'),
  readinessOkAt: at('readiness_ok_at'),
  waiverOkAt: at('waiver_ok_at'),
  reminders: boolean('reminders').notNull().default(true),
  motion: text('motion').$type<'system' | 'off' | 'on'>().notNull().default('system'),
  theme: text('theme').$type<'system' | 'day' | 'lights_down'>().notNull().default('system'),
  sound: boolean('sound').notNull().default(true),
  isReferee: boolean('is_referee').notNull().default(false),
  isHost: boolean('is_host').notNull().default(false),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: createdAt(),
  deletedAt: at('deleted_at'),
}, t => [index('lifters_demo_created').on(t.isDemo, t.createdAt)]);

export const flights = pgTable('flights', {
  id: id(),
  meetId: uuid('meet_id').notNull().references(() => meets.id),
  division: text('division').$type<Division>().notNull(),
  blockStart: date('block_start'),
  number: integer('number').notNull(),
  flightHour: at('flight_hour'),
});

export const flightHourVotes = pgTable('flight_hour_votes', {
  flightId: uuid('flight_id').notNull().references(() => flights.id),
  lifterId: uuid('lifter_id').notNull().references(() => lifters.id, { onDelete: 'cascade' }),
  slot: smallint('slot').notNull(),
}, t => [primaryKey({ columns: [t.flightId, t.lifterId] })]);

export const sessions = pgTable('sessions', {
  id: id(),
  lifterId: uuid('lifter_id').notNull().references(() => lifters.id, { onDelete: 'cascade' }),
  week: smallint('week').notNull(),
  day: text('day').$type<'A' | 'B' | 'C'>().notNull(),
  scheduledFor: date('scheduled_for'),
  startedAt: at('started_at'),
  doneAt: at('done_at'),
  hurt: text('hurt').$type<'none' | 'knee' | 'back' | 'shoulder' | 'hip_or_wrist' | 'other'>(),
  skippedFilm: boolean('skipped_film').notNull().default(false),
}, t => [index('sessions_lifter').on(t.lifterId, t.week, t.day)]);

export const sets = pgTable('sets', {
  id: id(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  movement: text('movement').notNull(),
  setNo: smallint('set_no').notNull(),
  weight: real('weight'),
  repsTarget: smallint('reps_target'),
  repsDone: smallint('reps_done'),
  // "feel" lives here, per movement (3.2 sessions)
  feel: text('feel').$type<'easy' | 'right' | 'hard'>(),
});

export const judgedSets = pgTable('judged_sets', {
  id: id(),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
  lifterId: uuid('lifter_id').notNull().references(() => lifters.id, { onDelete: 'cascade' }),
  movement: text('movement').notNull(),
  weight: real('weight'),
  reps: smallint('reps').notNull(),
  lights: jsonb('lights').$type<RepLight[]>().notNull(),
  allWhite: boolean('all_white').notNull(),
  clipKey: text('clip_key'),
  createdAt: createdAt(),
}, t => [index('judged_sets_lifter').on(t.lifterId, t.movement)]);

export type AttemptStatus = 'declared' | 'recording' | 'uploading' | 'queued' | 'judging' | 'close_call' | 'judged' | 'void';

export const attempts = pgTable('attempts', {
  id: id(),
  lifterId: uuid('lifter_id').notNull().references(() => lifters.id, { onDelete: 'cascade' }),
  meetId: uuid('meet_id').notNull().references(() => meets.id),
  lift: text('lift').$type<Lift>().notNull(),
  number: smallint('number').notNull(),
  weight: real('weight').notNull(),
  repsDeclared: smallint('reps_declared'),
  repLights: jsonb('rep_lights').$type<RepLight[]>(),
  score: real('score'),
  commandTimes: jsonb('command_times').$type<Record<string, number>>(),
  posesKey: text('poses_key'),
  status: text('status').$type<AttemptStatus>().notNull().default('declared'),
  videoKey: text('video_key'),
  recordedAt: at('recorded_at'),
  uploadedAt: at('uploaded_at'),
  judgedAt: at('judged_at'),
  call: text('call').$type<'white' | 'red' | 'close'>(),
  lights: jsonb('lights').$type<Light[]>(),
  reason: text('reason'),
  measures: jsonb('measures').$type<Record<string, unknown>>(),
  judgedFrameMs: integer('judged_frame_ms'),
  clipKey: text('clip_key'),
  clipStatus: text('clip_status'),
  refereeId: uuid('referee_id').references(() => lifters.id),
  spotChecked: boolean('spot_checked').notNull().default(false),
  isSampleClip: boolean('is_sample_clip').notNull().default(false),
  createdAt: createdAt(),
}, t => [
  uniqueIndex('attempts_one_per_number').on(t.lifterId, t.meetId, t.lift, t.number),
  index('attempts_status').on(t.status),
]);

export const reviews = pgTable('reviews', {
  id: id(),
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  // null for the demo referee: a demo lifter deciding their own close call (5.36)
  refereeId: uuid('referee_id').references(() => lifters.id),
  lights: jsonb('lights').$type<Light[]>(),
  reason: text('reason'),
  note: text('note'),
  kind: text('kind').$type<'close_call' | 'second_opinion' | 'spot_check'>().notNull(),
  createdAt: createdAt(),
}, t => [index('reviews_attempt').on(t.attemptId)]);

export const cheers = pgTable('cheers', {
  id: id(),
  kind: text('kind').$type<'white_lights' | 'strong' | 'got_this' | 'see_you'>().notNull(),
  fromLifterId: uuid('from_lifter_id').references(() => lifters.id, { onDelete: 'cascade' }),
  fromCornerName: text('from_corner_name'),
  toLifterId: uuid('to_lifter_id').notNull().references(() => lifters.id, { onDelete: 'cascade' }),
  attemptId: uuid('attempt_id').references(() => attempts.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  /** when a banner showed it to her (5.24, item 80); empty ones show when she next opens the platform */
  seenAt: at('seen_at'),
}, t => [
  // one cheer per sender per attempt or session
  uniqueIndex('cheers_one_per_sender').on(t.toLifterId, sql`coalesce(${t.fromLifterId}::text, ${t.fromCornerName})`, sql`coalesce(${t.attemptId}, ${t.sessionId})`),
]);

export const readouts = pgTable('readouts', {
  id: id(),
  meetId: uuid('meet_id').notNull().references(() => meets.id),
  lifterId: uuid('lifter_id').notNull().references(() => lifters.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'read' | 'rollcall'>().notNull(),
  at: at('at').notNull().defaultNow(),
  streamOffsetS: real('stream_offset_s'),
});

export const judgeQueue = pgTable('judge_queue', {
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'poses' | 'clip'>().notNull(),
  enqueuedAt: at('enqueued_at').notNull().defaultNow(),
  requeued: boolean('requeued').notNull().default(false),
  nextTryAt: at('next_try_at').notNull().defaultNow(),
  workerId: text('worker_id'),
  leasedUntil: at('leased_until'),
  clipSeconds: real('clip_seconds').notNull().default(30),
  startedAt: at('started_at'),
  lastError: text('last_error'),
}, t => [
  primaryKey({ columns: [t.attemptId, t.kind] }),
  index('judge_queue_waiting').on(t.kind, t.nextTryAt).where(sql`${t.workerId} is null`),
]);

export const judgeWorkers = pgTable('judge_workers', {
  workerId: text('worker_id').primaryKey(),
  runId: text('run_id'),
  startedAt: at('started_at').notNull().defaultNow(),
  lastSeenAt: at('last_seen_at'),
  attemptsDone: integer('attempts_done').notNull().default(0),
  endedAt: at('ended_at'),
  // when it last asked and got nothing (204); "idle" = that was within the last 2 s (3.9)
  idleAt: at('idle_at'),
  commit: text('commit'),
  // when the dispatcher last asked Render about a worker that hasn't shown up
  checkedAt: at('checked_at'),
}, t => [index('judge_workers_alive').on(t.endedAt)]);

export const awards = pgTable('awards', {
  meetId: uuid('meet_id').notNull().references(() => meets.id),
  lifterId: uuid('lifter_id').notNull().references(() => lifters.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
}, t => [primaryKey({ columns: [t.meetId, t.lifterId, t.kind] })]);

export const emailTokens = pgTable('email_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  email: text('email').notNull(),
  expiresAt: at('expires_at').notNull(),
  usedAt: at('used_at'),
});

export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: at('at').notNull().defaultNow(),
  kind: text('kind').notNull(),
  attemptId: uuid('attempt_id'),
  detail: jsonb('detail').$type<Record<string, unknown>>(),
}, t => [index('events_kind_at').on(t.kind, t.at)]);
