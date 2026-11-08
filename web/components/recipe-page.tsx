import type { Recipe } from '@/lib/recipes';

/** One week's recipe (plan 5.20). Protein is the one number; no calories anywhere. */
export function RecipeBody({ r }: { r: Recipe }) {
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(r.video.id)}`;
  return (
    <article className="recipe">
      <p className="eyebrow">This week&apos;s recipe · Week {r.week}</p>
      <h1 className="sheet-title recipe-title">
        {r.dish} <span className="hangul" lang="ko">{r.hangul}</span>
      </h1>
      <div className="obangsaek recipe-band" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <figure className="recipe-video">
        <div className="frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(r.video.id)}`}
            title={r.video.title}
            loading="lazy"
            allow="encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
        <figcaption className="caption">Love Soo on YouTube · {r.video.title}</figcaption>
      </figure>
      <p className="recipe-numbers">
        <span className="weight-m">{r.proteinG} g</span>
        <span className="small">protein a serving · serves {r.serves}</span>
      </p>
      <h2>Ingredients</h2>
      <ul>{r.ingredients.map(i => <li key={i}>{i}</li>)}</ul>
      <p><span className="strong">Vegetarian?</span> {r.vegetarian}</p>
      <h2>How it&apos;s worked out</h2>
      <p className="small">Ingredients are from Soo&apos;s video. Protein is worked out by the First Meet team from USDA FoodData Central, and is approximate.</p>
      <p><a className="link" href={watch}>Watch on YouTube</a></p>
    </article>
  );
}
