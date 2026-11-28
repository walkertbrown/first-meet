// Card PNGs are drawn on a worker thread, never on the server's own (CI on 4fcdf4b).
// Satori and resvg run synchronously: drawn in the request, a Story PNG held the whole web process for
// about 5 s here and 19 s on staging, so /healthz timed out, Render restarted staging, and the requests in
// flight (her share save among them) got a 502. Here the server's thread only expands the card's components
// into a plain element tree; card-draw-worker.mjs lays it out and draws it.
//
// The thread draws one card at a time, from a line kept here (NerdCider, 64d5e85):
// - the line goes by priority: render_clip's end card for a claimed clip first ('clip'), then a card a
//   person has asked for ('asked'), then her cards drawn ahead when her result settles ('ahead'); within
//   one priority, first come, first drawn. A card already in line that's asked for again moves up;
// - each drawing is timed from when it starts. One that runs over fails alone: the thread is replaced and
//   the cards still in line are drawn on the new one;
// - a drawing is kept in memory by its content (a hash of the size and the whole tree), up to KEEP_BYTES,
//   so her card page, her card link and the end card draw it once. Never in R2: "Delete my account" has to
//   delete her card (plan 5.22), and a PNG kept by hash would outlive it.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { Fragment, isValidElement, type ReactNode } from 'react';
import { cardFonts, WEB_DIR } from '@/lib/card/card-fonts';

type Plain = string | number | null | { type: string; props: Record<string, unknown> } | Plain[];
type Size = { width: number; height: number };
export type Priority = 'clip' | 'asked' | 'ahead';
const RANK: Record<Priority, number> = { clip: 0, asked: 1, ahead: 2 };

/** The element with every component called, so it can cross to the drawing thread. */
export function plainTree(n: ReactNode): Plain {
  if (n == null || typeof n === 'boolean') return null;
  if (typeof n === 'string' || typeof n === 'number') return n;
  if (Array.isArray(n)) return n.map(plainTree);
  if (isValidElement(n)) {
    const el = n as { type: unknown; props: Record<string, unknown> };
    if (typeof el.type === 'function') return plainTree((el.type as (p: unknown) => ReactNode)(el.props));
    if (el.type === Fragment) return plainTree(el.props.children as ReactNode);
    if (typeof el.type !== 'string') throw new Error(`a card can't draw ${String(el.type)}`);
    const { children, ...rest } = el.props;
    return { type: el.type, props: children === undefined ? rest : { ...rest, children: plainTree(children as ReactNode) } };
  }
  throw new Error(`a card can't draw ${typeof n}`);
}

/** Longer than staging's 22 s Story; a drawing that takes this long, from its start, has hung. */
let drawMs = 120_000;
/** Kept in memory, by bytes: about 70 lifters' Story, Post and end card on the Starter plan's 512 MB. */
const KEEP_BYTES = 48 * 1024 * 1024;

type Job = {
  key: string; tree: Plain; size: Size; prio: Priority; seq: number; limitMs: number;
  promise: Promise<Buffer>; resolve: (b: Buffer) => void; reject: (e: Error) => void;
};
let worker: Worker | null = null;
let current: { job: Job; w: Worker; timer: NodeJS.Timeout } | null = null;
let seq = 0;
const line: Job[] = [];
const pending = new Map<string, Job>();
const kept = new Map<string, Buffer>();
let keptBytes = 0;

function keep(key: string, png: Buffer) {
  const had = kept.get(key);
  if (had) { kept.delete(key); keptBytes -= had.length; }
  kept.set(key, png); keptBytes += png.length;
  while (keptBytes > KEEP_BYTES && kept.size > 1) {
    const [k, b] = kept.entries().next().value!;
    kept.delete(k); keptBytes -= b.length;
  }
}

function done(job: Job, png: Buffer | null, e?: Error) {
  pending.delete(job.key);
  if (png) {
    keep(job.key, png);
    job.resolve(png);
  } else job.reject(e ?? new Error('the card drawing failed'));
}

