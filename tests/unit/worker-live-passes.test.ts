// The Playner, 13 Nov: CI's worker test feeds the landmarker exactly as the live judge does. Both go
// through worker/poses.py's first_pass and second_pass, so a sample's saved judged frame that the live
// server wouldn't send fails CI. (Run unsplit, the close call read 1200 ms in CI, 1000 ms on staging.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');

describe('the worker test runs the live server\'s two passes', () => {
  it('the live worker and the CLI share them', () => {
    const main = read('worker/main.py'), cli = read('worker/cli.py');
    expect(main).toContain('f1 = poses.first_pass(path, info.duration)');
    expect(main).toContain("f2 = poses.second_pass(path, info.duration, zoom.get('windows', []), zoom.get('split_ms'))");
    expect(cli).toContain('poses.first_pass(a.clip, info.duration) if a.pass1 else poses.second_pass(a.clip, info.duration, json.loads(a.windows), a.split)');
    expect(read('worker/poses.py')).toContain('return find_split(path, first, middle(first))');
  });
  it('the samples go through them in the worker test', () => {
    const t = read('tests/worker/worker.test.ts');
    expect(t).toContain("const first = runFile(file, ['--pass1']);");
    expect(t).toContain("runFile(file, ['--windows', JSON.stringify(zoom.windows)");
  });
});
