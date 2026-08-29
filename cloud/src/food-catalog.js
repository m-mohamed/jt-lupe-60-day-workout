// FoodData Central does not have a stable "Whole Foods Hot Bar" menu. These
// conservative built-in estimates keep the common search useful while the app and
// agent both label every result as an estimate.
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
  if (!normalized.includes('hot bar')) return null;
  const wanted = normalized
    .replace(/whole\s*foods?|market|hot\s*bar|prepared|food|plate/g, ' ')
    .trim();
  if (!wanted) return WHOLE_FOODS_HOT_BAR;
  const tokens = wanted.split(/\s+/).filter(Boolean);
  const matches = WHOLE_FOODS_HOT_BAR.filter(food => tokens.every(token => food.name.toLowerCase().includes(token)));
  return matches.length ? matches : WHOLE_FOODS_HOT_BAR;
}

const nutrient = (food, name) => {
  const found = (food.foodNutrients || []).find(item => item.nutrientName === name && item.unitName !== 'kJ');
  const amount = Number(found?.value);
  return Number.isFinite(amount) ? amount : null;
};

const foodRows = payload => (payload.foods || []).map(food => ({
  id: food.fdcId,
  name: String(food.description || '').replace(/\s+/g, ' ').trim(),
  brand: food.brandOwner || food.brandName || null,
  kind: food.dataType,
  protein100: nutrient(food, 'Protein'),
  kcal100: nutrient(food, 'Energy'),
  portions: (() => {
    const all = (food.foodMeasures || [])
      .filter(measure => measure.gramWeight > 0 && measure.disseminationText)
      .map(measure => ({ label: String(measure.disseminationText).slice(0, 40), grams: Math.round(measure.gramWeight) }));
    const named = all.filter(measure => !/^quantity not specified$/i.test(measure.label));
    return (named.length ? named : all.map(measure => ({ grams: measure.grams, label: `${measure.grams} g` }))).slice(0, 6);
  })(),
  servingGrams: food.servingSizeUnit === 'g' && food.servingSize > 0 ? Math.round(food.servingSize) : null
})).filter(food => food.protein100 !== null);

/** The shared read path used by the browser's Search primitive and Pi's food tool. */
export async function searchFoodCatalog(rawQuery, env, ctx) {
  const query = String(rawQuery || '').trim().slice(0, 120);
  if (!query) return { body: { foods: [] }, cacheable: false };

  const hotBar = hotBarFoods(query);
  if (hotBar) return { body: { foods: hotBar, estimated: true }, cacheable: false };

  const cacheKey = new Request(`https://food.cache/${encodeURIComponent(query.toLowerCase())}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return { body: await hit.json(), cacheable: true };

  const usingDemoKey = !env.USDA_API_KEY;
  const endpoint = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(env.USDA_API_KEY || 'DEMO_KEY')}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, pageSize: 10, dataType: ['Survey (FNDDS)', 'SR Legacy', 'Branded'] })
  });
  const payload = await response.json().catch(() => null);
  const overLimit = response.status === 429
    || (payload?.error?.code === 'OVER_RATE_LIMIT');
  if (overLimit) {
    return { body: {
      foods: [], error: 'rate_limited', demoKey: usingDemoKey,
      hint: usingDemoKey
        ? 'Running on the shared demo key, which allows only 10 lookups an hour. Add a free api.data.gov key as the USDA_API_KEY secret.'
        : 'Hourly lookup limit reached. It resets within the hour.'
    }, cacheable: false };
  }
  if (!response.ok || !payload) {
    return { body: { foods: [], error: `usda_${response.status}` }, cacheable: false };
  }

  const body = { foods: foodRows(payload) };
  const cached = new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }
  });
  ctx.waitUntil(cache.put(cacheKey, cached));
  return { body, cacheable: true };
}
