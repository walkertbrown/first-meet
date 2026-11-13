// /ops (2.4, 5.39) on Postgres. Which attempts count (2.2, item 94): lights, calls and referees count real meets
// only; the phone's lines count every real phone's filming, demo and test meets included, never a sample; the
// server's lines count every run. DEMO also has its own counts (5.36).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events, judgeQueue, judgeWorkers, lifters, meets } from '../../web/db/schema';
import { benchRows, commitsDiffer, errorText, failedOf, opsNumbers, opsSections, poseRunRows, uploadRows, type OpsNumbers } from '../../web/lib/ops';
import { freshDb, URL_ } from './setup';

const BUDGETS = { runStartsPerMin: 10, cpuPerMin: 4, workersMax: 30 };

describe.skipIf(!URL_)('/ops numbers', () => {
  let db: Db, drop: () => Promise<void>;
  let n: OpsNumbers;

  beforeAll(async () => {
    ({ db, drop } = await freshDb(4));
    const [real] = await db.insert(meets).values({ slug: 'm1', name: 'Meet 1', kind: 'real', status: 'open' }).returning();
    const [demo] = await db.insert(meets).values({ slug: 'demo', name: 'Demo', kind: 'demo', status: 'open' }).returning();
    const [test] = await db.insert(meets).values({ slug: 'test', name: 'Test', kind: 'test', status: 'open' }).returning();
    const mk = async (meetId: string, status: string, isDemo = false, isSampleClip = false) => {
      const [l] = await db.insert(lifters).values({ cardName: 'L', isDemo }).returning();
      const [a] = await db.insert(attempts).values({ lifterId: l.id, meetId, lift: 'squat', number: 1, weight: 100, status: status as never, isSampleClip }).returning();
      return a.id;
    };
    // real: two waiting (one 5 minutes old), one close call; demo: one waiting, two close calls
    const q1 = await mk(real.id, 'queued'), q2 = await mk(real.id, 'queued');
    await mk(real.id, 'close_call');
    const dq = await mk(demo.id, 'queued', true);
    await mk(demo.id, 'close_call', true); await mk(demo.id, 'close_call', true);
    // a call at the test meet and a sample's call are never a real close call
    await mk(test.id, 'close_call'); await mk(real.id, 'close_call', false, true);
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
      { kind: 'phone_judge_time', detail: { source: 'camera', device: 'iPhone', poseMs: 3000 } },
      { kind: 'phone_judge_time', detail: { source: 'camera', device: 'iPhone', poseMs: 5000 } },
      // pose run per frame (2.4): only posts with frames count; Pixel 300, 200 and 250 ms a frame, iPhone 150
      { kind: 'phone_judge_time', detail: { source: 'camera', device: 'iPhone', poseMs: 1500, frames: 10 } },
      { kind: 'phone_judge_time', detail: { source: 'camera', device: 'Pixel', poseMs: 3000, frames: 10 } },
      { kind: 'phone_judge_time', detail: { source: 'camera', device: 'Pixel', poseMs: 2000, frames: 10 } },
      { kind: 'phone_judge_time', detail: { source: 'camera', device: 'Pixel', poseMs: 5000, frames: 20 } },
      { kind: 'phone_judge_time', detail: { source: 'camera', device: 'Pixel', poseMs: 1000, frames: 0 } },
      // a sample isn't filmed on her phone: never in the phone's lines
      { kind: 'phone_judge_time', detail: { source: 'sample', device: 'iPhone', poseMs: 9000, frames: 10 } },
      { kind: 'phone_judge_time', detail: { source: 'sample', device: 'Galaxy', poseMs: 9000, frames: 10 } },
      { kind: 'run_start' }, { kind: 'run_start' },
      { kind: 'run_start', at: sql`now() - interval '10 minutes'` as never },
      { kind: 'run_start_failed', detail: { status: 429, error: 'Too many requests' } },
      { kind: 'worker_failed', detail: { worker_id: 'w9', status: 'failed' } },
      { kind: 'requeued', attemptId: q1 },
      { kind: 'close_call', attemptId: q2, detail: { reason: 'judge_unavailable', why: 'no worker' } },
      { kind: 'close_call', attemptId: q2, detail: { reason: 'depth' } },
      { kind: 'demo_run', detail: { lifter_id: 'x' } }, { kind: 'demo_run', detail: { lifter_id: 'y' } },
    ]);
    // uploads (2.4): Chrome tried 3, one refused by the server (its device from its upload); Safari
    // tried 1 and the phone turned one down before it began; one from two days ago doesn't count
    // u2 is at the test meet and u3 at the demo: a real phone's upload all the same. A sample's never counts.
    const [u1, u2, u3, u4] = [await mk(real.id, 'judged'), await mk(test.id, 'judged'), await mk(demo.id, 'judged', true), await mk(real.id, 'judged')];
    const us = await mk(demo.id, 'judged', true, true);
    const chrome = 'Chrome 142 · Android 15 Pixel 8', safari = 'Safari 18 · iPhone; CPU iPhone OS 18_1 like Mac OS X';
    await db.insert(events).values([
      { kind: 'upload_started', attemptId: u1, detail: { device: chrome } },
      { kind: 'upload_refused', attemptId: u1, detail: { why: 'too big' } },
      { kind: 'upload_started', attemptId: u2, detail: { device: chrome } },
      { kind: 'upload_started', attemptId: u3, detail: { device: chrome } },
      { kind: 'upload_started', attemptId: u4, detail: { device: safari } },
      { kind: 'upload_failed', attemptId: u4, detail: { device: safari, error: 'clip too big', before_start: true } },
      { kind: 'upload_started', attemptId: u4, detail: { device: safari }, at: sql`now() - interval '2 days'` as never },
      { kind: 'upload_started', attemptId: us, detail: { device: chrome } },
      { kind: 'upload_failed', attemptId: us, detail: { device: chrome, error: 'x' } },
    ]);
    await db.insert(judgeWorkers).values([
      { workerId: 'w1', attemptsDone: 3, commit: 'bbbbbbb2222' },
      { workerId: 'w2', attemptsDone: 1, endedAt: sql`now()` as never },
    ]);
    n = await opsNumbers(db, BUDGETS, 'ccccccc3333');
  });
  afterAll(async () => drop?.());

  it('QUEUE: the server\'s queue counts every run waiting for poses, the demo included; close calls are real meets only', () => {
    expect(n.queue.waiting).toBe(3);
    expect(n.queue.oldestS).toBeGreaterThanOrEqual(1799);
    expect(n.queue.oldestS).toBeLessThan(1900);
    expect(n.queue.closeCalls).toBe(1);
  });

  it('SPEED: upload to lights over 15 minutes and 24 hours, every run; pose time; phone judge time by device, never a sample', () => {
    expect(n.speed.lights15m).toEqual({ median: 20, p95: 38, n: 3 });
    expect(n.speed.lights24h.n).toBe(4);
    expect(n.speed.lights24h.median).toBe(30);
    expect(n.speed.poseSecsMedian).toBe(8);
    expect(n.speed.phoneByDevice).toEqual([{ device: 'Pixel', medianMs: 2500, clips: 4 }, { device: 'iPhone', medianMs: 3000, clips: 3 }]);
  });

  it('SPEED: pose run per frame, median by device, "over" past 220 ms', () => {
    expect(n.speed.poseRunByDevice).toEqual([{ device: 'Pixel', medianMs: 250, clips: 3 }, { device: 'iPhone', medianMs: 150, clips: 1 }]);
    const rows = opsSections(n, BUDGETS).find(x => x.eyebrow === 'SPEED')!.rows;
    expect(rows.filter(r => r.label.startsWith('Pose run per frame'))).toEqual([
      { label: 'Pose run per frame · Pixel (3 clips)', value: '250 ms', over: true },
      { label: 'Pose run per frame · iPhone (1 clip)', value: '150 ms', over: false },
    ]);
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

  it('UPLOADS: failed or refused uploads in 24 h against all uploads, by device, from every real phone and never a sample', () => {
    expect(n.uploads).toEqual([
      { device: 'Chrome 142 · Android 15 Pixel 8', tried: 3, failed: 1 },
      { device: 'Safari 18 · iPhone; CPU iPhone OS 18_1 like Mac OS X', tried: 2, failed: 1 },
    ]);
    const rows = opsSections(n, BUDGETS).find(x => x.eyebrow === 'UPLOADS')!.rows;
    expect(rows).toEqual([
      { label: 'Uploads failed or refused, 24 h', value: '2 of 5 · 40%', over: true },
      { label: 'Failed or refused · Chrome 142 · Android 15 Pixel 8', value: '1 of 3 · 33%', over: true },
      { label: 'Failed or refused · Safari 18 · iPhone; CPU iPhone OS 18_1 like Mac OS X', value: '1 of 2 · 50%', over: true },
    ]);
  });

  it('the sections: QUEUE, SPEED, RENDER, MEET, UPLOADS, BENCH, DEMO, with budgets as "of" values', () => {
    const s = opsSections(n, BUDGETS);
    expect(s.map(x => x.eyebrow)).toEqual(['QUEUE', 'SPEED', 'RENDER', 'MEET', 'UPLOADS', 'BENCH, PHONE AND REFEREES', 'DEMO']);
    const row = (eyebrow: string, label: string) => s.find(x => x.eyebrow === eyebrow)!.rows.find(r => r.label === label)?.value;
    expect(row('QUEUE', 'Waiting')).toBe('3');
    expect(row('QUEUE', 'Oldest')).toBe('30 min');
    expect(row('RENDER', 'Run starts, last minute')).toBe('2 of 10');
    expect(row('RENDER', 'Run starts this hour')).toBe('3 of 600');
    expect(row('RENDER', 'CPU this hour')).toBe('6 of 240');
    expect(row('SPEED', 'Upload to lights, median, 15 min')).toBe('20.0 s');
    expect(row('SPEED', 'Phone judge time · iPhone (3 clips)')).toBe('3.0 s');
    expect(row('DEMO', 'Demo runs today')).toMatch(/^2 of \d+$/);
  });
});

