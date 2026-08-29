import assert from 'node:assert/strict';
import { initializeAgentSchema } from './src/agent-schema.js';

const statements = [];
initializeAgentSchema({
  sql(strings, ...values) {
    statements.push(String.raw(strings, ...values));
    return [];
  }
});

assert.match(statements.join('\n'), /DROP TABLE IF EXISTS training_credentials/,
  'retired personal OpenRouter keys must not remain in Agent SQLite');
assert.match(statements.join('\n'), /CREATE TABLE IF NOT EXISTS training_messages/);

console.log('PASS  Agent startup removes retired OAuth credentials and keeps conversation storage');
