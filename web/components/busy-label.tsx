/**
 * Look 5.1 (Nov 27, item 118): a button that isn't full width never changes width when its label does. Both labels
 * sit in one grid cell, the one not showing at `visibility: hidden` (so it holds its space but isn't read out), and
 * the button is as wide as the wider of the two.
 */
export function BusyLabel({ busy, rest, ing }: { busy: boolean; rest: string; ing: string }) {
  return (
    <span className="busy-label" data-busy={busy ? 'true' : undefined}>
      <span>{rest}</span>
      <span>{ing}</span>
    </span>
  );
}
