'use client';
// The meet window's words with her own time beside Eastern (3.11, 5.28): the server renders Eastern
// only, and her phone adds its own zone once it's running.
import { useEffect, useState } from 'react';
import { WINDOW_WORDS, waitingClipBody } from '@/lib/stage/meet-words';

export function useLocalZone(): string | null {
  const [tz, setTz] = useState<string | null>(null);
  useEffect(() => {
    try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null); } catch { /* Eastern only */ }
  }, []);
  return tz;
}

export type WindowSay =
  | { kind: 'waiting'; lift: string; number: number; division: 'barbell' | 'home'; deadline: string }
  | { kind: 'closed'; closesAt: string }
  | { kind: 'late'; deadline: string };

export function windowSentence(s: WindowSay, tz: string | null): string {
  if (s.kind === 'waiting') return waitingClipBody(s, s.division, s.deadline, tz);
  if (s.kind === 'closed') return WINDOW_WORDS.closedBody(s.closesAt, tz);
  return WINDOW_WORDS.lateBody(s.deadline, tz);
}

export function WindowText({ say }: { say: WindowSay }) {
  return <>{windowSentence(say, useLocalZone())}</>;
}
