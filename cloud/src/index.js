import { identify } from './access.js';
import { buildTrainingSnapshot } from './agent-data.js';

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
const NS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

// FoodData Central has branded Whole Foods products, but it does not have a stable
// "Whole Foods Hot Bar" menu. Searching that phrase currently returns unrelated
// matches for the words whole and hot. These conservative generic estimates make the
// common plate components reliably searchable while making the estimate explicit.
// Hot-bar recipes vary by store and day, so the client still lets the person adjust
// the filled protein number before saving it.
const WHOLE_FOODS_HOT_BAR = [
  { id: 'wfm-hotbar-chicken', name: 'Whole Foods Hot Bar — chicken breast (estimate)', protein100: 31, kcal100: 165 },
  { id: 'wfm-hotbar-salmon', name: 'Whole Foods Hot Bar — baked salmon (estimate)', protein100: 22, kcal100: 206 },
  { id: 'wfm-hotbar-meatballs', name: 'Whole Foods Hot Bar — turkey meatballs (estimate)', protein100: 18, kcal100: 220 },
  { id: 'wfm-hotbar-tofu', name: 'Whole Foods Hot Bar — tofu and vegetables (estimate)', protein100: 8, kcal100: 120 },
  { id: 'wfm-hotbar-mac', name: 'Whole Foods Hot Bar — macaroni and cheese (estimate)', protein100: 7, kcal100: 164 },
  { id: 'wfm-hotbar-rice', name: 'Whole Foods Hot Bar — brown rice (estimate)', protein100: 2.6, kcal100: 123 }
].map(food => Object.assign(food, {
  brand: 'Whole Foods Hot Bar · estimate',
  kind: 'Built-in estimate',
  portions: [
    { label: '4 oz', grams: 113 },
    { label: '6 oz', grams: 170 },
    { label: '8 oz', grams: 227 }
  ],
  servingGrams: 113
}));

function hotBarFoods(query) {
  const normalized = query.toLowerCase();
  if (!normalized.includes('whole foods') && !normalized.includes('hot bar')) return null;
  const wanted = normalized
    .replace(/whole\s*foods?|market|hot\s*bar|prepared|food|plate/g, ' ')
    .trim();
  if (!wanted) return WHOLE_FOODS_HOT_BAR;
  const tokens = wanted.split(/\s+/).filter(Boolean);
  const matches = WHOLE_FOODS_HOT_BAR.filter(food => tokens.every(token => food.name.toLowerCase().includes(token)));
  return matches.length ? matches : WHOLE_FOODS_HOT_BAR;
}

// FDC has shipped nutrient amounts as both numbers and numeric strings. Coerce once
// here so everything downstream gets a number or nothing.
const nutrient = (food, name) => {
  const found = (food.foodNutrients || []).find(n => n.nutrientName === name && n.unitName !== 'kJ');
  const amount = Number(found?.value);
  return Number.isFinite(amount) ? amount : null;
};

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
const agentFor = (env, email) => env.TRAINING_AGENT.getByName(`user:${email}`);
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
    if (value !== null && value.length > MAX_VALUE) {
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
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: 'bad_json' }, 400);

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
        if (!['/status', '/connect', '/disconnect', '/reset', '/chat'].includes(action)) {
          return json({ error: 'not_found' }, 404);
        }
        const agent = agentFor(env, identity.email);
        let body;
        if (request.method !== 'GET') body = await request.json().catch(() => null);
        if (action === '/chat') {
          const requested = body?.profile === 'jt' || body?.profile === 'lupe' ? body.profile : null;
          const profile = PROFILE_BY_EMAIL[identity.email] || requested;
          if (!profile) return json({ error: 'profile_required' }, 400);
          const dump = await store.exportAll(ns);
          body = { prompt: body?.prompt, profile, snapshot: buildTrainingSnapshot(dump, profile) };
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
        if (!query) return json({ foods: [] });

        const hotBar = hotBarFoods(query);
        if (hotBar) return json({ foods: hotBar, estimated: true });

        // Cache hard: the same lunch gets looked up repeatedly and the free key is
        // metered per hour.
        const cacheKey = new Request(`https://food.cache/${encodeURIComponent(query.toLowerCase())}`);
        const cache = caches.default;
        const hit = await cache.match(cacheKey);
        if (hit) return hit;

        // POST, not GET. Several dataType values cannot be expressed on the query
        // string - repeating the key and comma-joining it are both rejected by the
        // edge with a 400 before the API ever sees them - but the POST body takes a
        // plain array. Survey foods are the generic restaurant dishes ("chicken
        // teriyaki"), SR Legacy carries the older chain entries, Branded the packaged
        // goods.
        const usda = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(env.USDA_API_KEY || 'DEMO_KEY')}`;
        const usingDemoKey = !env.USDA_API_KEY;
        const response = await fetch(usda, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, pageSize: 10, dataType: ['Survey (FNDDS)', 'SR Legacy', 'Branded'] })
        });
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
        const foods = (payload.foods || []).map(food => ({
          id: food.fdcId,
          name: String(food.description || '').replace(/\s+/g, ' ').trim(),
          brand: food.brandOwner || food.brandName || null,
          kind: food.dataType,
          // per 100 g, which is how FDC reports every dataType we ask for
          protein100: nutrient(food, 'Protein'),
          kcal100: nutrient(food, 'Energy'),
          // "Quantity not specified" is a real FDC portion but a useless label; keep it
          // only when nothing better exists, and never as the default.
          portions: (() => {
            const all = (food.foodMeasures || [])
              .filter(m => m.gramWeight > 0 && m.disseminationText)
              .map(m => ({ label: String(m.disseminationText).slice(0, 40), grams: Math.round(m.gramWeight) }));
            const named = all.filter(m => !/^quantity not specified$/i.test(m.label));
            const unnamed = all.map(m => ({ grams: m.grams, label: `${m.grams} g` }));
            return (named.length ? named : unnamed).slice(0, 6);
          })(),
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
