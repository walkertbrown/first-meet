// The card PNG itself (plan 5.30): the Story or Post component through Satori with the card fonts, drawn off
// the server's thread (card-draw.ts). render_clip's end card fetches this same PNG, so the clip and the images
// are one drawing.
import { pngResponse } from '@/lib/card/card-draw';
import { BestLiftCard, FORMATS, PostCard, StoryCard, type CardFormat } from '@/lib/card/card-image';
import type { CardView } from '@/lib/card/card-view';
import type { BestLiftView } from '@/lib/card/best-lift';

/** A bomb-out clip's end frame (item 101): 1080 × 1920, the story card's size. */
export function bestLiftImage(v: BestLiftView): Promise<Response> {
  return pngResponse(<BestLiftCard v={v} />, FORMATS.story);
}

export function cardImage(v: CardView, f: CardFormat): Promise<Response> {
  return pngResponse(f === 'post' ? <PostCard v={v} /> : <StoryCard v={v} />, FORMATS[f]);
}
