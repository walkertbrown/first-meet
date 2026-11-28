// POST /api/host/read { lifter }: Soo tapped "Read" on the host desk (plan 5.35). Hosts and admins.
import { deskPost } from '@/lib/host-routes';

export const dynamic = 'force-dynamic';
export const POST = (req: Request) => deskPost(req, 'read', false);
