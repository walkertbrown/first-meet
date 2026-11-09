// Who's looking (plan 3.1): the session's lifter, and the roles the pages check. Admin is only
// ever an email in ADMIN_EMAILS; referee and host are flags on the lifter.
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import type { Db } from '@/db';
import { lifters } from '@/db/schema';
import { COOKIE, decodeSession, type Session } from '@/lib/session';

export type Viewer = { session: Session; id: string; email: string | null; cardName: string; isDemo: boolean; isReferee: boolean; isHost: boolean; isAdmin: boolean };

export const adminEmails = (env = process.env) =>
  (env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export const isAdminEmail = (email: string | null | undefined, env = process.env) =>
  !!email && adminEmails(env).includes(email.toLowerCase());

export async function viewerOf(db: Db, s: Session | null): Promise<Viewer | null> {
  if (!s) return null;
  const [l] = await db.select().from(lifters).where(eq(lifters.id, s.lifterId));
  if (!l || l.deletedAt) return null;
  return {
    session: s, id: l.id, email: l.email, cardName: l.cardName, isDemo: l.isDemo,
    isReferee: l.isReferee && !l.isDemo, isHost: l.isHost && !l.isDemo, isAdmin: !l.isDemo && isAdminEmail(l.email),
  };
}

/** In a server component or route: the viewer from the session cookie. */
export async function currentViewer(db: Db): Promise<Viewer | null> {
  const jar = await cookies();
  return viewerOf(db, decodeSession(jar.get(COOKIE)?.value));
}
