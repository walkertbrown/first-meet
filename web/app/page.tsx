// Landing (plan 5.1). Every word in quotes there is here, exactly.
import Link from 'next/link';
import { Footer, LiftIcon, Wordmark } from '@/components/chrome';
import { LandingLamps } from '@/components/landing-lamps';
import { LandingLoop } from '@/components/landing-loop';
import { RecipeCard } from '@/components/recipe-card';
import { landingRecipe } from '@/lib/recipes';
import { SITE, keepWhole, meetAway } from '@/lib/site';

// "<N> weeks away" moves with the clock: rebuild the page every hour.
export const revalidate = 3600;

const QUESTIONS: [string, string][] = [
  [
    "I've never lifted. Is this for me?",
    'Yes. First Meet is built for women who have never lifted or competed. Week 1 starts with the empty bar or your lightest dumbbell, and every weight after that moves by how it felt.',
  ],
  [
    "I don't have a gym.",
    'Choose the Home division. You need a pair of dumbbells or a kettlebell, a floor and a phone. Each attempt is a set of reps at your weight, and your score is the weight times the reps. Get stronger and it goes up, with no new equipment.',
  ],
  [
    'Is it safe?',
    "We never ask you to lift your maximum. Your meet attempts can only be weights you've already lifted in training. Every session asks if anything hurt and makes the next one lighter if it did. Before you start, we'll ask a few health questions. If you have a health condition, check with your doctor first.",
  ],
  [
    'Who sees my videos?',
    'In Try a lift and training, nobody: your phone judges you and nothing is uploaded. Your meet attempts are seen by the judge, the referees and, if you choose, your corner. You can delete every video any time.',
  ],
  [
    'Do I have to weigh in?',
    "No. There are no scales at First Meet. You're placed by your total within your division and age group.",
  ],
  [
    "What if I'm busy on meet weekend?",
    'The platform is open from Friday 6 am to Saturday 6 pm Eastern. Lift your nine attempts whenever suits you, in one go.',
  ],
  [
    'Is Love Soo involved?',
    "First Meet is a prototype made for Love Soo's audience for a hackathon. If she hosts, she'll host meet night live on her YouTube.",
  ],
];

export default function Landing() {
  const recipe = landingRecipe();
  return (
    <div className="wrap landing">
      <header className="topbar">
        <Wordmark />
        <Link className="link" href="/signin">Sign in</Link>
      </header>

      <main>
        <section className="hero">
          <div className="hero-text">
            <p className="eyebrow">Hosted by Love Soo · @lovesoostrong</p>
            <h1 className="page-title hero-title">Your first powerlifting meet. From home.</h1>
            <p className="body-l">
              Train for 12 weeks. Lift on meet weekend with your phone as the referee. Love Soo reads the totals live.
            </p>
            <LandingLamps />
            <div className="hero-actions">
              <div>
                <Link className="btn" href="/try">Try a lift</Link>
                <p className="small hero-under">60 seconds · no sign-up · your video stays on your phone</p>
              </div>
              <Link className="btn ghost" href="/sample">Watch a meet night</Link>
            </div>
          </div>
          <div className="hero-stage">
            <LandingLoop />
          </div>
        </section>

        {recipe && (
          <section className="block" aria-label="This week's recipe">
            <RecipeCard r={recipe} />
          </section>
        )}

        <section className="block card next-meet" aria-labelledby="next-meet">
          <p className="eyebrow" id="next-meet">Next meet</p>
          <p className="weight-m">{SITE.meet.name}</p>
          <p className="body">{keepWhole(`${SITE.meet.datesLong} · Soo is live Saturday at 8 pm Eastern`)}</p>
          <p className="small">{meetAway()}</p>
        </section>

        <section className="block" aria-labelledby="how">
          <h2 className="eyebrow" id="how">How it works</h2>
          <ol className="how">
            <li>
              <LiftIcon name="squat" size={32} />
              <div>
                <p className="strong">Train 12 weeks.</p>
                <p className="body">Three sessions a week, about 40 minutes. At a gym with a barbell, or at home with dumbbells.</p>
              </div>
            </li>
            <li>
              <LiftIcon name="bench" size={32} />
              <div>
                <p className="strong">Lift on meet weekend.</p>
                <p className="body">
                  Nine attempts, any time from Friday morning to Saturday evening. Your phone calls the commands, and three referee lights judge every lift.
                </p>
              </div>
            </li>
            <li>
              <LiftIcon name="deadlift" size={32} />
              <div>
                <p className="strong">Soo reads the totals.</p>
                <p className="body">Saturday night, every woman who made a total is on Soo&apos;s live.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="block" aria-labelledby="divisions">
          <h2 className="eyebrow" id="divisions">Two divisions</h2>
          <div className="divisions">
            <div className="card">
              <h3 className="sheet-title">Barbell</h3>
              <p className="body">Squat, bench press, deadlift. At a gym.</p>
            </div>
            <div className="card">
              <h3 className="sheet-title">Home</h3>
              <p className="body">
                Goblet squat, floor press, deadlift with dumbbells or a kettlebell. In your living room. Scored on weight × good reps, so your number grows with the same dumbbells.
              </p>
            </div>
          </div>
        </section>

        <figure className="block quote">
          <blockquote>Not chasing after skinny, chasing after STRONG.</blockquote>
          <figcaption className="caption">Love Soo, on YouTube</figcaption>
        </figure>

        <section className="block" aria-labelledby="cost">
          <h2 className="eyebrow" id="cost">What it costs</h2>
          <p className="price">
            <span className="weight-m">{SITE.price.block}</span> <span className="body">for 12 weeks of training and the meet</span>
          </p>
          <p className="body">{SITE.price.season} for a year: four meets.</p>
          <p className="small">Try a lift, meet night and the weekly recipe are free.</p>
        </section>

        <section className="block" aria-labelledby="questions">
          <h2 className="eyebrow" id="questions">Questions</h2>
          <div className="questions">
            {QUESTIONS.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p className="body">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
