'use client';
/* eslint-disable @next/next/no-img-element -- the card PNGs are drawn at their final size by /api/card */
// 5.5's card, and "Watch her lift" once her clip is on her card link: the clip plays in the card's place.
import { useState } from 'react';

export function WatchHerLift({ token, name, clip }: { token: string; name: string; clip: boolean }) {
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <div className="card-frame story">
        {playing
          ? <video src={`/api/card/${token}.mp4`} controls autoPlay playsInline aria-label={`${name}'s lift clip`} />
          : <img src={`/api/card/${token}.png?f=story`} alt={`${name}'s meet card`} width={1080} height={1920} />}
      </div>
      {clip && !playing && (
        <div className="try-actions card-watch">
          <button className="btn ghost" type="button" onClick={() => setPlaying(true)}>Watch her lift</button>
        </div>
      )}
    </>
  );
}
