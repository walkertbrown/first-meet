import data from '../../content/recipes.json';

/** One week's card (plan 5.20). No calories, ever. */
export type Recipe = {
  week: number;
  dish: string;
  hangul: string;
  proteinG: number;
  serves: number;
  video: { id: string; title: string };
  ingredients: string[];
  vegetarian: string;
};

export const RECIPES = (data as { weeks: Recipe[] }).weeks;

export const recipeFor = (week: number): Recipe | undefined => RECIPES.find(r => r.week === week);

/** The landing card's week: before a block starts it shows week 1 (plan 5.1). */
export const landingRecipe = (): Recipe | undefined => recipeFor(1);
