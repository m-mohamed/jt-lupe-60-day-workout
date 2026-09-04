# Tests

```sh
cd tools && npm install && npm test
```

That is the whole check: it starts both servers, runs every suite against the one it
needs, lints, tears down, and exits non-zero if anything failed. CI runs the same
command — there is no CI-only path.

To run a single suite, start the servers yourself:

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

Then `node test/<file>` with `playwright-core` resolvable (`NODE_PATH=tools/node_modules`).
`CHROME_PATH` picks the browser; macOS Chrome is the default.

| File | Port | Covers |
| --- | --- | --- |
| `a11y.test.js` | 8911 | computed AA contrast, 40px targets, names, focus, one H1 — both themes |
| `responsive.test.js` | 8911 | every surface at 320, 390, 768, and 1280px; clipping and overflow |
| `session-flow.test.js` | 8911 | a training night: log, correct, cut sets, backfill a day |
| `supplements.test.js` | 8911 | exact product presets, label-driven dose/unit history, single-entry undo |
| `stress.test.js` | 8777 | a full 60-day challenge: batching, two devices, flapping, Worker limits |
| `signed-out.test.js` | 8777 | an expired Access session: recognised, survivable, recoverable |
| `offline.test.js` | 8777 | service worker, offline reload, recovery — on the origin people use |
| `upgrade.test.js` | 8777 | a device on an old version healing itself on one open |
| `human-interaction.test.js` | 8911 | real typing, tapping, pasting, backgrounding |
| `edge-cases.test.js` | 8777 | injection, corrupt records, offline queue, restore |
| `migration.test.js` | 8911 | v3 grid → v4 dated records |
| `import.test.js` | 8911 | pasting a session from notes |
| `agent-parity.test.js` | 8911 | approval-driven record parity, safe UI navigation, and untrusted-draft rejection |
| `../cloud/access.test.mjs` | — | Access JWT verification |
| `../cloud/agent-tools.test.mjs` | — | typed proposal tools stay write-free and cover every record type |
| `../cloud/agent-runtime.test.mjs` | — | the real Pi loop streams tool calls, proposals, follow-up text, and safe failures |
| `../cloud/agent-migration.test.mjs` | — | retired personal OAuth credentials are deleted at Agent startup |
| `../cloud/food-catalog.test.mjs` | — | precise Hot Bar interception and shared USDA routing |

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

## The third rule

**Test the origin people use.** Every offline check ran against the plain static
server, where they passed — while the Cloudflare copy, the one actually installed on
their phones, would not load at all with the network off. The Workers asset server
redirects `/index.html` to `/`, so the cached shell carried `redirected: true`, and
Chrome refuses a redirected response for a navigation. Same file, same code, different
origin, opposite result.

## The fourth rule

**A test may not depend on the day it was written, or the laptop it was written on.**
CI's first run was past midnight UTC on a different machine, and four suites broke at
once: dates pinned to one Tuesday, `Meta+A` (which is `Ctrl+A` off macOS, so every
"type over the old value" check appended instead of replacing and still said PASS),
and a fixture read from `/tmp` on one developer's disk. Derive dates at runtime, take
the browser from `CHROME_PATH`, keep fixtures in the repo.

## The second rule

**A suite that cannot fail is worse than no suite.** Both times this repo shipped a bug
past a green run, the tests were exercising something other than the thing under test —
once the storage function instead of the user, once local-only mode instead of the API.
Every suite should assert its own preconditions and exit non-zero when they are not met.

Four suites once exited 0 while printing `FAIL` lines, because they only failed on an
exception — so a broken assertion read as green for as long as nobody read the output.
They all exit non-zero on a failed check now, and the runner independently treats any
`FAIL` in a suite's output as a failure whatever its exit code.

## Lint

`cd tools && npm install && npm run lint` runs oxlint over the Worker, the tests and the
inline script in `index.html`, with [anti-slop](https://github.com/dmmulroy/anti-slop)
registered. Findings are reported against `index.html` line numbers, not the temporary
copy. It must exit 0.
