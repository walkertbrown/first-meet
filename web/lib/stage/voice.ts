// The commands' voice (plan piece 2, look 7 sound).
// A voice pack is web/public/voices/<pack>/pack.json, served at /voices/<pack>/:
//   { "files": { "squat": "squat.m4a", "rack": "rack.m4a", ..., "count-20": "count-20.m4a" } }
// VOICE_PACK picks the pack (default "team"). Until Walker records the team pack
// (#voice-lines), or if a file is missing, the stand-in is the phone's own Web Speech
// voice at rate 0.95, pitch 0.9. No text-to-speech service is used.
import { audio } from './thock';

export const VOICE_KEYS = [
  'squat', 'rack', 'start', 'press', 'down', 'good-spot', 'bar-loaded', 'weights-ready', 'good-lift', 'lost-bar',
  ...Array.from({ length: 20 }, (_, i) => `count-${i + 1}` as const),
] as const;
export type VoiceKey = (typeof VOICE_KEYS)[number];

const COUNT_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** The words each recording says, which the Web Speech stand-in speaks. */
export const VOICE_WORDS: Record<VoiceKey, string> = {
  squat: 'Squat!', rack: 'Rack!', start: 'Start!', press: 'Press!', down: 'Down!',
  'good-spot': 'Good spot.', 'bar-loaded': 'Bar is loaded.', 'weights-ready': 'Weights ready.', 'good-lift': 'Good lift.',
  // 3.4b: the bench's plate was lost, before "Start!" (tap again) or out of the rack (the void sheet)
  'lost-bar': 'We lost the bar.',
  ...Object.fromEntries(COUNT_WORDS.map((w, i) => [`count-${i + 1}`, w])),
} as Record<VoiceKey, string>;

/** Soft counts play at half the command volume (look 5.14b). */
export const volumeOf = (k: VoiceKey) => (k.startsWith('count-') ? 0.5 : 1);

export type PackFile = { files: Partial<Record<VoiceKey, string>> };

export class Voice {
  on = true;
  private buffers = new Map<VoiceKey, AudioBuffer>();
  private loaded: Promise<void> | null = null;
  constructor(readonly pack: string, private fetcher: typeof fetch = (...a) => fetch(...a)) {}

  /** The pack's folder. Only plain names are allowed, so VOICE_PACK can't point anywhere else. */
  get base() { return `/voices/${/^[a-z0-9-]+$/.test(this.pack) ? this.pack : 'team'}/`; }

  /** Fetches and decodes the pack. A missing pack or file leaves the stand-in voice in its place. */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      let pack: PackFile;
      try {
        const r = await this.fetcher(this.base + 'pack.json');
        if (!r.ok) return;
        pack = await r.json();
      } catch { return; }
      const a = audio();
      if (!a) return;
      await Promise.all(Object.entries(pack.files ?? {}).map(async ([k, file]) => {
        try {
          const r = await this.fetcher(this.base + file);
          if (r.ok) this.buffers.set(k as VoiceKey, await a.decodeAudioData(await r.arrayBuffer()));
        } catch { /* stand-in voice for this one */ }
      }));
    })();
    return this.loaded;
  }

  has(k: VoiceKey) { return this.buffers.has(k); }

  /**
   * Call on her tap ("Open the camera"): phones only allow sound and speech that start
   * from a tap, and a silent first utterance gets Web Speech ready so the first
   * command isn't late.
   */
  unlock() {
    audio();
    if (typeof speechSynthesis !== 'undefined' && !this.buffers.size) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  }

  say(k: VoiceKey) {
    if (!this.on) return;
    const buf = this.buffers.get(k);
    const a = audio();
    if (buf && a) {
      const src = a.createBufferSource();
      const g = a.createGain();
      g.gain.value = volumeOf(k);
      src.buffer = buf;
      src.connect(g).connect(a.destination);
      src.start();
      return;
    }
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(VOICE_WORDS[k]);
    u.rate = 0.95;
    u.pitch = 0.9;
    u.volume = volumeOf(k);
    speechSynthesis.speak(u);
  }
}
