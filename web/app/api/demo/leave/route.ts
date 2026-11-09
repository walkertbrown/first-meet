// POST /api/demo/leave: "Leave the demo" (plan 5.36). The cookie goes; the demo lifter is
// deleted with the others after 7 days.
import { cookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const POST = () => new Response(null, { status: 303, headers: { location: '/', 'set-cookie': cookieHeader('', 0) } });
