import bills from '../../src/generated/bills-index.json';
import { handleState } from '../../src/server/handler';
import { netlifyStore } from '../../src/server/netlify-store';

// Netlify passes a context object; only the deploy context is needed here.
export default (req: Request, context: { deploy: { context: string } }) =>
  handleState(req, {
    store: netlifyStore(),
    bills,
    adminToken: process.env.ADMIN_TOKEN,
    // Deploy previews get their own data so testing never touches the live bill.
    keyPrefix: context.deploy.context === 'production' ? '' : 'preview:',
  });

export const config = { path: '/api/state' };
