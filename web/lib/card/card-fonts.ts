// The card images' fonts (look 9 "The card images"): static TTF instances in web/card-fonts, cut by
// scripts/cut-card-fonts.py. Satori can't read variable fonts or woff2, and has no font-stretch, so each
// weight and width is registered as its own family (the names in card-image.tsx's F).
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type SatoriFont = { name: string; data: ArrayBuffer; weight: 400 | 700 | 800 | 900; style: 'normal' | 'italic' };

const FILES: { file: string; name: string; weight: SatoriFont['weight']; style?: 'italic' }[] = [
  { file: 'anybody-900-130.ttf', name: 'Anybody 900 130', weight: 900 },
  { file: 'anybody-900-120.ttf', name: 'Anybody 900 120', weight: 900 },
  { file: 'anybody-800-112.ttf', name: 'Anybody 800 112', weight: 800 },
  { file: 'anybody-800-104.ttf', name: 'Anybody 800 104', weight: 800 },
  { file: 'anybody-800-88.ttf', name: 'Anybody 800 88', weight: 800 },
  { file: 'anybody-700-100.ttf', name: 'Anybody 700 100', weight: 700 },
  { file: 'anybody-700-88.ttf', name: 'Anybody 700 88', weight: 700 },
  { file: 'atkinson-400.ttf', name: 'Atkinson 400', weight: 400 },
  { file: 'atkinson-400-italic.ttf', name: 'Atkinson 400 italic', weight: 400, style: 'italic' },
];

/** `next start web` and vitest run from the repo root; a process started inside web/ works too. */
export const FONT_DIR = () => path.join(process.cwd().endsWith(`${path.sep}web`) ? process.cwd() : path.join(process.cwd(), 'web'), 'card-fonts');

let cache: Promise<SatoriFont[]> | null = null;

export function cardFonts(): Promise<SatoriFont[]> {
  cache ??= Promise.all(
    FILES.map(async (f): Promise<SatoriFont> => {
      const b = await readFile(path.join(FONT_DIR(), f.file));
      return { name: f.name, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, weight: f.weight, style: f.style ?? 'normal' };
    }),
  ).catch(e => {
    cache = null;
    throw e;
  });
  return cache!;
}
