// The demo strip (plan 5.36, look 5.14a): on every demo screen. "Leave the demo" ends the demo
// session (a form post, so it works before the page's script loads).
import '@/app/demo.css';

export function DemoStrip() {
  return (
    <div className="demo-strip">
      <span className="eyebrow">DEMO MEET · NOTHING HERE COUNTS</span>
      <form method="post" action="/api/demo/leave"><button type="submit">Leave the demo</button></form>
    </div>
  );
}
