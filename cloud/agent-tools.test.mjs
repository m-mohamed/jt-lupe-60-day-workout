import assert from 'node:assert/strict';
import { trainingTools } from './src/training-tools.js';

const snapshot = {
  profile: 'jt', windowDays: 60, through: '2026-08-28',
  sets: [], meals: [], supplements: [], bodyweight: [], habits: []
};
const tools = trainingTools(snapshot, {
  searchFood: async query => ({ foods: [{ id: 'hotbar', name: query, estimate: true }] })
});
const names = tools.map(tool => tool.name);

assert.deepEqual(names, [
  'get_training_snapshot',
  'search_food_catalog',
  'propose_set_log',
  'propose_meal_log',
  'propose_supplement_log',
  'propose_bodyweight_log',
  'propose_habit_log',
  'propose_record_removal',
  'open_training_surface',
  'control_training_interface'
]);

const habit = tools.find(tool => tool.name === 'propose_habit_log');
const habitResult = await habit.execute('habit-call', {
  date: '2026-08-28', habit: 'sleep', done: true
});
assert.deepEqual(habitResult.details.proposal, {
  kind: 'habit', date: '2026-08-28', habit: 'sleep', done: true
});

const remove = tools.find(tool => tool.name === 'propose_record_removal');
const removeResult = await remove.execute('remove-call', {
  date: '2026-08-28', recordKind: 'meal', recordId: 'lunch', label: 'Chicken bowl'
});
assert.deepEqual(removeResult.details.proposal, {
  kind: 'removal', date: '2026-08-28', recordKind: 'meal', recordId: 'lunch', label: 'Chicken bowl'
});

const openSurface = tools.find(tool => tool.name === 'open_training_surface');
const surfaceResult = await openSurface.execute('navigate-call', {
  surface: 'food', date: '2026-08-28'
});
assert.deepEqual(surfaceResult.details.uiAction, {
  kind: 'navigate', surface: 'food', date: '2026-08-28'
});

const searchFood = tools.find(tool => tool.name === 'search_food_catalog');
const foodResult = await searchFood.execute('food-call', { query: 'Whole Foods Hot Bar chicken' });
assert.deepEqual(foodResult.details.foods, [{ id: 'hotbar', name: 'Whole Foods Hot Bar chicken', estimate: true }]);

const interfaceControl = tools.find(tool => tool.name === 'control_training_interface');
const timerResult = await interfaceControl.execute('timer-call', { action: 'timer_start' });
assert.deepEqual(timerResult.details.uiAction, { kind: 'interface', action: 'timer_start' });
const searchResult = await interfaceControl.execute('search-call', {
  action: 'food_search', value: 'Whole Foods Hot Bar chicken'
});
assert.deepEqual(searchResult.details.uiAction, {
  kind: 'interface', action: 'food_search', value: 'Whole Foods Hot Bar chicken'
});

console.log('PASS  Pi exposes every user-editable record action plus safe UI navigation');
