// The card PNG itself (plan 5.30): the Story or Post component through Satori with the card fonts, drawn off
// the server's thread (card-draw.ts). render_clip's end card fetches this same PNG, so the clip and the images
// are one drawing.
import type { ReactNode } from 'react';
import { drawPng, drawWithin, png, pngResponse, type Priority } from '@/lib/card/card-draw';
import { BestLiftCard, FORMATS, PostCard, StoryCard, type CardFormat } from '@/lib/card/card-image';
import type { CardView } from '@/lib/card/card-view';
import type { BestLiftView } from '@/lib/card/best-lift';

/** How long a clip run's ask for its end card waits before it's told to ask again (worker/main.py waits 60 s). */
export const CLIP_ASK_MS = 20_000;
/** The seconds render_clip waits before it asks for a card not drawn yet. */
export const RETRY_AFTER_S = 3;

const cardEl = (v: CardView, f: CardFormat): ReactNode => (f === 'post' ? <PostCard v={v} /> : <StoryCard v={v} />);

/** A bomb-out clip's end frame (item 101): 1080 × 1920, the story card's size. Only render_clip asks for it. */
export function bestLiftImage(v: BestLiftView, ms = CLIP_ASK_MS): Promise<Response> {
  return forClip(<BestLiftCard v={v} />, ms);
}

/** Her card, for a person (her card page, her card link, a link preview). */
export function cardImage(v: CardView, f: CardFormat, prio: Priority = 'asked'): Promise<Response> {
  return pngResponse(cardEl(v, f), FORMATS[f], prio);
}

/** Her Story as a claimed clip's end card: first in line, and a 503 to ask again if it isn't drawn in `ms`. */
export function clipCardImage(v: CardView, ms = CLIP_ASK_MS): Promise<Response> {
  return forClip(cardEl(v, 'story'), ms);
}

async function forClip(el: ReactNode, ms: number): Promise<Response> {
  const b = await drawWithin(el, FORMATS.story, 'clip', ms);
  if (b) return png(b);
  return Response.json({ error: 'the card is still being drawn' }, { status: 503, headers: { 'Retry-After': String(RETRY_AFTER_S), 'Cache-Control': 'no-store' } });
}

/** Her cards drawn ahead, behind anyone waiting (her result just settled). Never fails the caller. */
export function drawCardsAhead(v: CardView): Promise<unknown> {
  return Promise.allSettled([drawPng(cardEl(v, 'story'), FORMATS.story, 'ahead'), drawPng(cardEl(v, 'post'), FORMATS.post, 'ahead')]);
}

export function drawEndFrameAhead(v: BestLiftView): Promise<unknown> {
  return Promise.allSettled([drawPng(<BestLiftCard v={v} />, FORMATS.story, 'ahead')]);
}
