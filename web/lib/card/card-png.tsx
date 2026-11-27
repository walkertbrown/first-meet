// The card PNG itself (plan 5.30): the Story or Post component through Satori with the card fonts.
// render_clip's end card fetches this same PNG, so the clip and the images are one drawing.
import { ImageResponse } from 'next/og';
import { cardFonts } from '@/lib/card/card-fonts';
import { BestLiftCard, FORMATS, PostCard, StoryCard, type CardFormat } from '@/lib/card/card-image';
import type { CardView } from '@/lib/card/card-view';
import type { BestLiftView } from '@/lib/card/best-lift';

/** A bomb-out clip's end frame (item 101): 1080 × 1920, the story card's size. */
export async function bestLiftImage(v: BestLiftView): Promise<ImageResponse> {
  return new ImageResponse(<BestLiftCard v={v} />, { ...FORMATS.story, fonts: await cardFonts() });
}

export async function cardImage(v: CardView, f: CardFormat): Promise<ImageResponse> {
  const fonts = await cardFonts();
  const el = f === 'post' ? <PostCard v={v} /> : <StoryCard v={v} />;
  return new ImageResponse(el, { ...FORMATS[f], fonts });
}
