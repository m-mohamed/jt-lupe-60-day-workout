# tools

## Lint

```sh
cd tools && npm install && npm run lint
```

`lint.mjs` stages the two inline `<script>` blocks from `index.html`, `cloud/src` and
`test` into a temporary directory, runs oxlint over them, then rewrites the line
numbers in the output back to `index.html`. Staging happens outside the repository on
purpose: a staging directory inside it would have to be gitignored, and oxlint honours
`.gitignore` — it linted zero files and still exited 0, which is the failure mode this
project keeps getting caught by.

## anti-slop

`oxlint/anti-slop/` is [Dillon Mulroy's anti-slop plugin](https://github.com/dmmulroy/anti-slop),
vendored as that project intends. Its premise is that widening a type, hiding a known
value behind `unknown`, or narrowing with an ad hoc runtime check all throw away
evidence the compiler already had, and that the fix is to parse once at the I/O
boundary and work in domain values from there.

Fifteen of its sixteen rules are about TypeScript type syntax. This codebase is plain
JavaScript with no build step, so those rules have nothing to match and are enabled
only so they start working if that ever changes. `no-runtime-typeof` is the one that
applies, and it earned its place — it found:

- `typeof payload.exp === 'number' && payload.exp < now` in the Access JWT check.
  A token whose `exp` was not a number skipped the expiry check entirely and would
  have been honoured forever. Claims are now parsed once, and an expiry is required.
- Two `typeof` narrowings in the sync and food endpoints, now replaced by a single
  parse at the request boundary.

Oxlint's own correctness rules found three dead helpers left behind by the schema
rebuild and a variable shadowing that hid a live crash.

The severity of a finding is a starting point, not a verdict. Rules are not weakened
to make the run green, and findings are not suppressed — they are fixed or the
reasoning for keeping the code is written down.
