import listed from '../../src/generated/listed.json';
import { netlifyStore } from '../../src/server/netlify-store';

// Keeps a public demo usable: clears picks on listed bills every hour.
// Only runs when RESET_LISTED_BILLS=true is set on the site – never on real bills.
export default async () => {
  if (process.env.RESET_LISTED_BILLS !== 'true') return;
  const store = netlifyStore();
  for (const slug of listed) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { etag } = await store.read(slug);
      if (!etag || (await store.write(slug, {}, etag))) break;
    }
  }
};

export const config = { schedule: '@hourly' };
