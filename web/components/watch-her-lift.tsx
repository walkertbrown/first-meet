'use client';
// 5.5's card, and "Watch her lift" once her clip is on her card link: the clip plays in the card's place.
import { useState } from 'react';
import { CardPng } from '@/components/card-png-frame';

export function WatchHerLift({ token, name, clip }: { token: string; name: string; clip: boolean }) {
  const [playing, setPlaying] = useState(false);
  return (
    <>
      {playing
        ? <div className="card-frame story"><video src={`/api/card/${token}.mp4`} controls autoPlay playsInline aria-label={`${name}'s lift clip`} /></div>
        : <CardPng kind="story" src={`/api/card/${token}.png?f=story`} alt={`${name}'s meet card`} height={1920} />}
      {clip && !playing && (
        <div className="try-actions card-watch">
          <button className="btn ghost" type="button" onClick={() => setPlaying(true)}>Watch her lift</button>
        </div>
      )}
    </>
  );
}