// 2.4, 3.4b: "Bench, phone and referees", on its own schema so its attempts don't touch the counts above
describe.skipIf(!URL_)('/ops bench, phone and referees', () => {
  let db: Db, drop: () => Promise<void>;
  let n: OpsNumbers;

  beforeAll(async () => {
    ({ db, drop } = await freshDb(3));
    const [real] = await db.insert(meets).values({ slug: 'm1', name: 'Meet 1', kind: 'real', status: 'open' }).returning();
    const [demo] = await db.insert(meets).values({ slug: 'demo', name: 'Demo', kind: 'demo', status: 'open' }).returning();
    const [test] = await db.insert(meets).values({ slug: 'test', name: 'Test', kind: 'test', status: 'open' }).returning();
    type Row = { status: string; call?: 'white' | 'red'; shadow?: 'white' | 'red'; referee?: boolean; uploaded?: boolean; sinking?: boolean; lost?: boolean; lift?: 'bench' | 'squat'; home?: boolean; sample?: boolean };
    const mk = async (meetId: string, r: Row) => {
      const [l] = await db.insert(lifters).values({ cardName: 'L', isDemo: meetId === demo.id, division: r.home ? 'home' : 'barbell' }).returning();
      const [a] = await db.insert(attempts).values({
        lifterId: l.id, meetId, lift: r.lift ?? 'bench', number: 1, weight: 60, status: r.status as never,
        call: r.call ?? null, lights: r.call ? [r.call, r.call, r.call] : null,
        shadowLights: r.shadow ? [r.shadow, r.shadow, r.shadow] : null,
        uploadedAt: r.uploaded ? new Date() : null, isSampleClip: !!r.sample,
        measures: { press_while_sinking: !!r.sinking, lost_after_start: !!r.lost, ...(r.referee ? { referee: true } : {}) },
      }).returning();
      return a.id;
    };
    // decided by referees: agree (white, white), white on a red, red on a white, and a close-call shadow (agrees with neither)
    await mk(real.id, { status: 'judged', call: 'white', shadow: 'white', referee: true, uploaded: true, sinking: true });
    await mk(real.id, { status: 'judged', call: 'red', shadow: 'white', referee: true, uploaded: true, lost: true });
    await mk(real.id, { status: 'judged', call: 'white', shadow: 'red', referee: true, uploaded: true });
    await mk(real.id, { status: 'judged', call: 'red', referee: true, uploaded: true });
    // waiting for a referee: filmed, not decided
    await mk(real.id, { status: 'close_call', shadow: 'red', uploaded: true });
    // no Start! twice, still declared
    const voided = await mk(real.id, { status: 'declared' });
    // a squat with a void doesn't count
    const squat = await mk(real.id, { status: 'declared', lift: 'squat' });
    // item 94: the demo and test meets' benches were filmed on a real phone, so they count in the tracker's three
    // rates, never in the referee lines. A sample never counts.
    const d = await mk(demo.id, { status: 'judged', call: 'red', shadow: 'white', referee: true, uploaded: true, sinking: true, lost: true });
    await mk(test.id, { status: 'judged', call: 'red', shadow: 'white', referee: true, uploaded: true, sinking: true });
    const s = await mk(demo.id, { status: 'judged', call: 'white', shadow: 'red', referee: true, uploaded: true, sinking: true, lost: true, sample: true });
    // F-C, F-D: Home press sets (lift 'bench' on Home, 3.4c) are never bench rows; they make their own line.
    // Judged by the phone; a referee's red on a phone close call; one waiting; one still declared with a void; a demo one.
    await mk(real.id, { status: 'judged', call: 'white', home: true, uploaded: true, sinking: true });
    await mk(real.id, { status: 'judged', call: 'red', shadow: 'white', referee: true, home: true, uploaded: true, lost: true });
    await mk(real.id, { status: 'close_call', home: true, uploaded: true });
    const pressVoid = await mk(real.id, { status: 'declared', home: true });
    await mk(demo.id, { status: 'close_call', home: true, uploaded: true });
    await mk(test.id, { status: 'close_call', home: true, uploaded: true });
    await db.insert(events).values([
      { kind: 'lost_bar_void', attemptId: s, detail: { lift: 'bench', why: 'no_start' } },
      { kind: 'lost_bar_void', attemptId: pressVoid, detail: { lift: 'bench', why: 'no_start' } },
      { kind: 'lost_bar_void', attemptId: voided, detail: { lift: 'bench', why: 'no_start' } },
      { kind: 'lost_bar_void', attemptId: voided, detail: { lift: 'bench', why: 'no_start' } },
      { kind: 'lost_bar_void', attemptId: d, detail: { lift: 'bench', why: 'no_start' } },
      { kind: 'turned_void', attemptId: squat, detail: { lift: 'squat' } },
    ]);
    n = await opsNumbers(db, BUDGETS, null);
  });
  afterAll(async () => drop?.());

  it('compares the bar\'s call with the referees\' on decided real meet bench attempts, and counts the bench going wrong over every real phone\'s filming', () => {
    // filmings: 5 real + demo + test uploaded, and 2 real + 1 demo no-Start! voids; never the sample's
    expect(n.bench).toEqual({ decided: 4, agree: 1, whiteOnRed: 1, redOnWhite: 1, filmings: 10, pressWhileSinking: 3, lostAfterStart: 2, noStartVoids: 3, homePressSets: 3, homePressReferee: 2 });
    expect(opsSections(n, BUDGETS).find(x => x.eyebrow === 'BENCH, PHONE AND REFEREES')!.rows).toEqual([
      { label: 'Decided', value: '4' },
      { label: 'Agree', value: '1' },
      { label: 'White on a red', value: '1' },
      { label: 'Red on a white', value: '1' },
      { label: 'Press! while sinking', value: '3 of 10 · 30%' },
      { label: 'Lost the bar after Start!', value: '2 of 10 · 20%' },
      { label: 'No Start!, filmed again', value: '3 of 10 · 30%' },
      { label: 'Home press sets to a referee', value: '67%' },
    ]);
  });

  it('no phone judge times yet: one pose run row with a dash', () => {
    expect(n.speed.poseRunByDevice).toEqual([]);
    expect(opsSections(n, BUDGETS).find(x => x.eyebrow === 'SPEED')!.rows.find(r => r.label === 'Pose run per frame')?.value).toBe('—');
  });
});

