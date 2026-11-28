'use client';
// The live host desk (plan 5.35, look 5.12): /host for Soo, /host/sample for anyone (5.36).
// - The read-out card: "Read" tells her phone (and, if it isn't open, her email); "Skip" moves on.
// - The roll call scrolls at a constant speed that fits the live; each name whose left edge crosses
//   the middle of its row tells her phone. Slower and Faster ease 15% over 600 ms. Reduced motion
//   pages the names instead: every name on a page counts as crossed.
// - Space = Read, S = Skip, P = pause. "Hide keys" (under the desk, off the shared screen) hides the
//   key line and the roll call's bar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DESK_W, DeskStage, DeskTop, ReadoutCard, type Readout, type RollEntry } from './host-desk';
import { leftLine, namesPerPage, PAGE_S, readoutQueues, readoutsInOrder, rollEntries, rollEntriesInOrder, rollLine, rollPace, smallMeetLine, splitRows, SMALL_MEET, type HostLifter, type Queue } from '@/lib/host';

export type DeskProps = {
  /** /api/host or /api/host/sample */
  api: string;
  night: string;
  lifters: HostLifter[];
  /** /host/sample: the demo lifters, newest first, read before the sample meet's */
  demo?: HostLifter[];
  /** already read (from the database), so a reload picks up where she was */
  readIds: string[];
  /** already crossed the roll call */
  crossedIds: string[];
  liveMinutes: number;
  /** the sample desk loops its roll call and its reads */
  loop?: boolean;
  storeKey: string;
};

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } },
};

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => null);

/** The queues the desk reads from: the sample desk puts the demo lifters first. */
export function deskQueues(lifters: HostLifter[], demo: HostLifter[] | undefined, done: Set<string>): Queue[] {
  const qs = readoutQueues(lifters, done);
  if (!demo?.length) return qs;
  const mine = readoutsInOrder(demo).filter(r => !done.has(r.id));
  return mine.length ? [{ eyebrow: 'FIRST TOTALS', items: mine }, ...qs] : qs;
}

export function HostLive(p: DeskProps) {
  const reduced = useReducedMotion();
  const [hideKeys, setHideKeys] = useState(false);
  useEffect(() => setHideKeys(store.get(`${p.storeKey}:hide`, false)), [p.storeKey]);
  const toggleKeys = (v: boolean) => { setHideKeys(v); store.set(`${p.storeKey}:hide`, v); };

  // ---------- the read-out card ----------
  const [done, setDone] = useState(() => new Set(p.readIds));
  useEffect(() => {
    const skipped = store.get<string[]>(`${p.storeKey}:skipped`, []);
    if (skipped.length) setDone(d => new Set([...d, ...skipped]));
  }, [p.storeKey]);
  const queues = useMemo(() => deskQueues(p.lifters, p.demo, done), [p.lifters, p.demo, done]);
  const q = queues[0] ?? null;
  const card = q?.items[0] ?? null;
  const [leaving, setLeaving] = useState<{ r: Readout; eyebrow: string } | null>(null);
  const pressed = useRef(false);
  const next = useCallback((how: 'read' | 'skip') => {
    if (!q || !card || pressed.current) return;
    pressed.current = true;
    setTimeout(() => { pressed.current = false; }, 360);
    if (how === 'read') void post(`${p.api}/read`, { lifter: card.id });
    else store.set(`${p.storeKey}:skipped`, [...store.get<string[]>(`${p.storeKey}:skipped`, []), card.id]);
    setLeaving({ r: card, eyebrow: q.eyebrow });
    setTimeout(() => setLeaving(null), 360);
    setDone(d => new Set([...d, card.id]));
  }, [q, card, p.api, p.storeKey]);
  // the sample desk starts its list again once it's all read
  useEffect(() => {
    if (p.loop && !card && done.size) { store.set(`${p.storeKey}:skipped`, []); setDone(new Set()); }
  }, [p.loop, card, done.size, p.storeKey]);

  // ---------- the roll call ----------
  const entries = useMemo(() => {
    const own = rollEntries(p.lifters);
    return p.demo?.length ? [...rollEntriesInOrder(p.demo), ...own] : own;
  }, [p.lifters, p.demo]);
  const pace = useMemo(() => rollPace(entries.length, p.liveMinutes), [entries.length, p.liveMinutes]);
  const rows = useMemo(() => splitRows(entries, pace.rows), [entries, pace.rows]);
  const roll = useRoll({ rows, pace, crossedIds: p.crossedIds, api: p.api, loop: !!p.loop, reduced, startPaused: !p.loop && p.crossedIds.length === 0 });

  // ---------- keys ----------
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === ' ') { e.preventDefault(); next('read'); }
      else if (e.key === 's' || e.key === 'S') next('skip');
      else if (e.key === 'p' || e.key === 'P') roll.toggle();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [next, roll]);

  const small = entries.length > 0 && entries.length <= SMALL_MEET;
  return (
    <>
      <DeskStage label="Host desk">
        <DeskTop night={p.night} count={entries.length} />
        <div className="desk-main">
          {leaving && <ReadoutCard key={`l${leaving.r.id}`} r={leaving.r} eyebrow={leaving.eyebrow} leaving />}
          {!leaving && card && q && (
            <>
              <ReadoutCard key={card.id} r={card} eyebrow={q.eyebrow} />
              <div className="desk-actions">
                <button type="button" className="desk-read" onClick={() => next('read')}>Read</button>
                <button type="button" className="desk-skip" onClick={() => next('skip')}>Skip</button>
                <span className="desk-left">{leftLine(q.items.length)}</span>
              </div>
            </>
          )}
          {!leaving && !card && <span className="desk-left">{leftLine(0)}</span>}
          {small && <p className="desk-caption desk-small-meet">{smallMeetLine(entries.length)}</p>}
        </div>
        {!hideKeys && (
          <div className="desk-bar">
            <span className="desk-roll-line">{rollLine(roll.done, entries.length, roll.endsAt)}</span>
            <button type="button" className="desk-ctl" onClick={roll.slower}>Slower</button>
            <button type="button" className="desk-ctl" onClick={roll.faster}>Faster</button>
            <button type="button" className={`desk-ctl${roll.paused ? ' paused' : ''}`} onClick={roll.toggle}>{roll.paused ? (roll.done === 0 && !p.loop ? 'Start' : 'Play') : 'Pause'}</button>
          </div>
        )}
        {!hideKeys && <p className="desk-caption desk-keys">Space Read · S Skip · P Pause</p>}
        <div className={`roll-band${rows.length > 1 ? ' two' : ''}`}>
          {reduced
            ? roll.page.map((names, i) => (
              <div className="roll-row" key={i}>
                <div className="roll-page" key={roll.pageNo}>{names.map(e => <Entry key={e.id} e={e} />)}</div>
              </div>
            ))
            : rows.map((list, i) => (
              <div className="roll-row" key={i}>
                <div className="roll-strip" ref={roll.strips[i]}>{list.map(e => <Entry key={e.id} e={e} />)}</div>
              </div>
            ))}
        </div>
      </DeskStage>
      <div className="desk-under">
        <label className="desk-hide"><input type="checkbox" checked={hideKeys} onChange={e => toggleKeys(e.target.checked)} /> Hide keys</label>
      </div>
    </>
  );
}

