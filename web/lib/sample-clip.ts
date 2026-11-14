// Which sample clip stood in for an attempt, and its saved judged frame (samples.json). Its own module so
// the queue (which saves a sample's frame, item 95) and the demo (which logs the runs) can both use it.
import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { events, type Lift } from '@/db/schema';
import samples from '../../content/samples/samples.json';

export type SampleClip = { id: string; kind: 'good' | 'no' | 'close'; file: string; credit: string; judged_frame_ms?: number; meet?: { lift: Lift; reps: number; command_times: Record<string, number> } };
export const CLIPS = samples.clips as SampleClip[];
/** A sample's known judged frame (samples.json), by its id. */
export const sampleJudgedMs = (id: string) => CLIPS.find(c => c.id === id)?.judged_frame_ms ?? null;

/**
 * Which sample stood in for an attempt (5.36), from its demo run: a reload or "Back to the platform"
 * keeps the SAMPLE LIFT box and the credit. Null for a filmed lift.
 */
export async function sampleOfAttempt(db: Db, attemptId: string, commandTimes?: Record<string, number> | null): Promise<{ id: string; credit: string; reps: number } | null> {
  const [row] = await db.select({ detail: events.detail }).from(events)
    .where(sql`${events.attemptId} = ${attemptId} and ${events.kind} = 'demo_run' and (${events.detail}->>'sample')::boolean`)
    .orderBy(sql`${events.at} desc`).limit(1);
  const id = (row?.detail as { clip?: string } | undefined)?.clip;
  // a run from before the clip was noted: the clip whose stored command times it was given
  const same = (a: Record<string, number> | undefined, b: Record<string, number> | null | undefined) =>
    !!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);
  const clip = id ? CLIPS.find(c => c.id === id) : CLIPS.find(c => same(c.meet?.command_times, commandTimes));
  return clip ? { id: clip.id, credit: clip.credit, reps: clip.meet?.reps ?? 1 } : null;
}
