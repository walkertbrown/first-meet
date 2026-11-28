// The end card's content hash (item 119). Her Story, the card her clip ends on, is drawn from her CardView
// alone, so the hash of the view is the hash of the card: the same view, the same card.
import { createHash } from 'node:crypto';
import type { CardView } from '@/lib/card/card-view';

export const endCardHash = (v: CardView) => createHash('sha256').update(JSON.stringify(v)).digest('base64url').slice(0, 22);
