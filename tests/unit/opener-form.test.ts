// "Save my openers" as a plain form, tapped before the page's script ran (5.23; The Playner, Nov 28).
import { describe, expect, it } from 'vitest';
import { formPicks } from '@/lib/opener-form';

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe('the picks a plain "Save my openers" form sends', () => {
  it('Barbell: opener-<lift> per lift', () => {
    expect(formPicks(form({ 'opener-squat': '135', 'opener-bench': '85', 'opener-deadlift': '155' }))).toEqual([
      { lift: 'squat', weight: 135, reps: null }, { lift: 'bench', weight: 85, reps: null }, { lift: 'deadlift', weight: 155, reps: null }]);
  });
  it('Home: weight-<lift> with reps-<lift>; a decimal weight stays exact', () => {
    expect(formPicks(form({ 'weight-squat': '22.5', 'reps-squat': '12' }))).toEqual([{ lift: 'squat', weight: 22.5, reps: 12 }]);
  });
  it('a locked lift sends nothing and is left out; nothing at all, or junk, is no picks', () => {
    expect(formPicks(form({ 'opener-deadlift': '155' }))).toEqual([{ lift: 'deadlift', weight: 155, reps: null }]);
    expect(formPicks(form({}))).toBeNull();
    expect(formPicks(form({ 'opener-squat': 'heavy', 'opener-press': '50' }))).toBeNull();
  });
});
