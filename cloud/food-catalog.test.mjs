import assert from 'node:assert/strict';
import { searchFoodCatalog } from './src/food-catalog.js';

let fetchCalls = 0;
globalThis.caches = {
  default: {
    match: async () => null,
    put: async () => undefined
  }
};
globalThis.fetch = async () => {
  fetchCalls += 1;
  return new Response(JSON.stringify({ foods: [{
    fdcId: 123,
    description: 'WHOLE FOODS 365 GREEK YOGURT',
    brandOwner: 'Whole Foods Market',
    dataType: 'Branded',
    foodNutrients: [
      { nutrientName: 'Protein', unitName: 'g', value: 10 },
      { nutrientName: 'Energy', unitName: 'kcal', value: 120 },
      { nutrientName: 'Carbohydrate, by difference', unitName: 'g', value: 14 },
      { nutrientName: 'Total lipid (fat)', unitName: 'g', value: 2 }
    ],
    foodMeasures: [],
    servingSize: 170,
    servingSizeUnit: 'g'
  }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const ctx = { waitUntil: promise => promise };

const hotBar = await searchFoodCatalog('Whole Foods Hot Bar chicken', {}, ctx);
assert.equal(hotBar.body.estimated, true);
assert.match(hotBar.body.foods[0].name, /Hot Bar/);
assert.equal(typeof hotBar.body.foods[0].carbs100, 'number');
assert.equal(typeof hotBar.body.foods[0].fat100, 'number');
assert.equal(fetchCalls, 0, 'built-in Hot Bar results do not spend a USDA request');

const packaged = await searchFoodCatalog('Whole Foods 365 greek yogurt', {}, ctx);
assert.equal(fetchCalls, 1, 'ordinary Whole Foods products continue to USDA');
assert.equal(packaged.body.foods[0].id, 123);
assert.equal(packaged.body.foods[0].carbs100, 14);
assert.equal(packaged.body.foods[0].fat100, 2);
assert.doesNotMatch(packaged.body.foods[0].name, /Hot Bar/);

console.log('PASS  browser and agent share precise Whole Foods Hot Bar and USDA routing');
