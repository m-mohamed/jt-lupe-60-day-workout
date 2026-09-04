export const PRIMARY_MODEL = 'openrouter/free';
// The free-model route needs to include providers whose data policy permits
// collection. This is an explicit product choice: it maximizes the eligible
// pool for a low-volume, personal coach rather than silently failing under a
// zero-collection filter.
export const DATA_COLLECTION_POLICY = 'allow';

const modelName = value => {
  const candidate = String(value || '').trim();
  return candidate && candidate.length <= 160 ? candidate : null;
};

/** Resolve deployment policy once so status and execution cannot disagree. */
export function resolveAgentPolicy(env = {}) {
  const primaryModel = modelName(env.OPENROUTER_MODEL) || PRIMARY_MODEL;
  const fallback = modelName(env.OPENROUTER_FALLBACK_MODEL);
  return {
    primaryModel,
    fallbackModel: fallback && fallback !== primaryModel ? fallback : null,
    requireZdr: String(env.OPENROUTER_REQUIRE_ZDR || '').toLowerCase() === 'true',
    dataCollection: DATA_COLLECTION_POLICY
  };
}

/**
 * Keep Pi as the model adapter while applying OpenRouter's provider-routing policy.
 * `data_collection: allow` keeps providers that may collect or train on prompts
 * in the free-model pool. Strict zero-data-retention remains opt-in because it can
 * leave the free router with no eligible provider.
 */
export function applyOpenRouterPrivacy(payload, requireZdr = false) {
  const provider = { ...payload.provider };
  provider.data_collection = DATA_COLLECTION_POLICY;
  provider.require_parameters = true;
  provider.allow_fallbacks = true;
  if (requireZdr) provider.zdr = true;
  return {
    ...payload,
    provider
  };
}

/** Preserve useful OpenRouter failure semantics without exposing provider internals. */
export function classifyAgentFailure(error) {
  const message = String(error instanceof Error ? error.message : error || '').toLowerCase();
  if (/\b429\b|rate.?limit|too many requests/.test(message)) {
    return {
      error: 'rate_limited',
      message: 'The free-model limit is busy or exhausted. Try again in a few minutes. Your logs were not changed.'
    };
  }
  if (/timed? out|timeout|deadline|aborted?/.test(message)) {
    return {
      error: 'model_timeout',
      message: 'The coach took too long to answer. Try again. Your logs were not changed.'
    };
  }
  if (/data policy|free model training|privacy settings?|no endpoints found matching/.test(message)) {
    return {
      error: 'privacy_blocked',
      message: 'OpenRouter has no eligible endpoint under the current account or provider policy. Check free-model availability and routing settings. Your logs were not changed.'
    };
  }
  if (/no eligible|model.+unavailable|model.+not found|no provider|\b404\b/.test(message)) {
    return {
      error: 'model_unavailable',
      message: 'No compatible free model is available right now. Try again later. Your logs were not changed.'
    };
  }
  return {
    error: 'agent_failed',
    message: 'The coach could not answer right now. Your logs were not changed.'
  };
}
