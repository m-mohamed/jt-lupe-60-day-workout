import assert from 'node:assert/strict';
import {
  PRIMARY_MODEL,
  applyOpenRouterPrivacy,
  classifyAgentFailure,
  resolveAgentPolicy
} from './src/agent-policy.js';

const standard = resolveAgentPolicy({});
assert.deepEqual(standard, {
  primaryModel: PRIMARY_MODEL,
  fallbackModel: null,
  requireZdr: false,
  dataCollection: 'allow'
});

const configured = resolveAgentPolicy({
  OPENROUTER_MODEL: 'anthropic/claude-sonnet-4.5',
  OPENROUTER_FALLBACK_MODEL: 'openai/gpt-5-mini',
  OPENROUTER_REQUIRE_ZDR: 'true'
});
assert.deepEqual(configured, {
  primaryModel: 'anthropic/claude-sonnet-4.5',
  fallbackModel: 'openai/gpt-5-mini',
  requireZdr: true,
  dataCollection: 'allow'
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
  data_collection: 'allow',
  require_parameters: true,
  allow_fallbacks: true
});
assert.deepEqual(original.provider, { sort: 'latency' }, 'do not mutate Pi payloads');

const zeroRetentionPayload = applyOpenRouterPrivacy(original, true);
assert.equal(zeroRetentionPayload.provider.zdr, true);

assert.deepEqual(classifyAgentFailure(new Error('OpenRouter HTTP 429: rate limit exceeded')), {
  error: 'rate_limited',
  message: 'The free-model limit is busy or exhausted. Try again in a few minutes. Your logs were not changed.'
});
assert.equal(classifyAgentFailure(new Error('request timed out')).error, 'model_timeout');
assert.equal(classifyAgentFailure(new Error('404: No endpoints found matching your data policy (Free model training)')).error, 'privacy_blocked');
assert.equal(classifyAgentFailure(new Error('No eligible providers')).error, 'model_unavailable');

console.log('PASS  OpenRouter model and privacy policy');
