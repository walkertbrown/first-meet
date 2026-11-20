'use client';
// Whether close calls and benches go to the referee bot (REFEREE_BOT, item 103), for the screens
// that run in the browser. The root layout reads it on the server and hands it down.
import { createContext, useContext } from 'react';
import { refereeWords } from '@/lib/referee/words';

const RefereeBot = createContext(false);

export function RefereeBotProvider({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <RefereeBot.Provider value={on}>{children}</RefereeBot.Provider>;
}

export const useRefereeBot = () => useContext(RefereeBot);
export const useRefereeWords = () => refereeWords(useContext(RefereeBot));
