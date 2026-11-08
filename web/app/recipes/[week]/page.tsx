import { notFound } from 'next/navigation';
import { Footer, Wordmark } from '@/components/chrome';
import { RecipeBody } from '@/components/recipe-page';
import { RECIPES, recipeFor } from '@/lib/recipes';

// One page per week in content/recipes.json (plan 5.20); any other week is a 404.
export const dynamicParams = false;
export function generateStaticParams() {
  return RECIPES.map(r => ({ week: String(r.week) }));
}

type Props = { params: Promise<{ week: string }> };

export async function generateMetadata({ params }: Props) {
  const r = recipeFor(Number((await params).week));
  return { title: r ? `${r.dish} · Week ${r.week} recipe` : 'Recipe' };
}

export default async function Page({ params }: Props) {
  const r = recipeFor(Number((await params).week));
  if (!r) notFound();
  return (
    <div className="wrap page">
      <header className="topbar"><Wordmark /></header>
      <main className="prose">
        <RecipeBody r={r} />
      </main>
      <Footer />
    </div>
  );
}
