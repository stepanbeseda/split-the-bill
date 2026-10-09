import bills from '../src/generated/bills-index.json';
import { handleState } from '../src/server/handler';
import { upstashStore } from '../src/server/upstash-store';

const deps = () => ({
  store: upstashStore(),
  bills,
  adminToken: process.env.ADMIN_TOKEN,
  // Preview deployments get their own data so testing never touches the live bill.
  keyPrefix: process.env.VERCEL_ENV === 'production' ? '' : 'preview:',
});

export const GET = (req: Request) => handleState(req, deps());
export const POST = (req: Request) => handleState(req, deps());
