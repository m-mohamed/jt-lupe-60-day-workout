# JT + Lupe Training OS

An installable workout, weight, food, and supplement tracker for JT and Lupe. The
60-day training block begins Monday, August 31, 2026 and runs through Thursday,
October 29, 2026. Lifting days are Monday, Wednesday, and Friday; workout, food,
and supplement logging all begin with that opening week.

Private app: <https://jt-lupe-workout.jt-lupe-workout-cloud.workers.dev/>

## What it does

Four trackers and one agent workspace share the same local-first record system. See
[design.md](design.md) for the Beautiful UI implementation contract.

- **Workout** — tonight's session, with a per-exercise coach line that reads your last
  performance and tells you to add weight, hold, or how to start. Double progression:
  own the top of the rep range, then add the smallest jump. Every set has its own
  weight and rep fields. A set can also record a lighter or assisted finish, such as
  `100 lb × 6 + 70 lb × 4`. Fill blank sets from set 1 to avoid repeat typing; any
  set already adjusted stays unchanged. Working sets stay at 1–3 RIR. Timed efforts
  are never told to add weight. The plan is weight-first on Monday, Wednesday, and Friday.
  **Paste from your notes**
  takes a session logged anywhere else — Notes, paper, a chat thread — matches each
  line to an exercise and logs it; unmatched lines are left alone. A session can also
  be handed over as a link: `?log=<text>&date=YYYY-MM-DD` opens the importer with
  the parse already previewed, so each person applies it inside their own account. It
  never writes on its own — the confirm step is the same as a manual paste.
- **Food** — protein target derived from bodyweight, a running total, a meal log, and
  daily fundamentals (protein, pre-workout meal, sleep). Food lookup searches USDA
  FoodData Central (public-domain, free) for chains and generic restaurant dishes, and
  converts a chosen portion into grams of protein. Whole Foods Hot Bar searches return
  a built-in set of clearly labelled estimates because the USDA catalog does not have
  a stable Hot Bar menu. Signed-in copy only, because the request is proxied so the key
  never ships in the page.
- **Supplements** — a dated intake log with a name, actual dose, and unit. Creatine
  5 g is available as a quick-add, but custom supplements are not limited to a fixed
  list. The history records intake; it does not prescribe a medical stack.
- **Progress** — strength per exercise (first → latest), bodyweight trend, supplement
  consistency, daily fundamentals, and CSV / JSON export.
- **Coach** — a Pi agent powered through OpenRouter. The system-wide Prompt Bar carries
  the active screen into the conversation. It reads a private 60-day snapshot and
  drafts set, meal, supplement, and bodyweight records for human approval.

Each person only ever sees their own numbers. Any past day can be backfilled without
pretending it happened today. Installs as a PWA and works fully offline.

## Where the data lives

Cloudflare is the only production surface. Every read and write first hits
`localStorage`, so the installed app remains usable when gym connectivity drops. The
same records round-trip to a per-person SQLite Durable Object whenever the connection
returns, so they survive a lost phone and follow each person between devices. See
[cloud/README.md](cloud/README.md) for the backend and identity model.

Current keys are:

| Key shape | Holds | History |
| --- | --- | --- |
| `jt-lupe:{profile}:set:{date}:{exercise}:{n}` | one set: load, reps/time, optional drop/assist finish | every performed set kept |
| `jt-lupe:{profile}:session:{date}` | the programme session used that day | every trained date kept |
| `jt-lupe:{profile}:meal:{date}:{id}` | `{"name","protein"}` for one meal | every meal kept |
| `jt-lupe:{profile}:habit:{date}:{habit}` | daily-fundamentals check-in | every calendar day kept |
| `jt-lupe:{profile}:supplement:{date}:{id}` | one intake: name, dose, unit, time | every intake kept |
| `jt-lupe:{profile}:bodyweight:{date}` | dated bodyweight and unit | every calendar day kept |
| `jt-lupe:{profile}:activity:{id}` | receipt for an agent-approved write | every approved action kept |
| `jt-lupe-{profile}-weight`, `-unit` | current bodyweight for the protein calculator | latest only |
| `jt-lupe-profile`, `-active-date`, `-theme` | UI preferences | latest only |
| `jt-lupe-schema-version` | storage schema number, used to run migrations | — |
| `jt-lupe-sync-cursor`, `-device`, `-dirty` | sync bookkeeping | — |

The last two groups are device-local and never leave the phone: which day you are
looking at and your theme belong to the device, not the account.

Sets are keyed by calendar date, stable exercise id, and set number. Changing the
programme cannot silently point old numbers at a different exercise. Habits and
bodyweight are also keyed by calendar date and accumulate indefinitely. Supplement
records use unique ids, so two products or two doses on the same date never overwrite
each other.

## Interface system

