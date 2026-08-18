# Tests

Run a server first: `python3 -m http.server 8911 --bind 127.0.0.1` for the local-only
suites, or `wrangler dev --port 8777` for the ones that need the sync API. Then
`node test/<file>` with `playwright-core` available.

| File | Covers |
| --- | --- |
| `human-interaction.test.js` | real typing, tapping, pasting, backgrounding |
| `edge-cases.test.js` | injection, corrupt records, offline queue, restore |
| `migration.test.js` | v3 grid → v4 dated records |
| `import.test.js` | pasting a session from notes |
| `../cloud/access.test.mjs` | Access JWT verification |

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
