import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  AGENT_SNAPSHOT_KIND_LIMITS,
  AGENT_SNAPSHOT_KIND_SCAN_LIMITS,
  MAX_AGENT_SNAPSHOT_ROWS,
  capDatedExport,
  datedExportQueries
} from './src/agent-store-query.js';
import { isTrainingSnapshotCandidate } from './src/agent-data.js';

const KEY_PREFIX = 'jt-lupe:jt:';

const database = new DatabaseSync(':memory:');
database.exec(`CREATE TABLE records (
  ns TEXT NOT NULL, key TEXT NOT NULL, value TEXT, deleted INTEGER NOT NULL,
  version INTEGER NOT NULL, device TEXT NOT NULL, updated TEXT NOT NULL,
  PRIMARY KEY (ns, key)
)`);
const insert = database.prepare(
  'INSERT INTO records (ns, key, value, deleted, version, device, updated) VALUES (?, ?, ?, 0, 1, ?, ?)'
);
for (let index = 0; index < 6000; index += 1) {
  insert.run('gym', `jt-lupe:jt:set:2026-08-26:exercise-${index}:1`, '{"load":100,"reps":10}', 'device', '2026-08-26T12:00:00Z');
}
for (let index = 0; index < AGENT_SNAPSHOT_KIND_LIMITS.set + 50; index += 1) {
  insert.run('gym', `jt-lupe:jt:set:2026-08-26x-invalid-${index}:1`, '{"load":999}', 'device', '2026-08-26T12:00:00Z');
}
insert.run('gym', 'jt-lupe:lupe:set:2026-08-26:private:1', '{"load":999}', 'device', '2026-08-26T12:00:00Z');
insert.run('gym', 'jt-lupe:jt:set:2025-01-01:old:1', '{"load":999}', 'device', '2025-01-01T12:00:00Z');
insert.run('gym', 'jt-lupe:jt:meal:2026-07-01:valid', '{"name":"Lunch"}', 'device', '2026-07-01T12:00:00Z');
insert.run('gym', 'jt-lupe:jt:meal:2026-07-99:invalid-calendar', '{"name":"Bad"}', 'device', '2026-07-01T12:00:00Z');
insert.run('gym', 'jt-lupe:jt:meal:2026-07-02:oversized-utf8', JSON.stringify({ name: '🍱'.repeat(3000) }), 'device', '2026-07-02T12:00:00Z');
insert.run('gym', 'jt-lupe:jt:bodyweight:2026-08-26', '{"value":180}', 'device', '2026-08-26T12:00:00Z');
insert.run('gym', 'jt-lupe:jt:bodyweight:2026-08-26:extra', '{"value":999}', 'device', '2026-08-26T12:00:00Z');
insert.run('gym', 'jt-lupe:jt:activity:event', '{}', 'device', '2026-08-26T12:00:00Z');

const queries = datedExportQueries({
  ns: 'gym',
  keyPrefix: KEY_PREFIX,
  kinds: ['set', 'meal', 'supplement', 'bodyweight', 'habit'],
  oldest: '2026-06-30',
  through: '2026-08-28'
});
const rowsByKind = Object.fromEntries(queries.map(query => [
  query.kind,
  database.prepare(query.sql).all(...query.params)
]));
const capped = capDatedExport(
  rowsByKind,
  (_kind, row) => isTrainingSnapshotCandidate(row.key, row.value, KEY_PREFIX)
);

assert.equal(rowsByKind.set.length, AGENT_SNAPSHOT_KIND_SCAN_LIMITS.set + 1,
  'the indexed set range stops after one hard-scan overflow sentinel');
assert.ok(capped.rows.length <= MAX_AGENT_SNAPSHOT_ROWS, 'all record kinds share a hard candidate ceiling');
assert.equal(capped.limited, true, 'the overflow sentinel marks the source as partial');
assert.deepEqual(capped.limitedKinds, ['set'], 'the source identifies the capped record type');
assert.deepEqual(capped.candidateLimitedKinds, ['set'], 'the valid candidate ceiling is explicit');
assert.deepEqual(capped.sourceScanLimitedKinds, ['set'], 'the hard source scan ceiling is explicit');
assert.equal(rowsByKind.set.every(row => /^jt-lupe:jt:set:\d{4}-\d{2}-\d{2}:/.test(row.key)), true,
  'malformed set delimiters cannot consume the per-kind cap');
assert.deepEqual(rowsByKind.meal.map(row => row.key), ['jt-lupe:jt:meal:2026-07-01:valid'],
  'calendar-invalid dates and values over the UTF-8 byte ceiling are removed before the limit');
assert.deepEqual(rowsByKind.bodyweight.map(row => row.key), ['jt-lupe:jt:bodyweight:2026-08-26'],
  'bodyweight keys must end after their exact date');
assert.equal(capped.rows.some(row => row.key.startsWith('jt-lupe:lupe:')), false,
  'the storage query never crosses profile boundaries');

const semanticRows = {
  set: [
    ...Array.from({ length: AGENT_SNAPSHOT_KIND_LIMITS.set + 1 }, (_, index) => ({
      key: `jt-lupe:jt:set:2026-08-28:zzzz-${index}:not-a-number`,
      value: '{"load":999}', updated: '2026-08-28T12:00:00Z'
    })),
    { key: 'jt-lupe:jt:set:2026-08-28:bench-press:1', value: '{"load":135,"reps":10}', updated: '2026-08-28T12:00:00Z' }
  ],
  meal: [
    { key: 'jt-lupe:jt:meal:2026-08-28:invalid-json', value: '{', updated: '2026-08-28T12:00:00Z' },
    { key: 'jt-lupe:jt:meal:2026-08-28:missing-name', value: '{}', updated: '2026-08-28T12:00:00Z' },
    { key: 'jt-lupe:jt:meal:2026-08-28:lunch', value: '{"name":"Lunch"}', updated: '2026-08-28T12:00:00Z' }
  ]
};
const semanticCapped = capDatedExport(
  semanticRows,
  (_kind, row) => isTrainingSnapshotCandidate(row.key, row.value, KEY_PREFIX)
);
assert.deepEqual(semanticCapped.rows.map(row => row.key), [
  'jt-lupe:jt:set:2026-08-28:bench-press:1',
  'jt-lupe:jt:meal:2026-08-28:lunch'
], 'parser-invalid rows are skipped before caps, preserving later valid records');
assert.equal(semanticCapped.limited, false, 'ordinary corrupt rows do not falsely mark a bounded source');

console.log('PASS  agent storage query bounds materialization before snapshot construction');
