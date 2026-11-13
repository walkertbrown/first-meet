// LookieBot's look fail on 9f08bb4 (PR #4 comment), and The Playner's alert dialog focus point, 13 Nov.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '../../web', p), 'utf8');
const meet = read('components/meet-attempt.tsx');
const tryCss = read('app/try.css');
const platform = read('app/platform.css');
const corner = read('app/corner/[token]/page.tsx');

describe('phase 3 look fixes', () => {
  it('LookieBot 1: a close call freezes on the judged frame, with the hip-to-knee marks', () => {
    // live: the frame at judged_frame_ms, falling back to the held snap
    expect(meet).toContain("if (snapAt && typeof s.judged_frame_ms === 'number') judged = (await snapAt(s.judged_frame_ms).catch(() => null)) ?? snap;");
    expect(meet).toContain('setFrozen(!!freeze(judged));');
    expect(meet).toContain('if (judged?.p.length) setMarks(liftMarks(shownC, judged.p,');
    // reload during a close call: the same frame and marks
    expect(meet).toContain('const judged = bench ? null : await snapAt().catch(() => null);');
    expect(meet).toContain('if (judged?.p.length) setMarks(liftMarks(st.shown_lift ?? attempt.lift, judged.p,');
    // the marks give way when the lamps light
    expect(meet).toContain('setSettledOpen(false); setMarks(null);');
  });
  it('LookieBot 2: the demo sample\'s first frame is dimmed while she gets ready', () => {
    expect(meet).toContain("isSample && (phase === 'spot' || phase === 'good-spot' || phase === 'loaded') ? 'held' : ''");
    expect(meet).toContain('{isSample && <div className="held-dim" />}');
    expect(tryCss).toContain('.footage .held-dim { transition: none; }');
  });
  it('LookieBot 3: every tap on the sideways bench camera view reaches the plate', () => {
    expect(platform).toContain('.meet-app .hud, .meet-app .stage .lamps, .meet-app .waitline, .meet-app .spotparts, .meet-app .spotline { pointer-events: none; }');
    expect(platform).toContain('.meet-app .hud button { pointer-events: auto; }');
  });
  it('LookieBot 4: every corner page state keeps the live page\'s top', () => {
    const pages = corner.match(/<div className="try-page[^"]*">/g) ?? [];
    expect(pages.length).toBe(4);
    for (const p of pages) expect(p).toBe('<div className="try-page meet-page">');
  });
  it('LookieBot 5: an empty live line adds no gap above "Film again"', () => {
    expect(tryCss).toContain('.try-app.land .panel-in > .live:empty { margin-top: -12px; }');
  });
  it('the void sheet takes focus when it opens', () => {
    expect(meet).toContain('role="alertdialog" aria-labelledby="void-title" aria-describedby="void-body" tabIndex={-1} ref={voidRef}');
    expect(meet).toContain("useEffect(() => { if (phase === 'void') voidRef.current?.focus(); }, [phase]);");
    expect(tryCss).toContain('.void-sheet:focus { outline: none; }');
  });
});