async function spawn(): Promise<Worker> {
  const fonts = await cardFonts();
  const w = new Worker(path.join(WEB_DIR(), 'lib', 'card', 'card-draw-worker.mjs'), { workerData: { fonts } });
  w.unref();
  w.on('message', (m: { id: number; png?: ArrayBuffer; error?: string }) => {
    if (current?.w !== w || current.job.seq !== m.id) return;
    const { job, timer } = current;
    clearTimeout(timer); current = null;
    done(job, m.png ? Buffer.from(m.png) : null, new Error(m.error ?? 'the card drawing failed'));
    void pump();
  });
  // the thread itself stopped: only the card it was drawing fails, and a new thread takes the line
  const lost = (e: Error) => {
    if (worker !== w) return;
    worker = null;
    if (current?.w === w) { const { job, timer } = current; clearTimeout(timer); current = null; done(job, null, e); }
    void pump();
  };
  w.on('error', lost);
  w.on('exit', code => lost(new Error(`the card drawing thread stopped (${code})`)));
  return w;
}

let starting: Promise<Worker> | null = null;
async function pump(): Promise<void> {
  if (current || !line.length) return;
  if (!worker) {
    starting ??= spawn().finally(() => { starting = null; });
    try { worker = await starting; } catch (e) {
      for (const j of line.splice(0)) done(j, null, e as Error);
      return;
    }
    if (current) return;
  }
  // the first card of the highest priority in line
  let at = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i], b = line[at];
    if (RANK[a.prio] < RANK[b.prio] || (RANK[a.prio] === RANK[b.prio] && a.seq < b.seq)) at = i;
  }
  const [job] = line.splice(at, 1);
  const w = worker!;
  const timer = setTimeout(() => {
    if (current?.w !== w) return;
    current = null;
    worker = null; // a new thread for the cards still in line
    done(job, null, new Error(`the card drawing took over ${job.limitMs / 1000} s`));
    void w.terminate();
    void pump();
  }, job.limitMs);
  current = { job, w, timer };
  w.postMessage({ id: job.seq, tree: job.tree, size: job.size });
}

const keyOf = (size: Size, tree: Plain) => createHash('sha256').update(JSON.stringify([size, tree])).digest('base64url');

/** The PNG of `el` at `size`, drawn off the server's thread, in line by `prio`. */
export function drawPng(el: ReactNode, size: Size, prio: Priority = 'asked'): Promise<Buffer> {
  const tree = plainTree(el);
  const key = keyOf(size, tree);
  const had = kept.get(key);
  if (had) { keep(key, had); return Promise.resolve(had); }
  const waiting = pending.get(key);
  if (waiting) {
    if (RANK[prio] < RANK[waiting.prio]) waiting.prio = prio;
    return waiting.promise;
  }
  let resolve!: (b: Buffer) => void, reject!: (e: Error) => void;
  const promise = new Promise<Buffer>((res, rej) => { resolve = res; reject = rej; });
  const job: Job = { key, tree, size, prio, seq: seq++, limitMs: drawMs, promise, resolve, reject };
  pending.set(key, job);
  line.push(job);
  void pump();
  return promise;
}

/** The PNG if it's drawn within `ms`, else null; the drawing carries on, and is kept for the next ask. */
export async function drawWithin(el: ReactNode, size: Size, prio: Priority, ms: number): Promise<Buffer | null> {
  const p = drawPng(el, size, prio);
  let t: NodeJS.Timeout | undefined;
  const late = new Promise<null>(res => { t = setTimeout(() => res(null), ms); });
  try { return await Promise.race([p, late]); } finally { clearTimeout(t); }
}

/** The PNG as a response; each route sets its own Cache-Control. */
export function png(b: Buffer): Response {
  return new Response(new Uint8Array(b), { headers: { 'Content-Type': 'image/png', 'Content-Length': String(b.length) } });
}

export async function pngResponse(el: ReactNode, size: Size, prio: Priority = 'asked'): Promise<Response> {
  return png(await drawPng(el, size, prio));
}

/** For tests: the drawing limit and an empty memory. */
export const forTests = {
  /** for the cards asked for after this */
  setDrawMs(ms: number) { drawMs = ms; },
  forget() { kept.clear(); keptBytes = 0; },
  lineLength: () => line.length + (current ? 1 : 0),
  /** where this card is: kept, in line at a priority (or drawing), or nowhere */
  state(el: ReactNode, size: Size): 'kept' | Priority | null {
    const key = keyOf(size, plainTree(el));
    return kept.has(key) ? 'kept' : pending.get(key)?.prio ?? null;
  },
};
