/**
 * Keep the original gym Agent object name stable so existing JT/Lupe conversation
 * history survives the rollout. Disposable acceptance namespaces get their own
 * Agent object and therefore cannot see or alter the founders' gym conversation.
 */
export function agentObjectName(email, namespace) {
  return namespace === 'gym'
    ? `user:${email}`
    : `user:${email}:ns:${namespace}`;
}
