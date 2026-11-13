// Plan piece 2, `commands`: the voice pack and its stand-in.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VOICE_KEYS, VOICE_WORDS, Voice, volumeOf, type VoiceKey } from '../../web/lib/stage/voice';

const PUBLIC = join(__dirname, '../../web/public');
const COUNTS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** A Web Audio stand-in that records what was played, when, and at what volume. */
function fakeAudio() {
  const played: { buffer: unknown; gain: number; at: number; when: number | undefined }[] = [];
  class Ctx {
    state = 'running';
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    decodeAudioData(b: ArrayBuffer) { return Promise.resolve({ decoded: new TextDecoder().decode(b) }); }
    createGain() { return { gain: { value: 1 }, connect: (n: unknown) => n }; }
    createBufferSource() {
      const src = {
        buffer: null as unknown, g: null as null | { gain: { value: number } },
        connect(g: { gain: { value: number } }) { src.g = g; return g; },
        start(when?: number) { played.push({ buffer: src.buffer, gain: src.g!.gain.value, at: performance.now(), when }); },
      };
      return src;
    }
  }
  return { Ctx, played };
}

/** The Web Speech stand-in's calls. */
function fakeSpeech() {
  const spoken: { text: string; rate: number; pitch: number; volume: number; at: number }[] = [];
  class Utterance { rate = 1; pitch = 1; volume = 1; constructor(public text: string) {} }
  const synth = { cancel: vi.fn(), speak: (u: Utterance) => spoken.push({ ...u, at: performance.now() }) };
  return { Utterance, synth, spoken };
}

/** Serves /voices/... from a folder on disk, like the site does from web/public. */
const diskFetcher = (root: string): typeof fetch => (async (url: string | URL) => {
  const p = join(root, String(url));
  if (!existsSync(p)) return new Response('', { status: 404 });
  return new Response(readFileSync(p));
}) as typeof fetch;

// One AudioContext for the file: thock.ts keeps the first one it makes, as a page does.
const audio = fakeAudio();
let speech: ReturnType<typeof fakeSpeech>;
beforeEach(() => {
  audio.played.length = 0;
  speech = fakeSpeech();
  vi.stubGlobal('window', { AudioContext: audio.Ctx });
  vi.stubGlobal('speechSynthesis', speech.synth);
  vi.stubGlobal('SpeechSynthesisUtterance', speech.Utterance);
});
afterEach(() => vi.unstubAllGlobals());

describe('the voice pack', () => {
  it('has the 30 fixed names: the ten lines (lost-bar, 3.4b) and count-1 to count-20', () => {
    expect(VOICE_KEYS).toHaveLength(30);
    expect(VOICE_KEYS.slice(0, 10)).toEqual(['squat', 'rack', 'start', 'press', 'down', 'good-spot', 'bar-loaded', 'weights-ready', 'good-lift', 'lost-bar']);
    expect(VOICE_WORDS['lost-bar']).toBe('We lost the bar.');
    expect(VOICE_KEYS.slice(10)).toEqual(Array.from({ length: 20 }, (_, i) => `count-${i + 1}`));
  });

  it('voices/team/pack.json names only files of the pack, and every file it names is there', () => {
    const dir = join(PUBLIC, 'voices/team');
    const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as { files: Record<string, string> };
    for (const [k, file] of Object.entries(pack.files)) {
      expect(VOICE_KEYS, `${k} is a pack name`).toContain(k);
      expect(existsSync(join(dir, file)), `${file} is in voices/team/`).toBe(true);
    }
  });

  it('has the soft counts "one" to "twenty", at half the command volume (look 5.14b)', () => {
    COUNTS.forEach((w, i) => expect(VOICE_WORDS[`count-${i + 1}` as VoiceKey]).toBe(w));
    for (const k of VOICE_KEYS) expect(volumeOf(k), k).toBe(k.startsWith('count-') ? 0.5 : 1);
  });
});

