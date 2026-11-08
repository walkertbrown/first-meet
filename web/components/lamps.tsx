export type LampState = 'off' | 'white' | 'red' | 'pulse';

export function lampsLabel(states: LampState[]): string {
  if (states.every(s => s === 'white')) return 'Referee lights: three white lights, good lift';
  if (states.every(s => s === 'red')) return 'Referee lights: three red lights, no lift';
  if (states.includes('pulse')) return 'Referee lights: waiting for a referee';
  if (states.some(s => s !== 'off')) return `Referee lights: ${states.filter(s => s === 'white').length} white, ${states.filter(s => s === 'red').length} red`;
  return 'Referee lights: off';
}

/** Three referee lamps (look 2). Size is the lamp's diameter; the gap scales with it (68 → 24). */
export function Lamps({ states, size = 68, className = 'lamps', settled = false }: { states: LampState[]; size?: number; className?: string; settled?: boolean }) {
  const gap = Math.round((size * 24) / 68);
  return (
    <div className={className} role="img" aria-label={lampsLabel(states)} style={size === 68 ? undefined : { gap }}>
      {states.map((s, i) => (
        <div
          key={i}
          className={`lamp${s !== 'off' ? ' ' + s : ''}${settled ? ' settled' : ''}`}
          style={size === 68 ? undefined : { width: size, height: size, boxShadow: undefined }}
        />
      ))}
    </div>
  );
}
