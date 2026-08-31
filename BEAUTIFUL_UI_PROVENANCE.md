# Beautiful UI provenance

Catalog verified: 2026-08-31
Source: <https://www.beautifului.dev/>
License: <https://www.beautifului.dev/license>

Beautiful UI publishes copy-paste React/Tailwind component source, not a runtime
package. Training OS is deliberately a zero-build, offline-first vanilla PWA, so it
cannot execute those React components unchanged. No substantial catalog source is
copied into this repository. The implementation is therefore a documented semantic
fallback: native HTML controls preserve the named catalog patterns, state model,
accessibility semantics, token relationships, and responsive behavior without claiming
an undocumented Beautiful UI import or API.

| Catalog primitive | Training OS surface |
| --- | --- |
| Loading State | Coach pixel loader and elapsed time |
| Thinking | Expandable Coach run state |
| Streaming Text | Incremental Coach reply |
| Approval Card | Human approval before any record write and focused onboarding shell |
| Tool Chips | Agent tools and rest timer |
| Task Rows | Exercise, supplement, and Agent status rows |
| Chat | Coach transcript |
| Prompt Bar | Global and Coach composers |
| Context Cards | Workout notes import |
| Diff Table | Current versus proposed record values |
| Records Table | Strength, weight, meal, step, and supplement history |
| Filter Table | Workout date/session controls |
| Sidebar Nav | Desktop navigation and mobile bottom adaptation |
| Search | Food lookup and Coach recommendations |
| Insight Cards | Macro and progress summaries |
| Code Block | Structured proposal disclosure |
| Fine-tune Card | Bodyweight, steps, and supplement entry |
| Selection Actions | Export, backup, restore, theme, and conversation controls |

Recommendation Card and Flowchart are valid catalog primitives but are deliberately not
mounted: starter-action buttons duplicated the Prompt Bar, and the agent control-path
diagram exposed implementation details instead of helping JT or Lupe train.

Verification is automated in `test/catalog.test.js`, `test/a11y.test.js`, and
`test/responsive.test.js`: every product-needed pattern, runtime state, keyboard focus,
label, touch target, contrast rule, reduced-motion rule, mobile/desktop overflow check,
and forbidden legacy component class is a release gate.
