// Card PNGs are drawn on a worker thread, never on the server's own (CI on 4fcdf4b).
// Satori and resvg run synchronously: drawn in the request, a Story PNG held the whole web process for
// about 5 s here and 19 s on staging, so /healthz timed out, Render restarted staging, and the requests in
// flight (her share save among them) got a 502. Here the server's thread only expands the card's components
// into a plain element tree; card-draw-worker.mjs lays it out and draws it.
// A drawing already made is kept (by its tree), so her card page, her card link and render_clip's end card
// draw it once.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { Fragment, isValidElement, type ReactNode } from 'react';
import { cardFonts, WEB_DIR } from '@/lib/card/card-fonts';

type Plain = string | number | null | { type: string; props: Record<string, unknown> } | Plain[];
type Size = { width: number; height: number };

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

/** Longer than staging's 19 s Story PNG; a drawing that takes this long has hung, and its thread is replaced. */
const DRAW_MS = 120_000;
const KEEP = 24;

type Job = { resolve: (b: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
let worker: Worker | null = null;
let nextId = 0;
const jobs = new Map<number, Job>();
const drawn = new Map<string, Promise<Buffer>>();

function fail(w: Worker, e: Error) {
  if (worker !== w) return;
  worker = null;
  for (const j of jobs.values()) { clearTimeout(j.timer); j.reject(e); }
  jobs.clear();
  void w.terminate();
}

async function drawer(): Promise<Worker> {
  if (worker) return worker;
  const fonts = await cardFonts();
  if (worker) return worker;
  const w = new Worker(path.join(WEB_DIR(), 'lib', 'card', 'card-draw-worker.mjs'), { workerData: { fonts } });
  w.unref();
  w.on('message', (m: { id: number; png?: ArrayBuffer; error?: string }) => {
    const j = jobs.get(m.id);
    if (!j) return;
    jobs.delete(m.id); clearTimeout(j.timer);
    if (m.png) j.resolve(Buffer.from(m.png)); else j.reject(new Error(m.error ?? 'the card drawing failed'));
  });
  w.on('error', e => fail(w, e));
  w.on('exit', code => fail(w, new Error(`the card drawing thread stopped (${code})`)));
  worker = w;
  return w;
}

async function drawNow(tree: Plain, size: Size): Promise<Buffer> {
  const w = await drawer();
  const id = nextId++;
  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => fail(w, new Error(`the card drawing took over ${DRAW_MS / 1000} s`)), DRAW_MS);
    jobs.set(id, { resolve, reject, timer });
    w.postMessage({ id, tree, size });
  });
}

/** The PNG of `el` at `size`, drawn off the server's thread. */
export function drawPng(el: ReactNode, size: Size): Promise<Buffer> {
  const tree = plainTree(el);
  const key = createHash('sha256').update(JSON.stringify([size, tree])).digest('base64url');
  const had = drawn.get(key);
  if (had) { drawn.delete(key); drawn.set(key, had); return had; }
  const p = drawNow(tree, size);
  drawn.set(key, p);
  p.catch(() => { if (drawn.get(key) === p) drawn.delete(key); });
  while (drawn.size > KEEP) drawn.delete(drawn.keys().next().value!);
  return p;
}

/** The PNG as a response; each route sets its own Cache-Control. */
export async function pngResponse(el: ReactNode, size: Size): Promise<Response> {
  const png = await drawPng(el, size);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.length) } });
}