describe('VOICE_PACK', () => {
  let root: string;
  beforeEach(() => {
    // A copy of `team`, renamed `soo`, with a recording at every name, the counts included.
    root = mkdtempSync(join(tmpdir(), 'voices-'));
    cpSync(join(PUBLIC, 'voices/team'), join(root, 'voices/soo'), { recursive: true });
    const files = Object.fromEntries(VOICE_KEYS.map(k => [k, `${k}.m4a`]));
    for (const k of VOICE_KEYS) writeFileSync(join(root, 'voices/soo', `${k}.m4a`), `soo:${k}`);
    writeFileSync(join(root, 'voices/soo/pack.json'), JSON.stringify({ files }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('VOICE_PACK=soo loads voices/soo/ with no code change, the counts included', async () => {
    const v = new Voice('soo', diskFetcher(root));
    expect(v.base).toBe('/voices/soo/');
    await v.load();
    for (const k of VOICE_KEYS) expect(v.has(k), k).toBe(true);
    v.say('count-7');
    expect(audio.played.at(-1)).toMatchObject({ buffer: { decoded: 'soo:count-7' }, gain: 0.5 });
    v.say('squat');
    expect(audio.played.at(-1)).toMatchObject({ buffer: { decoded: 'soo:squat' }, gain: 1 });
    expect(speech.spoken).toHaveLength(0);
  });

  it('a name that isn\'t a plain folder name falls back to team', () => {
    expect(new Voice('../secret').base).toBe('/voices/team/');
    expect(new Voice('soo/../../x').base).toBe('/voices/team/');
  });

  it('a missing pack or file leaves the Web Speech stand-in in its place', async () => {
    rmSync(join(root, 'voices/soo/rack.m4a'));
    const v = new Voice('soo', diskFetcher(root));
    await v.load();
    expect(v.has('rack')).toBe(false);
    v.say('rack');
    expect(speech.spoken.at(-1)).toMatchObject({ text: 'Rack!' });
    const none = new Voice('nobody', diskFetcher(root));
    await none.load();
    expect(VOICE_KEYS.some(k => none.has(k))).toBe(false);
  });
});

describe('saying a command', () => {
  it('a recording starts at once, inside 300 ms of the call', async () => {
    const v = new Voice('team', (async (u: string | URL) =>
      String(u).endsWith('pack.json') ? Response.json({ files: { squat: 'squat.m4a' } }) : new Response('x')) as typeof fetch);
    await v.load();
    const t = performance.now();
    v.say('squat');
    const p = audio.played.at(-1)!;
    // start() with no time is "now" in Web Audio; nothing waits before it.
    expect(p.when).toBeUndefined();
    expect(p.at - t).toBeLessThan(300);
  });

  it('the stand-in speaks at once, at rate 0.95 and pitch 0.9, with no other voice service', () => {
    const fetcher = vi.fn();
    const v = new Voice('team', fetcher as unknown as typeof fetch);
    const t = performance.now();
    v.say('squat');
    v.say('count-3');
    expect(fetcher).not.toHaveBeenCalled();
    expect(speech.spoken).toEqual([
      expect.objectContaining({ text: 'Squat!', rate: 0.95, pitch: 0.9, volume: 1 }),
      expect.objectContaining({ text: 'three', rate: 0.95, pitch: 0.9, volume: 0.5 }),
    ]);
    expect(speech.spoken[0].at - t).toBeLessThan(300);
    // A late command cuts off one still speaking, so it isn't queued behind it.
    expect(speech.synth.cancel).toHaveBeenCalledTimes(2);
  });

  it('with spoken commands off, nothing is played or spoken', async () => {
    const v = new Voice('team', (async () => new Response('', { status: 404 })) as unknown as typeof fetch);
    v.on = false;
    for (const k of VOICE_KEYS) v.say(k);
    expect(speech.spoken).toHaveLength(0);
    expect(audio.played).toHaveLength(0);
  });
});
