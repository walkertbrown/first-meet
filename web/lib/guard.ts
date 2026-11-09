// Pages that need a role (plan 3.1): anyone without it gets that section's 403 page.
// Until sign-in arrives (phase 6) a signed-out visitor gets the same page.
import { forbidden } from 'next/navigation';
import { db, hasDb } from '@/db';
import { currentViewer, type Viewer } from '@/lib/roles';

export type Role = 'referee' | 'admin' | 'host';
export const hasRole = (v: Viewer | null, role: Role) =>
  !!v && (role === 'referee' ? v.isReferee : role === 'admin' ? v.isAdmin : v.isHost);

export async function requireRole(role: Role): Promise<Viewer> {
  const v = hasDb() ? await currentViewer(db()) : null;
  if (!hasRole(v, role)) forbidden();
  return v!;
}
