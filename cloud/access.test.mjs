// Exercises the real access.js against synthetic Cloudflare Access tokens.
// This is the code path that has never run against an actual login.
const MOD = './src/access.js';
const { identify } = await import(MOD);

const TEAM = 'jt-lupe-workout-cloud.cloudflareaccess.com';
const AUD = '42312f685967edcc867d173097d806bbb876d2e8df99fc85d9b282c6866588c1';
const KID = 'testkid123';
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
);
const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
const jwks = { keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] };

// Cloudflare's JWKS endpoint, stubbed.
globalThis.fetch = async url => {
  if (String(url).includes('/cdn-cgi/access/certs')) {
    return new Response(JSON.stringify(jwks), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('nope', { status: 404 });
};

async function makeToken(payload, { kid = KID, tamper = false } = {}) {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey,
    new TextEncoder().encode(`${header}.${body}`));
  let s = b64url(sig);
  if (tamper) s = s.slice(0, -4) + (s.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  return `${header}.${body}.${s}`;
}

const now = Math.floor(Date.now() / 1000);
const base = { iss: `https://${TEAM}`, aud: [AUD], email: 'Mohamed@MnfstLabs.com', exp: now + 3600, nbf: now - 10, iat: now - 10 };
const req = token => ({ headers: { get: name => (name === 'Cf-Access-Jwt-Assertion' ? token : null) } });

const cases = [
  ['valid token → identifies user',      await makeToken(base),                                          r => r && r.email === 'mohamed@mnfstlabs.com'],
  ['aud as bare string (not array)',     await makeToken({ ...base, aud: AUD }),                         r => r && r.email === 'mohamed@mnfstlabs.com'],
  ['wrong audience → rejected',          await makeToken({ ...base, aud: ['someone-elses-app'] }),       r => r === null],
  ['wrong issuer → rejected',            await makeToken({ ...base, iss: 'https://evil.cloudflareaccess.com' }), r => r === null],
  ['expired → rejected',                 await makeToken({ ...base, exp: now - 60 }),                    r => r === null],
  ['not-yet-valid → rejected',           await makeToken({ ...base, nbf: now + 600 }),                   r => r === null],
  ['no email claim → rejected',          await makeToken({ ...base, email: undefined }),                 r => r === null],
  ['tampered signature → rejected',      await makeToken(base, { tamper: true }),                        r => r === null],
  ['unknown signing key → rejected',     await makeToken(base, { kid: 'not-a-real-kid' }),               r => r === null],
  ['garbage token → rejected',           'not.a.jwt',                                                    r => r === null],
  ['no token at all → rejected',         null,                                                           r => r === null],
];

let pass = 0, fail = 0;
for (const [name, token, check] of cases) {
  let result = null, err = null;
  try { result = await identify(req(token), env); } catch (e) { err = e.message; }
  const ok = !err && check(result);
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${err ? `  (threw: ${err})` : ''}${ok ? '' : `  got: ${JSON.stringify(result)}`}`);
}

// The dev-email guard must refuse to engage once real Access config exists.
const devWithAccess = await identify(req(null), { ...env, DEV_EMAIL: 'sneaky@local' });
const devNoAccess = await identify(req(null), { DEV_EMAIL: 'dev@local', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' });
const g1 = devWithAccess === null, g2 = devNoAccess && devNoAccess.email === 'dev@local';
console.log(`${g1 ? 'PASS' : 'FAIL'}  DEV_EMAIL ignored when Access is configured`);
console.log(`${g2 ? 'PASS' : 'FAIL'}  DEV_EMAIL works only with no Access config`);
pass += (g1 ? 1 : 0) + (g2 ? 1 : 0); fail += (g1 ? 0 : 1) + (g2 ? 0 : 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
