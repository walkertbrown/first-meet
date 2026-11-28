'use client';
// Taps a button again that she tapped before the page ran (web/lib/early-taps.ts).
import { useEffect } from 'react';
import { replayEarlyTap } from '@/lib/early-taps';

export function EarlyTaps() {
  useEffect(() => { replayEarlyTap(); }, []);
  return null;
}
