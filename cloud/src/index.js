import { identify } from './access.js';

export { UserStore } from './store.js';

/**
 * A cloud for small software, in about a hundred lines.
 *
 * Cloudflare Access handles the login at the edge. This Worker turns a verified
 * email into one Durable Object — that person's private SQLite database — and
 * exposes a namespaced sync API over it. The app on top (currently the gym
 * tracker) supplies only a namespace string.
 */

const MAX_CHANGES = 2000;
const MAX_KEY = 256;
const MAX_VALUE = 64 * 1024;
const NS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }
});

/**
 * Per-user object derived from the verified email, so identity picks the database.
 * getByName is the documented deterministic-routing helper: same email, same object.
 */
const storeFor = (env, email) => env.USER_STORE.getByName(`user:${email}`);

function validateChanges(changes) {
  if (!Array.isArray(changes)) return 'changes must be an array';
  if (changes.length > MAX_CHANGES) return `too many changes (max ${MAX_CHANGES})`;
  for (const change of changes) {
    if (!change || typeof change.key !== 'string' || !change.key) return 'each change needs a key';
    if (change.key.length > MAX_KEY) return `key too long (max ${MAX_KEY})`;
    if (!change.deleted && String(change.value ?? '').length > MAX_VALUE) {
      return `value too large for "${change.key}" (max ${MAX_VALUE} bytes)`;
    }
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const identity = await identify(request, env);
    if (!identity) {
      return json({ error: 'not_authenticated', hint: 'Sign in through Cloudflare Access.' }, 401);
    }

    // Namespace keeps tenants apart inside one person's database, so a second
    // small app can share this backend without colliding with the first.
    const ns = url.searchParams.get('ns') || 'default';
    if (!NS_PATTERN.test(ns)) return json({ error: 'bad_namespace' }, 400);

    const store = storeFor(env, identity.email);

    try {
      if (url.pathname === '/api/me' && request.method === 'GET') {
        return json({ email: identity.email, dev: Boolean(identity.dev), ns });
      }

      if (url.pathname === '/api/sync' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: 'bad_json' }, 400);

        const problem = validateChanges(body.changes || []);
        if (problem) return json({ error: 'bad_changes', detail: problem }, 400);

        const result = await store.sync({
          ns,
          since: Number(body.since) || 0,
          device: String(body.device || '').slice(0, 64),
          changes: body.changes || []
        });
        return json(result);
      }

      if (url.pathname === '/api/export' && request.method === 'GET') {
        const dump = await store.exportAll(ns);
        return json({ app: ns, email: identity.email, exported: new Date().toISOString(), ...dump });
      }

      if (url.pathname === '/api/stats' && request.method === 'GET') {
        return json(await store.stats(ns));
      }

      return json({ error: 'not_found' }, 404);
    } catch (error) {
      console.error('api error', url.pathname, error);
      return json({ error: 'server_error' }, 500);
    }
  }
};
