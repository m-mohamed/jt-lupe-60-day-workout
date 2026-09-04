# JT + Lupe Training OS — Beautiful UI contract

Status: implementation standard for the private two-person application
Direction: Beautiful UI first, gym-floor fast, local-first

## Product boundary

This is one tracking application with five first-class jobs:

| Surface | Job |
| --- | --- |
| **Workout** | Record every set, weight, rep, and lighter finish. |
| **Food** | Record full meal macros, steps, and bodyweight, including editable Hot Bar estimates. |
| **Supplements** | Record the product, actual dose, unit, and date taken. |
| **Coach** | Read private history and prepare any supported record or plan change for approval. |
| **Progress** | Read strength, weekly bodyweight, steps, intake consistency, and exports. |

The training plan is weight-first. Machines, cables, dumbbells, and kettlebells are
the main tools. The Anime Physique material informs priorities such as lats, shoulders,
upper chest, legs, and core. It does not turn the plan into a calisthenics program.

The Coach and direct controls share one capability surface: all record changes resolve
to the same local-first record functions, while the Coach adds an approval step. It can
also search the same food catalog and drive dated views, the timer, import, exports,
plan editing, backup, theme, restore, and installation. Browser-protected restore and install steps
focus the direct control so the person can choose a file or confirm the system prompt.

## Beautiful UI is the source system

[Beautiful UI](https://www.beautifului.dev/) is the catalog contract. It is a public
collection of copy-paste AI-interface patterns rather than a runtime package in
this vanilla PWA. The document uses the catalog's named structures directly and
`beautiful-ui.css` provides their responsive vanilla-CSS implementation.

Every primary surface starts from a Beautiful UI primitive:

- **Sidebar Nav** becomes the desktop navigation and the same controls become a
  thumb-reachable bottom bar on phones.
- **Filter Table** owns the workout date and session state.
- **Task Rows** own exercises, daily fundamentals, and completed supplement intake.
- **Records Table** owns meal, strength, bodyweight, and supplement history.
- **Search** becomes the food lookup surface.
- **Fine-tune Card** owns bodyweight, steps, and supplement entry.
- **Insight Cards** own macros, intake, and progress summaries.
- **Prompt Bar** is the system-wide handoff into the agent and the chat composer.
- **Chat**, **Streaming Text**, **Thinking**, **Loading State**, and **Tool Chips**
  expose the live agent run.
- **Approval Card** is the only agent-to-record write gate and the focused onboarding shell.
- **Context Cards** own workout notes import.
- **Diff Table** compares current and proposed values before an agent write.
- **Code Block** reveals the exact structured draft behind an approval.
- **Selection Actions** own onboarding, export, backup, restore, theme, and conversation controls.

Do not add a parallel design language. A new surface must use the tokens and one of
these component grammars before it adds product-specific behavior.

Catalog primitives are mounted only when they have a product job. Recommendation Card
and Flowchart are intentionally omitted because starter buttons duplicated the Prompt
Bar and implementation diagrams added non-product copy.

## Interface rules

- Do not introduce a generic card, chip, badge, or pill primitive.
- Use space and table rules before adding another container.
- Use one primary action in each task context.
- Preserve catalog names in `data-bui` attributes so the component audit is visible
  in the document.
- Use neutral surfaces, blue for selected or active, green for completed, amber for
  attention, and red only for destructive actions.
- Keep all controls at least 40px high and honor reduced motion.

## Workout contract

An exercise Task Row always contains:

1. Exercise and prescribed range.
2. A one-sentence recommendation based on real history.
3. One set-entry row per planned set.
4. Weight and reps/time for that set only.
5. A secondary action that copies set 1 into blank rows without replacing any set
   that already contains actual values.
6. An optional native disclosure for lighter or assisted finish reps.
7. A completed control in the Task Row header.

`100 × 6 + 70 × 4` is one planned set with two efforts. It is not stored as two
ordinary sets. Blank planned rows mean not performed and are omitted.

The PPLU plan runs Monday, Tuesday, Thursday, and Friday. Other dates render recovery rather than
silently mapping to a different workout. Historical exercises remain readable after
the program changes.

## Food contract

Food shows dated macro totals, meal records, Beautiful UI Search, daily steps and weekly
step total, daily fundamental Task Rows, and bodyweight entry. A database result fills the editable meal form; it
never writes without the user pressing Add.

Whole Foods Hot Bar has no stable USDA menu. Matching searches use clearly labeled
built-in estimates in 4, 6, and 8 ounce portions. The interface explains store/day
variation and leaves every macro editable.

## Onboarding contract

OnboardJS core owns the three-step state machine, navigation, draft persistence, and
completion event. Beautiful UI owns the visible Approval Card and Selection Actions.
The saved profile contains only product inputs and derived targets; OnboardJS internal
state never enters the synced profile record.

## Supplement contract

Supplements are a dedicated tracker, not a checkbox hidden in food. Each completed
Task Row records name, numeric dose, unit, time, and date. Product presets fill the
exact names for Optimum Nutrition Extreme Milk Chocolate and Optimum Nutrition
Creatine Pills, but leave the amount to the product label instead of inventing a dose.
Any custom supplement can be recorded.

This surface records behavior. It does not diagnose, prescribe, or invent a stack.
Copy directs the person to the label or clinician for dosing.

## Mobile and desktop

The phone is the primary device. The first workout row is reachable without a long
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
- Browser verification covers 320px, 390px, tablet, and desktop before deployment.

## Definition of done

- No legacy visual system is active or shipped in the document.
- Workout, food, supplements, Coach, and progress all use Beautiful UI components.
- Per-set and in-set drop values survive editing, sync, history, backup, and CSV.
- Food estimates identify uncertainty and keep full macros editable.
- Onboarding, plan targets, and daily steps sync per person.
- Supplement history keeps dose and unit.
- Lint, Access tests, browser suites, accessibility audit, screenshots, CI, Worker
  deploy, and live endpoint checks all pass.
