# JT + Lupe Training Log — Design Protocol

Status: implementation standard for the private two-person build
Direction: gym-floor instrument — legible, prescriptive, boring on purpose

## 1. Experience goal

Two founders who are new to lifting must feel three things, in order:

1. I know exactly what to do right now.
2. I know whether I did better than last time.
3. Logging it took less time than the rest between sets.

This is not a fitness brochure. It is an instrument used standing up, one-handed,
on a phone, in bad light, with 90 seconds on the clock. Every pixel that does not
serve the next set is a cost.

## 2. What the previous build got wrong

- **Nine stacked sections on one scroll.** Training, nutrition, log book, progression
  theory, evidence citations, and a printable plan all competed at the same level.
  Finding tonight's session meant scrolling past marketing copy.
- **Brochure furniture in a daily tool.** A hero reading "Simple. Consistent. Ripped.",
  a four-stat proof row, and two panels of research citations are launch-page
  artefacts. They earn their place once, not every session.
- **Logging without meaning.** A single free-text load box per exercise recorded
  *what* was lifted but never *how it went*, so the app could not tell anyone
  whether to go up, hold, or back off. For beginners that is the entire job.
- **Nutrition reduced to four checkboxes.** No record of what was actually eaten,
  and no running total against a target.
- **Desktop-shaped.** Wide tables, small tap targets, controls scattered across a
  long page. It was designed for a laptop and used on a phone.

## 3. Information architecture

Three tabs, one job each. Nothing else competes for the top level.

| Tab | Single question it answers |
| --- | --- |
| **Train** | What am I lifting right now, and what weight? |
| **Fuel** | Did I eat enough protein today? |
| **Progress** | Am I actually getting stronger? |

Everything explanatory — how progression works, why the plan looks like this —
lives in collapsed `<details>` at the bottom of the tab it belongs to. Available,
never in the way.

Tab bar is fixed to the bottom on phones (thumb reach) and becomes a sticky
segmented control at ≥721px. One markup, two placements.

## 4. Visual system

### Palette

Rebuilt 2026-08-18. The previous sage-on-warm-cream read as wellness-spa, and the
warm off-whites gave the whole thing a dingy cast - the specific complaint was that it
looked sloppy. The replacement follows what the athletic apps that do this well have in
common: a near-black base rather than pure black or a warm tint, genuinely neutral
greys, and **one** high-energy accent held back for meaning.

- Base is near-black `#0B0C0F`, not `#000`. Pure black flattens depth; a warm off-white
  is what made the old palette look yellowed.
- Greys are neutral. All the colour in the interface comes from the accent, so nothing
  competes with it.
- The accent is a volt lime - `#A8E04A` on dark, deepened to `#6B9A1C` on light so it
  still passes as a border on white. It is slightly off full saturation; neon reads cheap.

Three colours carry all meaning, and the vocabulary never varies:

| Token | Means | Never used for |
| --- | --- | --- |
| `--accent` | done, on track, go up in weight | decoration |
| `--warm` | backfilling a past day, offline, destructive | anything positive |
| `--focus` | first attempt at a lift, keyboard focus | emphasis |

Every foreground/background pair is checked against WCAG AA - 4.5:1 for text, 3:1 for
borders and UI - in both themes. The light accent is `#6B9A1C` specifically because the
brighter lime measured 2.46:1 as a border on white and failed. Re-run the audit after
any palette change; do not eyeball it.

A finished exercise is marked by its border plus a 7% tint, while the coach line keeps
the solid `--accent-soft` band. Tinting both the same made the card one green block and
buried the one sentence that matters.

### Typography

System sans throughout. One H1 per document (the brand). Numbers that get compared
— loads, reps, protein, bodyweight — use `tabular-nums` so columns line up between
sets.

Scale is deliberately short: 1.5rem stat, 1.12rem session title, 1rem card heading,
0.82rem support, 0.72rem uppercase eyebrow. Nothing else.

### Layout and rhythm

- Single column, `min(760px, 100%)`. No multi-column layouts at any width.
- Cards carry a 1px border and 12px radius; they group, they do not decorate.
- 12px between cards, 14px inside. Consistent everywhere.
- Bottom padding always clears the tab bar plus `env(safe-area-inset-bottom)`.

## 5. Component standards

### Exercise card

The load-bearing component. Top to bottom, always in this order:

1. Exercise name and target (`3 × 8–12 @ 1–3 RIR`).
2. **Coach line** — one sentence, tinted by kind: go up (accent), hold (muted),
   first attempt (focus). Never more than one sentence.
3. Weight, reps, done — in that order, left to right, thumb-sized.

A completed card is marked by its accent border and a 7% tint - enough to read while
scrolling past at arm's length, light enough that the coach line stays the loudest
thing on the card.

### Coach line

- States the decision, not the theory: "Week 1: 135 × 9. Stay at 135 and chase 10."
- Always references the actual last performance when one exists.
- Never tells someone to add weight on a warm-up or a timed effort.
- Silence is not an option — a first attempt gets a starting instruction.

### Session navigation

- `‹ Wednesday · Push ›` steps through the five weekday sessions.
- Any session that is not today's is flagged in `--warm` with the words
  "Catching up" and the day named. Backfilling must never be mistaken for tonight.
- A progress meter shows sets completed in the current session.

### Fuel

- Protein is a running total against a target derived from bodyweight, with a
  meter. The number logged so far is the largest element on the tab.
- Meals are a list with a one-line add form: name plus optional grams. Estimating
  is expected; precision is not the point.
- The date control governs meals and the daily stack together, and refuses future
  dates.

### Rest timer

Floating pill above the tab bar, reachable without leaving the exercise list.
Shows time, one toggle, one reset. It is the only floating element in the app.

## 6. Copy protocol

- Say the decision, then the reason. "Go up to 140 — you hit 12 last week."
- Second person, present tense, no exclamation marks, no encouragement theatre.
- Never imply certainty the data does not support. If reps were not logged, say so
  and ask for them.
- Numbers carry units. `145 g`, `135 lb`, `9 reps`.
- No superlatives, no "crush it", no streak guilt.

## 7. Accessibility and performance

- Minimum 40px touch targets; 42px on primary inputs.
- Every control has a visible focus ring and an accessible name.
- Tabs use `role="tab"` / `aria-selected`; panels use `role="tabpanel"`.
- Checkboxes are wrapped in labels so the whole row is tappable.
- `prefers-reduced-motion` disables all transition and animation.
- No framework, no fonts, no external requests. One HTML file, inline CSS and JS.
- The app must render and be fully usable with the network off.

## 8. Definition of polished

- Opening the app on a gym phone shows tonight's first exercise without scrolling.
- Every working exercise shows a specific weight decision before the set is done.
- Logging one exercise is three taps: weight, reps, done.
- Nothing on screen is decorative.
- Light and dark are equally finished; neither is an afterthought.
- A missed day can be filled in without lying about when it happened.
