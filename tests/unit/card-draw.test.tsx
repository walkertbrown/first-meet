// Card PNGs are drawn off the server's thread (CI on 4fcdf4b: a Story PNG drawn in the request held the web
// process past Render's 5 s health check, staging was restarted, and her share save got a 502).
import { describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import { drawPng, plainTree } from '@/lib/card/card-draw';
import { cardFonts } from '@/lib/card/card-fonts';
import { FORMATS, StoryCard } from '@/lib/card/card-image';
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
