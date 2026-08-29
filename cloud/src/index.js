import { identify } from './access.js';
import { buildTrainingSnapshot, trainingSnapshotWindow } from './agent-data.js';
import { normalizeUiContext } from './agent-context.js';
import { agentObjectName } from './agent-routing.js';
import { searchFoodCatalog } from './food-catalog.js';

export { UserStore } from './store.js';
export { TrainingAgent } from './training-agent.js';

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
const MAX_SYNC_BODY = 2 * 1024 * 1024;
const MAX_AGENT_BODY = 128 * 1024;
const NS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const UTF8 = new TextEncoder();

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }
});

async function readJson(request, maxBytes) {
  const declared = request.headers.get('Content-Length');
  const declaredBytes = declared === null ? null : Number(declared);
  if (declaredBytes !== null && Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    return { error: 'payload_too_large', status: 413 };
  }
  if (!request.body) return { error: 'bad_json', status: 400 };

  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    // A request body is one ordered byte stream. Read it sequentially so the byte
    // ceiling can stop the stream before the next chunk is retained.
    /* eslint-disable no-await-in-loop */
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return { error: 'payload_too_large', status: 413 };
      }
      chunks.push(value);
    }
    /* eslint-enable no-await-in-loop */
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder().decode(joined));
    if (body === null || Array.isArray(body) || Object.prototype.toString.call(body) !== '[object Object]') {
      return { error: 'bad_json', status: 400 };
    }
    return { body };
  } catch {
    return { error: 'bad_json', status: 400 };
  }
}

/**
 * Per-user object derived from the verified email, so identity picks the database.
 * getByName is the documented deterministic-routing helper: same email, same object.
 */
const storeFor = (env, email) => env.USER_STORE.getByName(`user:${email}`);
const agentFor = (env, email, ns) => env.TRAINING_AGENT.getByName(agentObjectName(email, ns));
const PROFILE_BY_EMAIL = {
  'mohamed@mnfstlabs.com': 'lupe',
  'abdullah@mnfstlabs.com': 'jt'
};

/**
 * Parse an untrusted sync batch into records the store can hold, or say why it
 * cannot. Everything past this point works on the parsed shape - the raw body is
 * never read again - so there is one place to look for what the API accepts.
 */
function parseChanges(raw) {
  if (!Array.isArray(raw)) return { error: 'changes must be an array' };
  if (raw.length > MAX_CHANGES) return { error: `too many changes (max ${MAX_CHANGES})` };

  const changes = [];
  for (const entry of raw) {
    const key = entry && entry.key ? String(entry.key) : '';
    if (!key) return { error: 'each change needs a key' };
    if (key.length > MAX_KEY) return { error: `key too long (max ${MAX_KEY})` };

    const deleted = Boolean(entry.deleted);
    const value = deleted ? null : String(entry.value ?? '');
    if (value !== null && UTF8.encode(value).byteLength > MAX_VALUE) {
      return { error: `value too large for "${key}" (max ${MAX_VALUE} bytes)` };
    }
    changes.push({ key, value, deleted });
  }
  return { changes };
}

export default {
  async fetch(request, env, ctx) {
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
        const parsedBody = await readJson(request, MAX_SYNC_BODY);
        if (parsedBody.error) return json({ error: parsedBody.error }, parsedBody.status);
        const body = parsedBody.body;
        const parsed = parseChanges(body.changes || []);
        if (parsed.error) return json({ error: 'bad_changes', detail: parsed.error }, 400);

        const result = await store.sync({
          ns,
          since: Number(body.since) || 0,
          device: String(body.device || '').slice(0, 64),
          changes: parsed.changes
        });
        return json(result);
      }

      // The browser never chooses an Agent instance. Access identity selects one
      // private Agent, exactly like it selects the user's data store. The Worker also
      // strips the other profile and records older than 60 days before OpenRouter sees
      // any context.
      if (url.pathname.startsWith('/api/agent/')) {
        const action = url.pathname.slice('/api/agent'.length);
        if (!['/status', '/reset', '/chat'].includes(action)) {
          return json({ error: 'not_found' }, 404);
        }
        const agent = agentFor(env, identity.email, ns);
        let body;
        if (request.method !== 'GET') {
          const parsedBody = await readJson(request, MAX_AGENT_BODY);
          if (parsedBody.error) return json({ error: parsedBody.error }, parsedBody.status);
          body = parsedBody.body;
        }
        if (action === '/chat') {
          const requested = body?.profile === 'jt' || body?.profile === 'lupe' ? body.profile : null;
          const profile = PROFILE_BY_EMAIL[identity.email] || requested;
          if (!profile) return json({ error: 'profile_required' }, 400);
          const requestTime = new Date();
          const dump = await store.exportDated(ns, trainingSnapshotWindow(profile, requestTime));
          const snapshot = buildTrainingSnapshot(dump, profile, requestTime);
          body = {
            prompt: body?.prompt,
            profile,
            snapshot,
            uiContext: normalizeUiContext(body?.uiContext, snapshot.through)
          };
        }
        return agent.fetch(new Request(`https://training-agent.internal${action}`, {
          method: request.method,
          headers: { 'Content-Type': 'application/json' },
          body: request.method === 'GET' ? undefined : JSON.stringify(body || {})
        }));
      }

      // Food lookup. USDA FoodData Central is public-domain government data and free;
      // the key only exists to rate-limit, so it stays server-side rather than shipping
      // in the page. Values come back per 100 g, and FNDDS carries real portions, so
      // both are passed through and the arithmetic happens where the grams are chosen.
      if (url.pathname === '/api/food' && request.method === 'GET') {
        const query = (url.searchParams.get('q') || '').trim().slice(0, 120);
        const result = await searchFoodCatalog(query, env, ctx);
        const response = json(result.body);
        if (result.cacheable) response.headers.set('Cache-Control', 'public, max-age=86400');
        return response;
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
      console.error({ event: 'api_error', path: url.pathname,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error) });
      return json({ error: 'server_error' }, 500);
    }
  }
};
