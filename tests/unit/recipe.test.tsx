// The weekly recipe page (plan 5.20), rendered from a card shaped like content/recipes.json's.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecipeBody } from '../../web/components/recipe-page';
import { RECIPES } from '../../web/lib/recipes';
import type { Recipe } from '../../web/lib/recipes';

const card: Recipe = {
  week: 1, dish: 'Test dish', hangul: '테스트', proteinG: 32, serves: 2,
  video: { id: 'abc123XYZ_-', title: 'A test video' },
  ingredients: ['2 eggs', '1 cup rice'], vegetarian: 'Use tofu instead of the eggs.',
};

describe('the weekly recipe page', () => {
  const html = renderToStaticMarkup(<RecipeBody r={card} />);
  it('has every part of 5.20, in its words', () => {
    expect(html).toContain('This week&#x27;s recipe · Week 1');
    expect(html).toContain('lang="ko"');
    expect(html).toContain('https://www.youtube-nocookie.com/embed/abc123XYZ_-');
    expect(html).toContain('Love Soo on YouTube · A test video');
    expect(html).toContain('32 g');
    expect(html).toContain('protein a serving · serves 2');
    expect(html).toContain('<li>2 eggs</li>');
    expect(html).toContain('Vegetarian?');
    expect(html).toContain('USDA FoodData Central, and is approximate.');
    expect(html).toContain('href="https://www.youtube.com/watch?v=abc123XYZ_-">Watch on YouTube');
  });
  it('shows no calories anywhere', () => {
    expect(html.toLowerCase()).not.toMatch(/calor|kcal/);
  });
  it('every card in recipes.json is whole and has no calories', () => {
    for (const r of RECIPES) {
      expect(r.dish && r.hangul && r.video.id && r.video.title && r.vegetarian, `week ${r.week}`).toBeTruthy();
      expect(r.proteinG).toBeGreaterThan(0);
      expect(r.ingredients.length).toBeGreaterThan(0);
      expect(JSON.stringify(r).toLowerCase()).not.toMatch(/calor|kcal/);
    }
  });
});
