// POST /api/host/sample/read { lifter }: "Read" on the demo host desk (plan 5.36). Anyone; demo lifters only.
import { deskPost } from '@/lib/host-routes';

export const dynamic = 'force-dynamic';
export const POST = (req: Request) => deskPost(req, 'read', true);
