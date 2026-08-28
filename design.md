# JT + Lupe Training OS — Beautiful UI contract

Status: implementation standard for the private two-person application
Direction: Beautiful UI first, gym-floor fast, local-first

## Product boundary

This is one tracking application with four first-class jobs:

| Surface | Job |
| --- | --- |
| **Workout** | Record every set, weight, rep, and lighter finish. |
| **Food** | Record meals and protein, including editable Hot Bar estimates. |
| **Supplements** | Record the product, actual dose, unit, and date taken. |
| **Progress** | Read strength, bodyweight, intake consistency, and exports. |

The training plan is weight-first. Machines, cables, dumbbells, and kettlebells are
the main tools. The Anime Physique material informs priorities such as lats, shoulders,
upper chest, legs, and core. It does not turn the plan into a calisthenics program.

## Beautiful UI is the source system

[Beautiful UI](https://www.beautifului.dev/) is an MIT-licensed collection of
copy-paste React/Tailwind primitives, not a runtime package. This repository ports the
official patterns into `beautiful-ui.css` because the deployed app must remain a
zero-build offline PWA.

Every primary surface starts from a Beautiful UI primitive:

- **Sidebar Nav** becomes the desktop navigation and the same controls become a
  thumb-reachable bottom bar on phones.
- **Recommendation Card** becomes each exercise card and its progression decision.
- **Records Table** becomes set entry, strength history, bodyweight history, and
  supplement history.
- **Search** becomes the food lookup surface.
- **Task Rows** become daily fundamentals and completed supplement intake.
- **Filter Table** supplies status chips and date-level organization.
- **Insight Cards** supply the compact progress statistics.

Do not add a parallel design language. A new surface must use the tokens and one of
these component grammars before it adds product-specific behavior.

## Tokens

The light and dark surface ladder, ink ladder, accent/status colors, shadows, radii,
and strong easing curve come from Beautiful UI:

- Surfaces: `--page`, `--canvas`, `--surface`, `--inset`, `--hover`, `--field`.
- Text: `--ink`, `--ink-2`, `--ink-3`.
- Meaning: `--accent`, `--green`, `--orange`, `--red` and their tints.
- Elevation: `--shadow-hairline`, `--shadow-btn`, `--shadow-card`,
  `--shadow-raised`.
- Geometry: 6px chip, 8px control, 10px card, 14px window.
- Motion: `cubic-bezier(.23, 1, .32, 1)` with reduced-motion fallback.

The blue accent means selected, active, or recommended. Green means completed.
Orange means backfill, offline, or attention. Red is destructive only.

## Workout contract

An exercise Recommendation Card always contains:

1. Exercise and prescribed range.
2. A one-sentence recommendation based on real history.
3. One Records Table row per planned set.
4. Weight and reps/time for that set only.
5. A secondary action that copies set 1 into blank rows without replacing any set
   that already contains actual values.
6. An optional native disclosure for lighter or assisted finish reps.
7. A completed control in the card header.

`100 × 6 + 70 × 4` is one planned set with two efforts. It is not stored as two
ordinary sets. Blank planned rows mean not performed and are omitted.

The plan runs Monday, Wednesday, and Friday. Other dates render recovery rather than
silently mapping to a different workout. Historical exercises remain readable after
the program changes.

## Food contract

Food shows a dated protein total, meal records, Beautiful UI Search, daily fundamental
Task Rows, and bodyweight entry. A database result fills the editable meal form; it
never writes without the user pressing Add.

Whole Foods Hot Bar has no stable USDA menu. Matching searches use clearly labeled
built-in estimates in 4, 6, and 8 ounce portions. The interface explains store/day
variation and leaves protein editable.

## Supplement contract

Supplements are a dedicated tracker, not a checkbox hidden in food. Each completed
Task Row records name, numeric dose, unit, time, and date. Creatine 5 g is a quick-add
because it is already part of the plan. Any custom supplement can be recorded.

This surface records behavior. It does not diagnose, prescribe, or invent a stack.
Copy directs the person to the label or clinician for dosing.

## Mobile and desktop

The phone is the primary device. The first workout card is reachable without a long
dashboard preamble. Controls are at least 40px high, fields are 42px, safe-area insets
are respected, and the rest timer clears the navigation.

At 900px, the exact navigation becomes a Beautiful UI Sidebar Nav and content remains
in a focused 800px work area. The desktop layout does not stretch forms into a wide
dashboard.

## Accessibility and verification

- Exactly one H1 identifies the product.
- Tabs use `role="tab"` and panels use `role="tabpanel"`.
- Every control has an accessible name and visible focus.
- Native labels, fieldsets, tables, checkboxes, and disclosures remain intact.
- Both themes meet WCAG AA text contrast and 40px touch targets.
- `prefers-reduced-motion` effectively disables motion.
- The app remains fully usable offline.
- Browser verification covers 390px mobile and desktop before deployment.

## Definition of done

- No legacy visual system is active or shipped in the document.
- Workout, food, supplements, and progress all use Beautiful UI components.
- Per-set and in-set drop values survive editing, sync, history, backup, and CSV.
- Food estimates identify uncertainty.
- Supplement history keeps dose and unit.
- Lint, Access tests, browser suites, accessibility audit, screenshots, CI, Worker
  deploy, and live endpoint checks all pass.
