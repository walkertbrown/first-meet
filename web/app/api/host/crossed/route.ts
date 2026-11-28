// POST /api/host/crossed { lifters }: these names crossed the middle of the roll call band (plan 5.35). Hosts and admins.
import { deskPost } from '@/lib/host-routes';

export const dynamic = 'force-dynamic';
export const POST = (req: Request) => deskPost(req, 'rollcall', false);
