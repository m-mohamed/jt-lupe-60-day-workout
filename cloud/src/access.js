/**
 * Cloudflare Access identity.
 *
 * Access terminates the login at the edge and forwards a signed JWT. We do not
 * trust the convenience header (`Cf-Access-Authenticated-User-Email`) on its own —
 * a header is only as trustworthy as the thing in front of it, so the signature,
 * audience, issuer and expiry are all checked against the team's JWKS.
 */

const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { url: '', keys: null, fetchedAt: 0 };

const decodeSegment = segment => {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

const decodeJson = segment => JSON.parse(new TextDecoder().decode(decodeSegment(segment)));

/** A JWT time claim in seconds, or null when it is present but unusable. */
const seconds = value => (Number.isFinite(value) ? value : null);

async function loadKeys(teamDomain) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const fresh = jwksCache.url === url && jwksCache.keys && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh) return jwksCache.keys;

  const response = await fetch(url, { cf: { cacheTtl: 3600 } });
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
  const body = await response.json();

  // Imported together rather than one at a time: the keys are independent, and this
  // runs on the first request after every cache expiry.
  const imported = await Promise.all((body.keys || []).map(async jwk => [
    jwk.kid,
    await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  ]));
  const keys = new Map(imported);
  jwksCache = { url, keys, fetchedAt: Date.now() };
  return keys;
}

/**
 * Returns { email } for a verified caller, or null when the request is not
 * authenticated. Never throws for ordinary auth failures — an unauthenticated
 * request is a normal state, not an error.
 */
export async function identify(request, env) {
  // Local development only. Refuses to engage once a real Access config exists,
  // so a stray DEV_EMAIL cannot silently become an auth bypass in production.
  if (env.DEV_EMAIL && !env.ACCESS_TEAM_DOMAIN) {
    return { email: env.DEV_EMAIL, dev: true };
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  const cookie = request.headers.get('Cookie') || '';
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
    || (cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/) || [])[1];
  if (!token) return null;

  try {
    const [headerSegment, payloadSegment, signatureSegment] = token.split('.');
    if (!headerSegment || !payloadSegment || !signatureSegment) return null;

    const header = decodeJson(headerSegment);
    if (header.alg !== 'RS256') return null;

    const keys = await loadKeys(env.ACCESS_TEAM_DOMAIN);
    const key = keys.get(header.kid);
    if (!key) return null;

    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key,
      decodeSegment(signatureSegment),
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`)
    );
    if (!verified) return null;

    // Parse the claims into domain values once, here at the boundary, rather than
    // re-inspecting the raw payload at each check. The old form read
    // `typeof payload.exp === 'number' && payload.exp < now`, which silently skipped
    // the expiry check whenever `exp` was not a number - a token carrying a string
    // expiry would have been accepted forever. An expiry is now required.
    const payload = decodeJson(payloadSegment);
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      audience: Array.isArray(payload.aud) ? payload.aud : [payload.aud],
      issuer: payload.iss,
      expiresAt: seconds(payload.exp),
      // undefined means absent, which is allowed; null means present but not a
      // number, which is rejected rather than quietly skipped.
      notBefore: payload.nbf === undefined ? undefined : seconds(payload.nbf),
      email: payload.email ? String(payload.email).toLowerCase() : null
    };

    // Log which check failed. Access already gates this origin, so anything that
    // reaches the Worker has authenticated once — the value here is turning a silent
    // "No account" into something diagnosable from `wrangler tail`.
    const reject = reason => {
      console.warn('access rejected:', reason, '| iss:', claims.issuer, '| aud count:', claims.audience.length);
      return null;
    };

    if (!claims.audience.includes(env.ACCESS_AUD)) return reject('aud mismatch');
    if (claims.issuer !== `https://${env.ACCESS_TEAM_DOMAIN}`) return reject('iss mismatch');
    if (claims.expiresAt === null) return reject('no usable expiry');
    if (claims.expiresAt < now) return reject('expired');
    if (claims.notBefore === null) return reject('unusable not-before');
    if (claims.notBefore !== undefined && claims.notBefore > now + 60) return reject('not yet valid');
    if (!claims.email) return reject('no email claim');

    return { email: claims.email };
  } catch (error) {
    console.warn('access verification threw:', String(error));
    return null;
  }
}
