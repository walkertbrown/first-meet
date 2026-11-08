import Link from 'next/link';
import type { Recipe } from '@/lib/recipes';

/** Look 7's recipe card: dish name and Hangul, the obangsaek band, protein the one number. */
export function RecipeCard({ r }: { r: Recipe }) {
  return (
    <article className="card recipe-card">
      <div className="obangsaek" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <p className="eyebrow">This week&apos;s recipe</p>
      <h2 className="sheet-title">
        {r.dish} <span className="hangul" lang="ko">{r.hangul}</span>
      </h2>
      <p className="body">{r.proteinG} g protein a serving</p>
      <Link className="link" href={`/recipes/${r.week}`}>Open recipe</Link>
    </article>
  );
}
