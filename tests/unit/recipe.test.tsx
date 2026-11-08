// The weekly recipe page and landing card (plan 5.20), rendered from cards shaped like
// content/recipes.json's (The Playner's playner/recipes.md).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecipeCard } from '../../web/components/recipe-card';
import { RecipeBody } from '../../web/components/recipe-page';
import { RECIPES, landingRecipe, recipeFor } from '../../web/lib/recipes';
import type { Recipe } from '../../web/lib/recipes';

const card: Recipe = {
  week: 1, dish: 'Test dish', hangul: '테스트', protein_g: 32, serves: 2,
  video_id: 'abc123XYZ_-', video_title: 'A test video', video_shape: 'wide',
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
  it('the frame takes the video\'s shape: a Short is 9:16, anything else 16:9', () => {
    expect(html).toContain('class="recipe-video wide"');
    expect(renderToStaticMarkup(<RecipeBody r={{ ...card, video_shape: 'short' }} />)).toContain('class="recipe-video short"');
  });
});

describe('content/recipes.json', () => {
  it('every card is whole, with a known frame shape and no calories', () => {
    expect(RECIPES.length).toBeGreaterThan(0);
    for (const r of RECIPES) {
      expect(r.dish && r.hangul && r.video_id && r.video_title && r.vegetarian, `week ${r.week}`).toBeTruthy();
      expect(r.video_id, `week ${r.week}`).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(['short', 'wide']).toContain(r.video_shape);
      expect(r.protein_g).toBeGreaterThan(0);
      expect(r.serves).toBeGreaterThan(0);
      expect(r.ingredients.length).toBeGreaterThan(0);
      expect(JSON.stringify(r).toLowerCase()).not.toMatch(/calor|kcal/);
    }
  });
  it('weeks are numbered 1 up, once each', () => {
    expect(RECIPES.map(r => r.week)).toEqual(RECIPES.map((_, i) => i + 1));
  });
  it('week 1 is Soo\'s kimchi jjigae, a Short, 20 g a serving for 2', () => {
    expect(recipeFor(1)).toMatchObject({
      dish: 'Kimchi jjigae', hangul: '김치찌개', video_id: 'MhksN_jTEMo', video_shape: 'short', protein_g: 20, serves: 2,
    });
  });
});

describe('the landing card', () => {
  it('reads "Kimchi jjigae", "김치찌개", "20 g protein a serving", "Open recipe", and links to /recipes/1', () => {
    const html = renderToStaticMarkup(<RecipeCard r={landingRecipe()!} />);
    for (const t of ['Kimchi jjigae', '김치찌개', '20 g protein a serving', 'Open recipe']) expect(html).toContain(t);
    expect(html).toContain('href="/recipes/1"');
  });
});
