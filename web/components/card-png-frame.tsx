'use client';
/* eslint-disable @next/next/no-img-element -- the card PNGs are drawn at their final size by /api/card */
// A card PNG in its frame (her card page 5.30, her public card 5.5). Until the image is there the frame
// pulses (look 5.15: `--surface-2`, 1 → .6 → 1 over 1.6 s, held at .8 with motion off). The card PNG is
// opaque, so it covers the pulse the moment it's painted, and `data-drawn` then stops it. An image that
// loaded before the page hydrated counts too.
import { useCallback, useState } from 'react';

export function CardPng({ kind, src, alt, height }: { kind: 'story' | 'post'; src: string; alt: string; height: number }) {
  const [drawn, setDrawn] = useState(false);
  const seen = useCallback((img: HTMLImageElement | null) => { if (img?.complete && img.naturalWidth > 0) setDrawn(true); }, []);
  return (
    <div className={`card-frame ${kind} drawing`} data-drawn={drawn ? '' : undefined}>
      <img ref={seen} src={src} alt={alt} width={1080} height={height} onLoad={() => setDrawn(true)} />
    </div>
  );
}
