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

      // Food lookup. USDA FoodData Central is public-domain government data and free;
      // the key only exists to rate-limit, so it stays server-side rather than shipping
      // in the page. Values come back per 100 g, and FNDDS carries real portions, so
      // both are passed through and the arithmetic happens where the grams are chosen.
      if (url.pathname === '/api/food' && request.method === 'GET') {
        const query = (url.searchParams.get('q') || '').trim().slice(0, 120);
        if (!query) return json({ foods: [] });

        // Cache hard: the same lunch gets looked up repeatedly and the free key is
        // metered per hour.
        const cacheKey = new Request(`https://food.cache/${encodeURIComponent(query.toLowerCase())}`);
        const cache = caches.default;
        const hit = await cache.match(cacheKey);
        if (hit) return hit;

        const usda = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
        usda.searchParams.set('query', query);
        usda.searchParams.set('pageSize', '10');
        usda.searchParams.set('api_key', env.USDA_API_KEY || 'DEMO_KEY');
        // Survey foods are the generic restaurant-style dishes ("chicken teriyaki");
        // SR Legacy carries the older chain entries; Branded covers packaged goods.
        // This must be ONE comma-separated parameter - repeating the key returns 400.
        usda.searchParams.set('dataType', 'Survey (FNDDS),SR Legacy,Branded');

        const usingDemoKey = !env.USDA_API_KEY;
        const response = await fetch(usda, { headers: { Accept: 'application/json' } });
        const payload = await response.json().catch(() => null);

        // FDC signals OVER_RATE_LIMIT with a 200 and an error body as well as with a
        // 429, so the body has to be inspected rather than trusting the status alone.
        const overLimit = response.status === 429
          || (payload && payload.error && payload.error.code === 'OVER_RATE_LIMIT');
        if (overLimit) {
          return json({ foods: [], error: 'rate_limited', demoKey: usingDemoKey,
            hint: usingDemoKey
              ? 'Running on the shared demo key, which allows only 10 lookups an hour. Add a free api.data.gov key as the USDA_API_KEY secret.'
              : 'Hourly lookup limit reached. It resets within the hour.' }, 200);
        }
        if (!response.ok || !payload) return json({ foods: [], error: `usda_${response.status}` }, 200);
        const nutrient = (food, name) => {
          const found = (food.foodNutrients || []).find(n => n.nutrientName === name && n.unitName !== 'kJ');
          return found && typeof found.value === 'number' ? found.value : null;
        };
        const foods = (payload.foods || []).map(food => ({
          id: food.fdcId,
          name: String(food.description || '').replace(/\s+/g, ' ').trim(),
          brand: food.brandOwner || food.brandName || null,
          kind: food.dataType,
          // per 100 g, which is how FDC reports every dataType we ask for
          protein100: nutrient(food, 'Protein'),
          kcal100: nutrient(food, 'Energy'),
          portions: (food.foodMeasures || [])
            .filter(m => m.gramWeight > 0 && m.disseminationText)
            .slice(0, 6)
            .map(m => ({ label: String(m.disseminationText).slice(0, 40), grams: Math.round(m.gramWeight) })),
          servingGrams: food.servingSizeUnit === 'g' && food.servingSize > 0 ? Math.round(food.servingSize) : null
        })).filter(food => food.protein100 !== null);

        const result = json({ foods });
        result.headers.set('Cache-Control', 'public, max-age=86400');
        ctx.waitUntil(cache.put(cacheKey, result.clone()));
        return result;
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
