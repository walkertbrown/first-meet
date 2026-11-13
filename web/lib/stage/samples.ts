// The sample lifts (plan 5.2, the sample lift path): content/samples/samples.json,
// with each clip's source, licence and credit in content/samples/SOURCES.md.
// The clips are copied to web/public/samples/ at install and build (scripts/copy-content.mjs).
import samples from '../../../content/samples/samples.json';

export type Sample = {
  id: string;
  /** "good" is a good lift; "no" is a no lift, only from a clip made to demonstrate that fault;
   * "close" is the demo meet's close call (5.36), never played by Try a lift. */
  kind: 'good' | 'no' | 'close';
  file: string;
  /** "This is a sample lift from <credit>." */
  credit: string;
  /** The frame the worker judges, in ms (piece 6 checks it): held from "Sending to the judges". */
  judged_frame_ms?: number;
};

export const SAMPLES = samples.clips as Sample[];
export const sampleSrc = (s: Sample) => `/samples/${s.file}`;
export const sampleOf = (kind: Sample['kind']) => SAMPLES.find(s => s.kind === kind) ?? null;
