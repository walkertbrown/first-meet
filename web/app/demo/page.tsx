import type { Metadata } from 'next';
import Link from 'next/link';
import { X } from '@phosphor-icons/react/dist/ssr';
import { DEMO_DEFAULT_NAME } from '@/lib/demo';
import '../try.css';
import '../platform.css';

// /demo (plan 5.36, look 5.14a): the join screens' layout in one 560 px column. "Start the demo
// meet" posts the form, so it works before any script loads. "OR SEE THE TRAINING" comes with
// training, in a later phase.
export const metadata: Metadata = {
  title: 'The demo meet',
  description: 'Lift a real attempt, judged by the real judge, any time. Nothing here counts.',
};

export default function DemoPage() {
  return (
    <div className="try-page">
      <div className="try-top"><Link className="try-close" href="/" aria-label="Back to First Meet"><X weight="bold" /></Link></div>
      <main className="try-col demo-col">
        <h1 className="page-title">The demo meet</h1>
        <p className="body-l">Lift a real attempt, judged by the real judge, any time. Nothing here counts.</p>
        <form className="demo-form" method="post" action="/api/demo/start">
          <label className="field">
            <span className="field-label">Name on your card</span>
            <input className="input" name="card_name" defaultValue={DEMO_DEFAULT_NAME} maxLength={40} autoComplete="off" />
          </label>
          <fieldset className="segments">
            <legend>Division</legend>
            <label><input type="radio" name="division" value="barbell" defaultChecked />Barbell</label>
            <label><input type="radio" name="division" value="home" />Home</label>
          </fieldset>
          <button className="btn" type="submit">Start the demo meet</button>
        </form>
      </main>
    </div>
  );
}
