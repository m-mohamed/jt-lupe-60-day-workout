# A cloud for small software

The backend for this app, and deliberately not *only* for this app. It is about
250 lines: Cloudflare Access supplies a verified identity, the Worker turns that
identity into one Durable Object per person, and that object owns an embedded
SQLite database exposed as a namespaced key/value store with a version counter.

Nothing in `src/store.js` knows what a workout is. A second small tool can use the
same deployment by passing a different `?ns=`.

## Why this shape

**Deployment, auth, and sharing** are the three hard parts of software with one or
a handful of users. Compute is not. So the entire stack is one `wrangler deploy`
and one dashboard toggle, and it costs nothing at this size.

**Consistency comes from the runtime, not from merge logic.** A Durable Object is a
single-threaded actor: every request for a given user is serialised through one
instance holding one SQLite database. There is no read replica to fall behind and
no cross-user contention.

**Last-write-wins is correct here, not a shortcut.** Each person is the only writer
of their own records, so there is no concurrent-editor case to merge. That is why
there is no CRDT and no sync-engine vendor. If this ever grows shared documents
that two people edit at once, that assumption breaks and the conflict rule has to
be revisited — it is the one load-bearing simplification in the design.

## Data model

One row per key, inside one SQLite database per person:

```
records(ns, key, value, deleted, version, device, updated)   PRIMARY KEY (ns, key)
meta(k, v)                                                   -- holds the version counter
```

`POST /api/sync` pushes and pulls in a single round trip, because a phone on gym
wifi should spend as few of them as possible. A batch of changes shares one
version number; the client stores the returned version as its cursor and asks for
`version > cursor` next time. Rows written by the calling device are filtered out
of the response, so a device never re-applies its own writes.

| Route | Purpose |
| --- | --- |
| `GET /api/me` | verified email; also how the client detects a backend exists |
| `POST /api/sync` | push changes, pull everything newer |
| `GET /api/export` | full namespace dump for backup |
| `GET /api/stats` | record count, version, database size |

All routes take `?ns=` and are denied without a valid Access JWT.

## Deploy

You need a Cloudflare account. Everything below is inside the free tier.

```bash
npx wrangler@4 login
```

```bash
cd cloud && npx wrangler@4 deploy
```

That prints a `https://jt-lupe-workout.<your-subdomain>.workers.dev` URL. At this
point the API returns 401 for everything, because no identity is configured yet —
that is the correct closed-by-default state.

### Turn on Access

1. Cloudflare dashboard → **Workers & Pages** → `jt-lupe-workout` → **Settings** →
   **Domains & Routes** → next to the `workers.dev` route, **Enable Cloudflare Access**.
2. **Manage Cloudflare Access** → add both email addresses to the allow policy.
3. Copy the **Application Audience (AUD) tag** from that Access application, and
   note your team domain (`<team>.cloudflareaccess.com`).
4. Put both into `wrangler.jsonc` under `vars`:

```jsonc
"vars": {
  "ACCESS_TEAM_DOMAIN": "yourteam.cloudflareaccess.com",
  "ACCESS_AUD": "the-long-hex-aud-tag"
}
```

```bash
cd cloud && npx wrangler@4 deploy
```

Until `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are both set, the Worker refuses every
API request rather than trusting the `Cf-Access-Authenticated-User-Email` header on
its own. A forwarded header is only as trustworthy as whatever sits in front of it,
so the JWT signature, audience, issuer and expiry are all verified against the
team's JWKS.

### Point the app at the right person

In `index.html`, fill in `PROFILE_BY_EMAIL`:

```js
const PROFILE_BY_EMAIL = {
  'you@example.com': 'jt',
  'cofounder@example.com': 'lupe',
};
```

With that set, the JT/Lupe toggle stops being a free choice and follows whoever
signed in. Leave it empty and the toggle stays manual, which is what the GitHub
Pages copy does.

## Local development

```bash
cd cloud && npx wrangler@4 dev --persist-to ../../.wrangler-state --var DEV_EMAIL:you@local.test
```

`DEV_EMAIL` fakes an identity and is ignored the moment `ACCESS_TEAM_DOMAIN` is
set, so it cannot become an auth bypass in production.

Two things to know:

- **Do not `npm install` inside `cloud/`.** The static assets directory is the
  repository root, so an in-tree `node_modules` makes `wrangler dev` watch its own
  install and reload in a loop. Use `npx`.
- **Keep local state outside the repo** (`--persist-to`), for the same reason.

## Cost

Roughly 900 writes a month for two people training five days a week. The free tier
covers about 3M writes and 150M reads, plus 10 GB per Durable Object. Access is
free to 50 users. Expected bill: nothing.

## Where the generic seams are

To put a second small app on this backend:

- pick a new `ns` string;
- reuse `src/access.js` and `src/store.js` unchanged;
- write the client's local store against `saveData(key, value)` and the same
  cursor/dirty-queue pattern in `index.html`.

What is still app-specific and would need lifting to make this a real product:
per-app authorization beyond "the owner", sharing a namespace between two accounts,
schema migrations coordinated across devices, and a way to provision a new app
without editing `wrangler.jsonc`.
