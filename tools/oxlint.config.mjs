// Dillon Mulroy's anti-slop rules (https://github.com/dmmulroy/anti-slop), vendored
// under oxlint/anti-slop as the project intends. The rules are written for
// TypeScript, and this codebase is plain JavaScript, so most of them cannot fire
// here - what does fire is `no-runtime-typeof`, plus oxlint's own correctness set,
// and between them they found real defects. See ../test/README.md.
export default {
  ignorePatterns: ['oxlint/anti-slop/**', 'node_modules/**'],
  jsPlugins: [{ name: 'anti-slop', specifier: './oxlint/anti-slop/index.ts' }],
  categories: { correctness: 'error', suspicious: 'warn', perf: 'warn' },
  rules: {
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/no-conditional-empty-object-spread': 'error',
    'anti-slop/no-known-value-widening': 'error',
    'anti-slop/no-module-mocking': 'error',
    'anti-slop/no-object-parameters': 'error',
    'anti-slop/no-reflect-apply': 'error',
    'anti-slop/no-reflect-get': 'error',
    'anti-slop/no-runtime-typeof': 'error',
    'anti-slop/no-shape-in-symbol-names': 'error',
    'anti-slop/no-unknown-parameters': 'error',
    'anti-slop/no-unknown-returns': 'error',
    'anti-slop/no-unknown-type-aliases': 'error',
    'anti-slop/no-unsafe-dictionary-type': 'error',
    'anti-slop/no-widen-then-assert': 'error',
    'anti-slop/require-safety-comment-for-type-assertion': 'error'
  }
};
