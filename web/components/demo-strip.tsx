// The demo strip (plan 5.36, look 5.14a): on every demo screen. "Leave the demo" ends the demo
// session (a form post, so it works before the page's script loads).
// On /demo itself, before she has joined, there's no demo session to end: it's a link home.
import Link from 'next/link';
import '@/app/demo.css';

export function DemoStrip({ joined = true }: { joined?: boolean }) {
  return (
    <div className="demo-strip">
      <span className="eyebrow">DEMO MEET · NOTHING HERE COUNTS</span>
      {joined
        ? <form method="post" action="/api/demo/leave"><button type="submit">Leave the demo</button></form>
        : <Link href="/">Leave the demo</Link>}
    </div>
  );
}
