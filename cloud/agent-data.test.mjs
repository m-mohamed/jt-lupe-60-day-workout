import assert from 'node:assert/strict';
import { buildTrainingSnapshot, MAX_SNAPSHOT_BYTES } from './src/agent-data.js';

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
assert.deepEqual(snapshot.meals[0], { date: '2026-08-26', id: 'lunch', name: 'Whole Foods Hot Bar chicken', protein: 42, kcal: 510 });
assert.deepEqual(snapshot.supplements[0], { date: '2026-08-26', id: 'creatine', name: 'Creatine monohydrate', dose: 5, unit: 'g' });
assert.deepEqual(snapshot.habits[0], { date: '2026-08-26', habit: 'sleep', done: true });
assert.equal(JSON.stringify(snapshot).includes('225'), false, 'never leak the other profile');
assert.equal(JSON.stringify(snapshot).includes('2025-01-01'), false, 'exclude stale records');
assert.equal(snapshot.truncated, false, 'normal history is complete');
assert.equal(snapshot.candidateLimitReached, false, 'normal storage query is complete');

assert.throws(() => buildTrainingSnapshot(dump, 'other'), /profile/);

const dense = { data: {} };
for (let index = 0; index < 538; index += 1) {
  dense.data[`jt-lupe:jt:set:2026-08-26:exercise-${index}:1`] = JSON.stringify({ load: 100, reps: 10 });
}
const denseSnapshot = buildTrainingSnapshot(dense, 'jt', new Date('2026-08-27T12:00:00Z'));
assert.equal(denseSnapshot.sets.length, 538,
  'the advertised 60-day context must not silently truncate dense set history');
assert.equal(denseSnapshot.truncated, false, 'a complete two-month challenge fits the snapshot budget');

const pathological = { data: {} };
for (let index = 0; index < 6000; index += 1) {
  pathological.data[`jt-lupe:jt:set:2026-08-26:pathological-${index}:1`] = JSON.stringify({
    load: '9'.repeat(2000), reps: 10
  });
}
const bounded = buildTrainingSnapshot(pathological, 'jt', new Date('2026-08-27T12:00:00Z'));
assert.equal(bounded.truncated, true, 'pathological history is explicitly marked as partial');
assert.ok(bounded.omitted.sets > 0, 'the snapshot reports how many valid rows were omitted');
assert.ok(bounded.sets.length > 0, 'the newest usable history remains available');
assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).byteLength <= MAX_SNAPSHOT_BYTES,
  'serialized Pi tool context stays inside the explicit byte ceiling');

const candidateLimited = buildTrainingSnapshot({
  ...dump, candidateLimitReached: true, candidateLimitedKinds: ['set']
}, 'lupe', new Date('2026-08-27T12:00:00Z'));
assert.equal(candidateLimited.truncated, true, 'a valid-candidate cap is disclosed to the model');
assert.equal(candidateLimited.candidateLimitReached, true, 'candidate-limit metadata survives snapshot construction');
assert.deepEqual(candidateLimited.candidateKindsLimited, ['set']);

const sourceLimited = buildTrainingSnapshot({
  ...dump, sourceScanLimitReached: true, sourceScanLimitedKinds: ['meal']
}, 'lupe', new Date('2026-08-27T12:00:00Z'));
assert.equal(sourceLimited.truncated, true, 'a hard storage scan cap is disclosed to the model');
assert.equal(sourceLimited.sourceScanLimitReached, true, 'source-scan metadata survives snapshot construction');
assert.deepEqual(sourceLimited.sourceScanKindsLimited, ['meal']);
console.log('PASS  private 60-day training snapshot');
