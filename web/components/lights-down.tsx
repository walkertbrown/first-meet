// Look 2: on meet weekend the platform screens (5.24–5.28) and the corner page go Lights down,
// unless she picked Day. A page that should be dark renders this hidden mark; globals.css gives
// `:root:has(.lights-down)` the Lights down tokens unless the page's theme is Day
// (`data-theme="light"`, her choice on this device, or `?theme=light`). It is plain CSS: there is
// no light first paint, and leaving the page leaves the theme as it was.
export function LightsDown() {
  return <i className="lights-down" hidden aria-hidden="true" />;
}
