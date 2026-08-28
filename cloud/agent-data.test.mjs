import assert from 'node:assert/strict';
import { buildTrainingSnapshot } from './src/agent-data.js';

const dump = {
  data: {
    'jt-lupe:lupe:set:2026-08-26:bench-press:1': JSON.stringify({ load: 135, reps: 8, drops: [{ load: 95, reps: 2 }] }),
    'jt-lupe:lupe:meal:2026-08-26:lunch': JSON.stringify({ name: 'Whole Foods Hot Bar chicken', protein: 42, kcal: 510 }),
    'jt-lupe:lupe:supplement:2026-08-26:creatine': JSON.stringify({ name: 'Creatine monohydrate', dose: 5, unit: 'g' }),
    'jt-lupe:lupe:bodyweight:2026-08-26': JSON.stringify({ value: 183.4, unit: 'lb' }),
    'jt-lupe:lupe:habit:2026-08-26:sleep': JSON.stringify({ done: true }),
    'jt-lupe:jt:set:2026-08-26:bench-press:1': JSON.stringify({ load: 225, reps: 10 }),
    'jt-lupe:lupe:set:2025-01-01:bench-press:1': JSON.stringify({ load: 95, reps: 10 }),
    'jt-lupe:lupe:set:2026-08-25:broken:1': '{not-json'
  }
};

const snapshot = buildTrainingSnapshot(dump, 'lupe', new Date('2026-08-27T12:00:00Z'));
assert.equal(snapshot.profile, 'lupe');
assert.deepEqual(snapshot.bodyweight, [{ date: '2026-08-26', value: 183.4, unit: 'lb' }]);
assert.equal(snapshot.sets.length, 1);
assert.deepEqual(snapshot.sets[0], {
  date: '2026-08-26', exerciseId: 'bench-press', setNumber: 1,
  load: 135, reps: 8, drops: [{ load: 95, reps: 2 }]
});
assert.deepEqual(snapshot.meals[0], { date: '2026-08-26', name: 'Whole Foods Hot Bar chicken', protein: 42, kcal: 510 });
assert.deepEqual(snapshot.supplements[0], { date: '2026-08-26', name: 'Creatine monohydrate', dose: 5, unit: 'g' });
assert.deepEqual(snapshot.habits[0], { date: '2026-08-26', habit: 'sleep', done: true });
assert.equal(JSON.stringify(snapshot).includes('225'), false, 'never leak the other profile');
assert.equal(JSON.stringify(snapshot).includes('2025-01-01'), false, 'exclude stale records');

assert.throws(() => buildTrainingSnapshot(dump, 'other'), /profile/);
console.log('PASS  private 60-day training snapshot');