describe('ops words', () => {
  it('uploadRows: none yet, and the share; "over" past 5%', () => {
    expect(uploadRows([])).toEqual([{ label: 'Uploads failed or refused, 24 h', value: '0 of 0', over: false }]);
    expect(uploadRows([{ device: 'X', tried: 20, failed: 1 }])[1]).toEqual({ label: 'Failed or refused · X', value: '1 of 20 · 5%', over: false });
    expect(uploadRows([{ device: 'X', tried: 19, failed: 1 }])[1].over).toBe(true);
    expect(failedOf(1, 40)).toBe('1 of 40 · 3%');
  });
  it('poseRunRows: 220 ms is on the line, 221 is over', () => {
    expect(poseRunRows([{ device: 'A', medianMs: 220, clips: 20 }, { device: 'B', medianMs: 220.6, clips: 2 }])).toEqual([
      { label: 'Pose run per frame · A (20 clips)', value: '220 ms', over: false },
      { label: 'Pose run per frame · B (2 clips)', value: '221 ms', over: true },
    ]);
  });
  it('benchRows with nothing yet', () => {
    expect(benchRows({ decided: 0, agree: 0, whiteOnRed: 0, redOnWhite: 0, filmings: 0, pressWhileSinking: 0, lostAfterStart: 0, noStartVoids: 0, homePressSets: 0, homePressReferee: 0 }).map(r => r.value))
      .toEqual(['0', '0', '0', '0', '0 of 0', '0 of 0', '0 of 0', '—']);
  });
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
