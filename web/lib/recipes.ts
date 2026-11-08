import data from '../../content/recipes.json';

/**
 * One week's card (plan 5.20), in the shape The Playner writes it in playner/recipes.md,
 * so each week pastes in as given. No calories, ever.
 */
export type Recipe = {
  week: number;
  dish: string;
  hangul: string;
  video_id: string;
  video_title: string;
  /** The embed frame's shape: a YouTube Short is 9:16, anything else 16:9. */
  video_shape: 'short' | 'wide';
  protein_g: number;
  serves: number;
  ingredients: string[];
  vegetarian: string;
};

export const RECIPES = (data as { weeks: Recipe[] }).weeks;

export const recipeFor = (week: number): Recipe | undefined => RECIPES.find(r => r.week === week);

/** The landing card's week: before a block starts it shows week 1 (plan 5.1). */
export const landingRecipe = (): Recipe | undefined => recipeFor(1);
