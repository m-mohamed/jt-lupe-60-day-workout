import assert from 'node:assert/strict';
import { agentObjectName } from './src/agent-routing.js';

assert.equal(
  agentObjectName('jt@example.com', 'gym'),
  'user:jt@example.com',
  'the existing gym conversation keeps its Durable Object identity'
);
assert.equal(
  agentObjectName('jt@example.com', 'release-check'),
  'user:jt@example.com:ns:release-check',
  'a release namespace gets an isolated Agent conversation'
);
assert.notEqual(
  agentObjectName('jt@example.com', 'release-check'),
  agentObjectName('jt@example.com', 'gym'),
  'release checks cannot address the founder conversation'
);

console.log('PASS  agent namespace routing keeps gym history stable and acceptance isolated');