const Entry = ({ e }: { e: RollEntry }) => (
  <span className="roll-entry" data-id={e.id}>
    <i className="mini-lamp white" aria-hidden="true" />
    <b className="roll-name">{e.name}</b>
    <span className="roll-age">{e.ageGroup}</span>
    <span className="roll-total num">{e.total}</span>
  </span>
);

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return r;
}

/** Slower / Faster: 15% a press, eased over 600 ms. */
const EASE_MS = 600;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

type RollOpts = { rows: RollEntry[][]; pace: ReturnType<typeof rollPace>; crossedIds: string[]; api: string; loop: boolean; reduced: boolean; startPaused: boolean };

/**
 * The roll call's clock. Moving: each row's strip is set straight from requestAnimationFrame (no
 * React render a frame), at one speed for both rows. Paged (reduced motion): a page a row, every
 * 18 s. Crossings go to the server about once a second.
 */
function useRoll(o: RollOpts) {
  const { rows, pace, loop, reduced } = o;
  const strips = useMemo(() => [0, 1].map(() => ({ current: null as HTMLDivElement | null })), []);
  const crossed = useRef(new Set(o.crossedIds));
  const pending = useRef<string[]>([]);
  const [done, setDone] = useState(() => countIn(rows, crossed.current));
  const [paused, setPaused] = useState(o.startPaused);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const speed = useRef({ from: 1, to: 1, t0: 0 });
  const [endsAt, setEndsAt] = useState<Date | null>(null);
  const [pageNo, setPageNo] = useState(0);
  const [page, setPage] = useState<RollEntry[][]>([]);

  const mult = (now: number) => {
    const s = speed.current;
    const k = Math.min(1, (now - s.t0) / EASE_MS);
    return s.from + (s.to - s.from) * easeOut(k);
  };
  const nudge = useCallback((f: number) => {
    const now = performance.now();
    const m = mult(now);
    speed.current = { from: m, to: Math.min(4, Math.max(0.25, speed.current.to * f)), t0: now };
  }, []);

  const cross = useCallback((ids: string[]) => {
    for (const id of ids) if (!crossed.current.has(id)) { crossed.current.add(id); pending.current.push(id); }
  }, []);

  // send the crossings, about once a second
  useEffect(() => {
    const t = setInterval(() => {
      setDone(countIn(rows, crossed.current));
      if (!pending.current.length) return;
      const ids = pending.current.splice(0, 200);
      void post(`${o.api}/crossed`, { lifters: ids });
    }, 1000);
    return () => clearInterval(t);
  }, [o.api, rows]);

  // moving
  useEffect(() => {
    if (reduced || !rows.length) return;
    const els = rows.map((_, i) => strips[i].current).filter((x): x is HTMLDivElement => !!x);
    if (els.length !== rows.length) return;
    const avg = els.reduce((n, el) => n + el.scrollWidth / Math.max(1, el.children.length), 0) / els.length;
    const lead = (i: number) => (i ? Math.round(avg / 2) : 0);
    // where each entry's left edge crosses the middle: offset >= DESK_W/2 + lead + its left
    const lefts = els.map(el => Array.from(el.children, c => (c as HTMLElement).offsetLeft));
    const len = Math.max(...els.map(el => el.scrollWidth));
    const target = pace.perRow * pace.rowPace;
    const v = target > 0 ? len / target : 0;
    // a reload starts each row at its first name not yet crossed, just in from the right
    const nextIdx = rows.map(list => Math.max(0, list.findIndex(e => !crossed.current.has(e.id))));
    const allDone = rows.every(list => list.every(e => crossed.current.has(e.id)));
    let offset = allDone && !loop ? DESK_W + len + avg : Math.max(0, Math.min(...rows.map((_, i) => DESK_W / 2 + lead(i) + (lefts[i][nextIdx[i]] ?? 0))) - DESK_W / 2 + 40);
    const idx = rows.map((list, i) => { let k = 0; while (k < list.length && DESK_W / 2 + lead(i) + lefts[i][k] <= offset) k++; return k; });
    const end = DESK_W + len + avg;
    let last = performance.now();
    let raf = 0, lastEnds = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const m = mult(now);
      if (!pausedRef.current) offset += v * m * dt;
      if (loop && offset > end) {
        offset = 0;
        idx.fill(0);
        crossed.current.clear();
      }
      els.forEach((el, i) => {
        el.style.transform = `translate3d(${DESK_W + lead(i) - offset}px,0,0)`;
        const out: string[] = [];
        while (idx[i] < rows[i].length && DESK_W / 2 + lead(i) + lefts[i][idx[i]] <= offset) out.push(rows[i][idx[i]++].id);
        if (out.length) cross(out);
      });
      if (now - lastEnds > 1000) {
        lastEnds = now;
        const left = Math.max(0, Math.max(...rows.map((_, i) => DESK_W / 2 + lead(i) + (lefts[i][rows[i].length - 1] ?? 0))) - offset);
        setEndsAt(v > 0 && left > 0 ? new Date(Date.now() + (left / (v * m)) * 1000) : null);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced, rows, pace, loop, strips, cross]);

  // paged: a page a row every 18 s (sooner when faster), each name shown counts as crossed
  useEffect(() => {
    if (!reduced || !rows.length) return;
    const per = namesPerPage(pace.rowPace);
    const pages = Math.ceil(Math.max(...rows.map(r => r.length)) / per);
    let n = Math.max(0, Math.floor(Math.min(...rows.map(list => Math.max(0, list.findIndex(e => !crossed.current.has(e.id))))) / per));
    if (rows.every(list => list.every(e => crossed.current.has(e.id))) && !loop) n = pages - 1;
    const show = () => {
      const pg = rows.map(list => list.slice(n * per, n * per + per));
      setPage(pg);
      setPageNo(n);
      cross(pg.flat().map(e => e.id));
      const left = Math.max(0, pages - n - 1);
      setEndsAt(left ? new Date(Date.now() + left * PAGE_S * 1000 / mult(performance.now())) : null);
    };
    show();
    let wait = 0, t: ReturnType<typeof setTimeout>;
    const tick = () => {
      t = setTimeout(() => {
        if (pausedRef.current) { tick(); return; }
        wait += 250;
        if (wait >= (PAGE_S * 1000) / mult(performance.now())) {
          wait = 0;
          if (n < pages - 1) n++;
          else if (loop) { n = 0; crossed.current.clear(); }
          show();
        }
        tick();
      }, 250);
    };
    tick();
    return () => clearTimeout(t);
  }, [reduced, rows, pace, loop, cross]);

  const toggle = useCallback(() => setPaused(x => !x), []);
  const slower = useCallback(() => nudge(0.85), [nudge]);
  const faster = useCallback(() => nudge(1.15), [nudge]);
  return useMemo(() => ({ strips, done, paused, toggle, slower, faster, endsAt, page, pageNo }), [strips, done, paused, toggle, slower, faster, endsAt, page, pageNo]);
}

function countIn(rows: RollEntry[][], ids: Set<string>) {
  let n = 0;
  for (const r of rows) for (const e of r) if (ids.has(e.id)) n++;
  return n;
}
