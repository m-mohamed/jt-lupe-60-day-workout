# Tests

Two servers, depending on the suite.

```sh
# local-only suites
python3 -m http.server 8911 --bind 127.0.0.1

# the suites that need the sync API — note the vars
cd cloud && npx wrangler@4 dev --port 8777 \
  --var ACCESS_TEAM_DOMAIN: --var ACCESS_AUD: --var DEV_EMAIL:dev@local
```

Those three flags matter. `wrangler dev` reads the production Access config out of
`wrangler.jsonc`, every request 401s, and the app falls back to local-only — where
sync, offline queueing and multi-device do not exist. The suite used to run happily
in that state and report nothing wrong. It now checks `/api/me` first and exits 2.

Then `node test/<file>` with `playwright-core` resolvable.

| File | Port | Covers |
| --- | --- | --- |
| `session-flow.test.js` | 8911 | a training night: log, correct, cut sets, backfill a day |
| `human-interaction.test.js` | 8911 | real typing, tapping, pasting, backgrounding |
| `edge-cases.test.js` | 8777 | injection, corrupt records, offline queue, restore |
| `migration.test.js` | 8911 | v3 grid → v4 dated records |
| `import.test.js` | 8911 | pasting a session from notes |
| `../cloud/access.test.mjs` | — | Access JWT verification |

## The rule these exist to enforce

**Drive the app the way a person does.** Never assert against a synthetic event you
fired yourself.

A whole suite once passed while a basic bug shipped: every test committed a value with
`dispatchEvent(new Event('change'))`, which proved only that the storage function works
when called. Nobody types a change event. A person types digits and puts the phone in
their pocket — no blur, no change, nothing saved. Two more of the same shape were sitting
behind it: a pasted or autofilled value never marks a field dirty, so blur fires nothing
either; and switching tab or day inside the app left a half-typed field behind.

So: `tap()` the field, `keyboard.type()` the value, and leave the way a person leaves —
another field, another tab, the home button, a reload. Assert on what reached storage,
never on what the handler did.

## The second rule

**A suite that cannot fail is worse than no suite.** Both times this repo shipped a bug
past a green run, the tests were exercising something other than the thing under test —
once the storage function instead of the user, once local-only mode instead of the API.
Every suite should assert its own preconditions and exit non-zero when they are not met.

## Lint

`cd tools && npm install && npm run lint` runs oxlint over the Worker, the tests and the
inline script in `index.html`, with [anti-slop](https://github.com/dmmulroy/anti-slop)
registered. Findings are reported against `index.html` line numbers, not the temporary
copy. It must exit 0.
