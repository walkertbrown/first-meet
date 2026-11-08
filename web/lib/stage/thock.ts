// The lamp's thock (look 7, sound), from the sample: a short sine drop.
// White 190 → 95 Hz, red 150 → 70 Hz, over 140 ms; gain to .35 in 8 ms, gone by 220 ms.
let ac: AudioContext | null = null;

export function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  ac ??= new Ctx();
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

export function thock(red = false): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(red ? 150 : 190, t);
  o.frequency.exponentialRampToValueAtTime(red ? 70 : 95, t + 0.14);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + 0.25);
}