The application shell is rebuilt from [Beautiful UI](https://www.beautifului.dev/),
an MIT-licensed collection of copy-paste primitives for AI-native interfaces.
Beautiful UI is not a runtime dependency in this zero-build PWA. Its catalog contracts
are implemented directly in the document and `beautiful-ui.css`, preserving offline
startup without a frontend build step. Every product surface uses a catalog primitive;
catalog demos with no user job are not mounted. The active vocabulary includes Sidebar
Nav, Context Cards, Task Rows, Search, Filter Table, Records Table, Prompt Bar, Chat,
Streaming Text, Thinking, Loading State, Tool Chips, Approval Card, Insight Cards,
Fine-tune Card, and Selection Actions. No generic card, chip, badge, pill, or second UI
system is layered on top.
The component-by-component source and compatibility record is in
[`BEAUTIFUL_UI_PROVENANCE.md`](BEAUTIFUL_UI_PROVENANCE.md).

## AI-native architecture

The agent is a control layer, not an automatic writer. A system-wide Prompt Bar hands
off from Workout, Food, Supplements, or Progress into the same conversation. The
Cloudflare Agent uses Pi for the agent loop and OpenRouter for inference. It receives
only the signed-in profile's server-built 60-day snapshot. Normal two-month challenge
history remains complete; storage applies per-record-type candidate and hard-scan
ceilings, skips corrupt rows before candidate caps, and explicitly marks pathological
overflow before it can reach the model. Read tools inspect that
snapshot; write tools return typed proposals. The browser performs the final write only
after a human applies a Beautiful UI Approval Card, then stores an append-only receipt.
The coach uses the same USDA/Whole Foods catalog as the Food surface and can drive the
dated views, rest timer, food search, import, exports, backup, theme, restore handoff,
and installation handoff. Navigation and routine device controls do not change a
training record; every record mutation still requires an Approval Card.
The shared OpenRouter credential is a Cloudflare secret and never enters the browser
or repository. The coach is ready after Cloudflare Access sign-in; JT and Lupe never
connect or manage a model credential. No Apple Health, wearable, medical record, or
health MCP is connected.

Deploying a new version never touches this data: the service worker caches app files
only, and the Cache API cannot reach `localStorage`. Key-shape changes go through the
versioned migration in `migrateStorage()`, which copies old keys forward before
removing them.

Local browser storage can still be cleared or evicted. The app calls
`navigator.storage.persist()` where supported, and Cloudflare sync prevents that
device from being the only copy. Use **Backup** before intentionally clearing browser
data, and **Export CSV** to pull the log into a spreadsheet.

## Food lookup key

Food search calls [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide.html), which
is public-domain US government data and free. The key exists only for rate limiting and
is held as a Worker secret, never shipped to the browser:

```sh
cd cloud && npx wrangler secret put USDA_API_KEY
```

A personal key allows **3,600 requests an hour**. Without one the Worker falls back to
the shared `DEMO_KEY`, which allows **10 lookups an hour** and is effectively unusable - the app says so plainly rather than failing quietly.
Keys from api.data.gov are free, instant and need no card. Responses are cached for 24
hours per query, which also makes a repeat lookup effectively instant.

The search is issued as a **POST** with a JSON body. Multiple `dataType` values cannot be
expressed on the query string - repeating the parameter and comma-joining it are both
rejected by the edge with a bare nginx 400 before the API sees them.

Nutrients come back **per 100 g** for every dataType requested, so the grams of the
chosen portion are what turn a row into a meal. Survey (FNDDS) rows carry real portions
("1 cup" = 244 g); rows without portions fall back to 100 g.

Whole Foods Hot Bar recipes vary by store and day. The Worker intercepts searches for
`Whole Foods Hot Bar` and returns common plate components in 4, 6, and 8 oz portions.
Every result says `estimate`, and the filled protein number remains editable before it
is added to the log.

## Deployment

The **Cloudflare Worker** is the only deployment. It serves the PWA, private sync API,
food lookup, and Pi agent behind Cloudflare Access. See
[cloud/README.md](cloud/README.md). `.assetsignore` keeps `cloud/` and the docs out of
the uploaded asset bundle. GitHub remains source control and CI only.

## Development

Serve the repository over HTTP so the service worker can register:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8765>. That runs the local-only copy. To develop against
the sync backend instead, use `wrangler dev` as described in
[cloud/README.md](cloud/README.md).

## Checks

```sh
cd tools && npm install && npm test
```

Starts both servers, runs every suite against the one it needs, lints, and tears
down. [CI](.github/workflows/check.yml) runs the same command on every push.

Lint is oxlint with [anti-slop](https://github.com/dmmulroy/anti-slop) registered —
see [tools/README.md](tools/README.md) for what it is and what it caught. The browser
suites live in [test/](test/README.md), along with the three rules they exist to
enforce, each written after a bug shipped past a green run.

## Updating

A deploy reaches an installed phone on its own. The service worker calls
`skipWaiting()` and `clients.claim()`, so the next time the app is opened with a
connection the new version installs, takes over, and deletes the previous cache. The
offline shell is also refreshed on every successful load, so a browser that evicts
storage does not strand the app without one. `upgrade.test.js` drives that path from a
device deliberately left on the old, broken cache.
