// Card PNGs are drawn off the server's thread (CI on 4fcdf4b: a Story PNG drawn in the request held the web
// process past Render's 5 s health check, staging was restarted, and her share save got a 502).
import { afterEach, describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import { drawPng, forTests, plainTree } from '@/lib/card/card-draw';
import { clipCardImage, RETRY_AFTER_S } from '@/lib/card/card-png';
import { cardFonts } from '@/lib/card/card-fonts';
import { FORMATS, PostCard, StoryCard } from '@/lib/card/card-image';
import { juneCardView } from '@/lib/corner-view';

const june = juneCardView()!;

describe('card PNGs, drawn off the server thread', () => {
  it('the server thread stays free while a Story PNG draws', async () => {
    const v = { ...june, name: 'Stall Check' };
    let last = performance.now(), worst = 0;
    const tick = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; }, 10);
    const t = performance.now();
    try {
      await drawPng(<StoryCard v={v} />, FORMATS.story);
    } finally { clearInterval(tick); }
    const took = performance.now() - t;
    // the drawing itself takes seconds; in the request it held the thread that long
    expect(took).toBeGreaterThan(500);
    expect(worst, `the longest the server thread was held, in a ${Math.round(took)} ms drawing`).toBeLessThan(250);
  }, 90_000);

  it('draws the same PNG as Satori in the request did', async () => {
    const v = { ...june, name: 'Same Pixels' };
    const off = await drawPng(<StoryCard v={v} />, FORMATS.story);
    const inThread = Buffer.from(await new ImageResponse(<StoryCard v={v} />, { ...FORMATS.story, fonts: await cardFonts() }).arrayBuffer());
    expect(off.subarray(1, 4).toString()).toBe('PNG');
    expect(off.equals(inThread)).toBe(true);
  }, 90_000);

  it('a card already drawn is not drawn again', async () => {
    const v = { ...june, name: 'Drawn Once' };
    const a = drawPng(<StoryCard v={v} />, FORMATS.story);
    const b = drawPng(<StoryCard v={{ ...v }} />, FORMATS.story);
    expect(b).toBe(a);
    await a;
    const t = performance.now();
    await drawPng(<StoryCard v={{ ...v }} />, FORMATS.story);
    expect(performance.now() - t).toBeLessThan(50);
    expect(drawPng(<StoryCard v={{ ...v, name: 'Drawn Twice' }} />, FORMATS.story)).not.toBe(a);
  }, 90_000);

  it("the tree is plain: components called, fragments flattened, nothing a thread can't take", () => {
    const Name = ({ n }: { n: string }) => <><span>{n}</span>{false}{null}</>;
    expect(plainTree(<div style={{ display: 'flex' }}><Name n="Rosa" />{3}</div>)).toEqual(
      { type: 'div', props: { style: { display: 'flex' }, children: [[{ type: 'span', props: { children: 'Rosa' } }, null, null], 3] } });
    expect(() => plainTree({} as never)).toThrow("a card can't draw");
    expect(JSON.parse(JSON.stringify(plainTree(<StoryCard v={june} />)))).toEqual(plainTree(<StoryCard v={june} />));
  });
});


// NerdCider, 64d5e85: 30 Stories asked for at once, and every card behind the 120 s mark failed with the one
// that hit it, though none had hung; on staging, two new Stories ahead of render_clip's end card cost her a run.
describe('the drawing line', () => {
  const post = (name: string) => <PostCard v={{ ...june, name }} />;
  const story = (name: string) => <StoryCard v={{ ...june, name }} />;
  afterEach(() => forTests.setDrawMs(120_000));

  it('N cards at once, N times one drawing over the limit: every card is drawn, and the end card comes out first', async () => {
    await drawPng(post('Warm Card'), FORMATS.post);   // the thread's first Post is slower
    const t = performance.now();
    await drawPng(post('One Card'), FORMATS.post);
    const one = performance.now() - t;
    const limit = Math.max(4 * one, 4000);
    const n = Math.ceil(limit / one) + 2;
    forTests.setDrawMs(limit);
    const out: string[] = [];
    const ask = (name: string, p: Promise<Buffer>) => p.then(b => { out.push(name); return b; });
    const all: Promise<Buffer>[] = [ask('asked 0', drawPng(post('Line 0'), FORMATS.post, 'asked'))];
    // drawn ahead when her result settled, then asked for again as a claimed clip's end card: it moves up
    const endAhead = drawPng(story('End Card'), FORMATS.story, 'ahead');
    all.push(ask('later', drawPng(post('Drawn Ahead'), FORMATS.post, 'ahead')));
    for (let i = 1; i < n; i++) all.push(ask(`asked ${i}`, drawPng(post(`Line ${i}`), FORMATS.post, 'asked')));
    const end = drawPng(story('End Card'), FORMATS.story, 'clip');
    expect(end).toBe(endAhead);
    all.push(ask('end card', end));
    const took = performance.now();
    const pngs = await Promise.all(all);   // none fails
    expect(performance.now() - took, `${n} cards of ~${Math.round(one)} ms each`).toBeGreaterThan(limit);
    expect(pngs.every(b => b.subarray(1, 4).toString() === 'PNG')).toBe(true);
    expect(out).toEqual(['asked 0', 'end card', ...Array.from({ length: n - 1 }, (_, i) => `asked ${i + 1}`), 'later']);
    expect(forTests.lineLength()).toBe(0);
  }, 300_000);

  it('a drawing that runs over fails alone; the cards behind it are drawn on a new thread', async () => {
    forTests.setDrawMs(30);
    const hung = drawPng(post('Hung Card'), FORMATS.post);
    forTests.setDrawMs(120_000);
    const next = [drawPng(post('After Hung 1'), FORMATS.post), drawPng(post('After Hung 2'), FORMATS.post)];
    await expect(hung).rejects.toThrow('the card drawing took over 0.03 s');
    for (const b of await Promise.all(next)) expect(b.subarray(1, 4).toString()).toBe('PNG');
    // not kept: asked for again, it's drawn again
    expect(await drawPng(post('Hung Card'), FORMATS.post)).toBeInstanceOf(Buffer);
  }, 300_000);

  it("a clip run's end card behind a long line: told to ask again, never a failure, and drawn before the line", async () => {
    const line = Array.from({ length: 4 }, (_, i) => drawPng(post(`Long Line ${i}`), FORMATS.post));
    const done = new Set<number>();
    line.forEach((p, i) => p.then(() => done.add(i)));
    const v = { ...june, name: 'Claimed Clip' };
    let busy = 0, res: Response;
    // worker/main.py's fetch_card: a 503 waits Retry-After and asks again; only a real failure is a try
    for (;;) {
      res = await clipCardImage(v, 200);
      if (res.status !== 503) break;
      busy++;
      expect(res.headers.get('Retry-After')).toBe(String(RETRY_AFTER_S));
      await new Promise(r => setTimeout(r, 100));
    }
    expect(res.status).toBe(200);
    expect(busy).toBeGreaterThan(0);
    expect(done.size, 'cards of the line drawn before the end card').toBeLessThanOrEqual(1);
    const b = Buffer.from(await res.arrayBuffer());
    expect(b.equals(await drawPng(<StoryCard v={v} />, FORMATS.story))).toBe(true);   // the same drawing, kept
    await Promise.all(line);
  }, 300_000);
});
