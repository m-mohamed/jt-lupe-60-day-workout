import assert from 'node:assert/strict';
import {
  FALLBACK_MODEL,
  PRIMARY_MODEL,
  applyOpenRouterPrivacy,
  resolveAgentPolicy
} from './src/agent-policy.js';

const standard = resolveAgentPolicy({});
assert.deepEqual(standard, {
  primaryModel: PRIMARY_MODEL,
  fallbackModel: FALLBACK_MODEL,
  requireZdr: false
});

const configured = resolveAgentPolicy({
  OPENROUTER_MODEL: 'anthropic/claude-sonnet-4.5',
  OPENROUTER_FALLBACK_MODEL: 'openai/gpt-5-mini',
  OPENROUTER_REQUIRE_ZDR: 'true'
});
assert.deepEqual(configured, {
  primaryModel: 'anthropic/claude-sonnet-4.5',
  fallbackModel: 'openai/gpt-5-mini',
  requireZdr: true
});

const sameModel = resolveAgentPolicy({
  OPENROUTER_MODEL: 'openrouter/free',
  OPENROUTER_FALLBACK_MODEL: 'openrouter/free'
});
assert.equal(sameModel.fallbackModel, null, 'do not retry the same model as a fallback');

const original = { messages: [], provider: { sort: 'latency' } };
const privatePayload = applyOpenRouterPrivacy(original, false);
assert.deepEqual(privatePayload.provider, {
  sort: 'latency',
  data_collection: 'deny',
  require_parameters: true,
  allow_fallbacks: true
});
assert.deepEqual(original.provider, { sort: 'latency' }, 'do not mutate Pi payloads');

const zeroRetentionPayload = applyOpenRouterPrivacy(original, true);
assert.equal(zeroRetentionPayload.provider.zdr, true);

console.log('PASS  OpenRouter model and privacy policy');
