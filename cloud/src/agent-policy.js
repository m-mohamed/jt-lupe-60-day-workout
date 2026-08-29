export const PRIMARY_MODEL = 'openrouter/free';

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
    requireZdr: String(env.OPENROUTER_REQUIRE_ZDR || '').toLowerCase() === 'true'
  };
}

/**
 * Keep Pi as the model adapter while applying OpenRouter's provider-routing policy.
 * `data_collection: deny` excludes endpoints that may train on or retain prompts.
 * Strict zero-data-retention is optional because it can leave the free router with no
 * eligible provider; deployments with a compatible paid model can turn it on.
 */
export function applyOpenRouterPrivacy(payload, requireZdr = false) {
  const provider = { ...payload.provider };
  provider.data_collection = 'deny';
  provider.require_parameters = true;
  provider.allow_fallbacks = true;
  if (requireZdr) provider.zdr = true;
  return {
    ...payload,
    provider
  };
}
