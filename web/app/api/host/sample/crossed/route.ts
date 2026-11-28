// POST /api/host/sample/crossed { lifters }: names crossing the demo host desk's roll call (plan 5.36). Anyone; demo lifters only.
import { deskPost } from '@/lib/host-routes';

export const dynamic = 'force-dynamic';
export const POST = (req: Request) => deskPost(req, 'rollcall', true);
