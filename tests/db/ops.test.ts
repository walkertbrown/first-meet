// /ops (2.4, 5.39) on Postgres: the numbers, with demo attempts counted only under DEMO (5.36).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events, judgeQueue, judgeWorkers, lifters, meets } from '../../web/db/schema';
import { commitsDiffer, errorText, opsNumbers, opsSections, type OpsNumbers } from '../../web/lib/ops';
import { freshDb, URL_ } from './setup';

const BUDGETS = { runStartsPerMin: 10, cpuPerMin: 4, workersMax: 30 };

describe.skipIf(!URL_)('/ops numbers', () => {
  let db: Db, drop: () => Promise<void>;
  let n: OpsNumbers;

  beforeAll(async () => {
    ({ db, drop } = await freshDb(4));
    const [real] = await db.insert(meets).values({ slug: 'm1', name: 'Meet 1', kind: 'real', status: 'open' }).returning();
    const [demo] = await db.insert(meets).values({ slug: 'demo', name: 'Demo', kind: 'demo', status: 'open' }).returning();
    const mk = async (meetId: string, status: string, isDemo = false) => {
      const [l] = await db.insert(lifters).values({ cardName: 'L', isDemo }).returning();
      const [a] = await db.insert(attempts).values({ lifterId: l.id, meetId, lift: 'squat', number: 1, weight: 100, status: status as never }).returning();
      return a.id;
    };
    // real: two waiting (one 5 minutes old), one close call; demo: one waiting, two close calls
    const q1 = await mk(real.id, 'queued'), q2 = await mk(real.id, 'queued');
    await mk(real.id, 'close_call');
    const dq = await mk(demo.id, 'queued', true);
    await mk(demo.id, 'close_call', true); await mk(demo.id, 'close_call', true);
    await db.insert(judgeQueue).values([
      { attemptId: q1, kind: 'poses', enqueuedAt: sql`now() - interval '5 minutes'` as never },
      { attemptId: q2, kind: 'poses' },
      { attemptId: dq, kind: 'poses', enqueuedAt: sql`now() - interval '30 minutes'` as never },
      { attemptId: q2, kind: 'clip' },
    ]);
    // a real attempt judged in 20 s and 40 s, a demo one in 8 s, one real yesterday-ish (in 24 h, not 15 min)
    const judged = await mk(real.id, 'judged'), djudged = await mk(demo.id, 'judged', true);
    await db.insert(events).values([
      { kind: 'judged', attemptId: judged, detail: { upload_to_lights_s: 20, pose_secs: 6, commit: 'aaaaaaa1111' } },
      { kind: 'judged', attemptId: judged, detail: { upload_to_lights_s: 40, pose_secs: 10 } },
      { kind: 'judged', attemptId: judged, detail: { upload_to_lights_s: 100 }, at: sql`now() - interval '3 hours'` as never },
      { kind: 'judged', attemptId: djudged, detail: { upload_to_lights_s: 8, demo: true } },
      { kind: 'phone_judge_time', detail: { device: 'iPhone', poseMs: 3000 } },
      { kind: 'phone_judge_time', detail: { device: 'iPhone', poseMs: 5000 } },
      { kind: 'run_start' }, { kind: 'run_start' },
      { kind: 'run_start', at: sql`now() - interval '10 minutes'` as never },
      { kind: 'run_start_failed', detail: { status: 429, error: 'Too many requests' } },
      { kind: 'worker_failed', detail: { worker_id: 'w9', status: 'failed' } },
      { kind: 'requeued', attemptId: q1 },
      { kind: 'close_call', attemptId: q2, detail: { reason: 'judge_unavailable', why: 'no worker' } },
      { kind: 'close_call', attemptId: q2, detail: { reason: 'depth' } },
      { kind: 'demo_run', detail: { lifter_id: 'x' } }, { kind: 'demo_run', detail: { lifter_id: 'y' } },
    ]);
    await db.insert(judgeWorkers).values([
      { workerId: 'w1', attemptsDone: 3, commit: 'bbbbbbb2222' },
      { workerId: 'w2', attemptsDone: 1, endedAt: sql`now()` as never },
    ]);
    n = await opsNumbers(db, BUDGETS, 'ccccccc3333');
  });
  afterAll(async () => drop?.());

  it('QUEUE counts real attempts waiting for poses, the oldest, and close calls, leaving demo out', () => {
    expect(n.queue.waiting).toBe(2);
    expect(n.queue.oldestS).toBeGreaterThanOrEqual(299);
    expect(n.queue.oldestS).toBeLessThan(400);
    expect(n.queue.closeCalls).toBe(1);
  });

  it('SPEED: upload to lights over 15 minutes and 24 hours, real only; pose time; phone judge time by device', () => {
    expect(n.speed.lights15m).toEqual({ median: 30, p95: 39, n: 2 });
    expect(n.speed.lights24h.n).toBe(3);
    expect(n.speed.lights24h.median).toBe(40);
    expect(n.speed.poseSecsMedian).toBe(8);
    expect(n.speed.phoneByDevice).toEqual([{ device: 'iPhone', medianMs: 4000, clips: 2 }]);
  });

  it('RENDER: live workers, starts, failures, leases, 429s and attempts per worker', () => {
    expect(n.render).toMatchObject({ workersLive: 1, startedHour: 3, startsHour: 3, startsLastMin: 2, failedHour: 2, requeuedHour: 1, http429Hour: 1 });
    expect(n.render.attemptsPerWorker).toBe(2);
  });

  it('MEET counts real lifters on the platform; DEMO has its own counts', () => {
    expect(n.meet.onPlatform).toBe(2);
    expect(n.demo).toMatchObject({ runsToday: 2, waiting: 1, closeCalls: 2, onPlatform: 1, lights15mMedian: 8 });
    expect(n.demo.runsLimit).toBeGreaterThan(0);
  });

  it('errors: run starts, workers, leases and judge-unavailable close calls, newest first, never other close calls', () => {
    expect(n.errors.map(e => e.kind)).toEqual(['close_call', 'requeued', 'worker_failed', 'run_start_failed']);
    expect(n.errors[0].text).toBe("Close call, the judge couldn't run: no worker");
    expect(n.errors[3].text).toBe('Run start failed (429): Too many requests');
    expect(n.errors[1].attemptId).toBeTruthy();
  });

  it('commits: the web one passed in and the judge\'s newest, both shortened', () => {
    expect(n.commits.web).toBe('ccccccc');
    expect(['aaaaaaa', 'bbbbbbb']).toContain(n.commits.judge);
    expect(commitsDiffer(n.commits)).toBe(true);
  });

  it('the sections: QUEUE, SPEED, RENDER, MEET, DEMO, with budgets as "of" values', () => {
    const s = opsSections(n, BUDGETS);
    expect(s.map(x => x.eyebrow)).toEqual(['QUEUE', 'SPEED', 'RENDER', 'MEET', 'DEMO']);
    const row = (eyebrow: string, label: string) => s.find(x => x.eyebrow === eyebrow)!.rows.find(r => r.label === label)?.value;
    expect(row('QUEUE', 'Waiting')).toBe('2');
    expect(row('QUEUE', 'Oldest')).toBe('5 min');
    expect(row('RENDER', 'Run starts, last minute')).toBe('2 of 10');
    expect(row('RENDER', 'Run starts this hour')).toBe('3 of 600');
    expect(row('RENDER', 'CPU this hour')).toBe('6 of 240');
    expect(row('SPEED', 'Upload to lights, median, 15 min')).toBe('30.0 s');
    expect(row('SPEED', 'Phone judge time · iPhone (2 clips)')).toBe('4.0 s');
    expect(row('DEMO', 'Demo runs today')).toMatch(/^2 of \d+$/);
  });
});

describe('ops words', () => {
  it('commitsDiffer only when both commits are known and differ', () => {
    expect(commitsDiffer({ web: 'abc1234', judge: 'abc1234' })).toBe(false);
    expect(commitsDiffer({ web: 'abc1234', judge: null })).toBe(false);
    expect(commitsDiffer({ web: null, judge: 'abc1234' })).toBe(false);
    expect(commitsDiffer({ web: 'abc1234', judge: 'def5678' })).toBe(true);
  });
  it('errorText', () => {
    expect(errorText('worker_failed', { worker_id: 'w1', status: 'crashed' })).toBe('Worker w1 ended without asking for work (crashed)');
    expect(errorText('requeued', null)).toBe('A lease ran out; the attempt went back in the queue');
    expect(errorText('error', { message: 'boom' })).toBe('boom');
    expect(errorText('error', null)).toBe('error');
  });
});
