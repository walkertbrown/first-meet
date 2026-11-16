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
    // when the lights land the marks stay and take the lights' colour; only the replay hides them
    expect(meet).not.toContain('setSettledOpen(false); setMarks(null);');
    expect(meet).toContain("if (!reduced()) { await replay().catch(() => {}); if (!alive()) return; }");
    // each replay clears the marks as it starts; a reload's empty replay leaves them up (no blink)
    expect(meet).toContain('setReplaying(true); setFrozen(false); setMarks(null); setBenchPath(null);');
    expect(meet).toContain("setPhase('replay'); setReplaying(true); setFrozen(false); setMarks(null);");
    expect(meet).toContain('await awaitLights(alive, attempt.id, sent, snap, async () => {}, snapAt');
    expect(meet).toContain("const colour = phase === 'close' ? 'var(--stage-ink-2)' : (litCall ? litCall === 'white' : result?.title === 'Good lift') ? 'var(--lamp-white)' : 'var(--lamp-red)';");
  });
  it('LookieBot A (13 Nov): a sample\'s judged frame is asked for as its replay starts, so its marks come with the last frame', () => {
    const run = meet.slice(meet.indexOf('const runSample = useCallback('), meet.indexOf('const runResume = useCallback('));
    expect(run).toContain('const replay = async () => {\n      void frame();');
    // asked for once; a failed answer is dropped so the next ask tries again
    expect(run).toContain('framed ??= getJson(');
    expect(run).toContain("(r?.status === 200 ? (r.body as unknown as Frame) : ((framed = null), null))");
  });
  it('LookieBot B (13 Nov): a close call reloads on an empty panel, with SAMPLE LIFT from the first paint', () => {
    expect(meet).toContain("first.status === 'judged' || first.status === 'close_call' ? 'hold' : 'held'");
    expect(meet).toContain('const [resumedSample, setResumedSample] = useState(!!first.sample);');
    expect(readFileSync(join(__dirname, '../../web/lib/platform-view.ts'), 'utf8')).toContain('...(cur.isSampleClip ? { sample: true as const } : {}),');
  });
  it('LookieBot C (13 Nov): the verdict is swapped in only after the last lamp, while the panel is faded out', () => {
    const lights = meet.slice(meet.indexOf('(LookieBot C, 13 Nov; look step 10'), meet.indexOf('// her clip (step 10)'));
    // the marks take the lights' colour with the first lamp, from the call, not the panel's words
    const off = lights.indexOf("setResultOn(false); setLitCall(s.call === 'white' ? 'white' : 'red'); setWaitLine(''); setBusy(false);");
    const loop = lights.indexOf('for (let k = 0; k < 3; k++) {');
    const swap = lights.indexOf('setResult(res);');
    const spill = lights.indexOf("setSpill(s.call === 'white' ? 'white' : 'red');");
    const on = lights.indexOf('setResultOn(true);');
    expect([off, loop, swap, spill, on].every(i => i >= 0)).toBe(true);
    // "Close call" fades out as the lamps start; the verdict comes in after them, then fades in 420 ms later
    expect(off).toBeLessThan(loop);
    expect(loop).toBeLessThan(swap);
    expect(swap).toBeLessThan(spill);
    expect(spill).toBeLessThan(on);
    expect(lights).not.toContain('setResult(res); setResultOn(false);');
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
