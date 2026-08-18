# JT + Lupe 60-Day Workout

A small, installable workout application for JT and Lupe. The challenge begins Monday, August 17, 2026 and runs through Thursday, October 15, 2026.

Live app: <https://m-mohamed.github.io/jt-lupe-60-day-workout/>

## What it does

Three tabs, one job each — see [design.md](design.md) for the standard it is built to.

- **Train** — tonight's session, with a per-exercise coach line that reads your last
  performance and tells you to add weight, hold, or how to start. Double progression:
  own the top of the rep range, then add the smallest jump. Working sets at 1–3 RIR.
  Warm-ups and timed efforts are never told to add weight. **Paste from your notes**
  takes a session logged anywhere else — Notes, paper, a chat thread — matches each
  line to an exercise and logs it; unmatched lines are left alone.
- **Fuel** — protein target derived from bodyweight, a running total, a meal log, and
  the daily stack (protein, creatine, pre-workout, sleep). Food lookup searches USDA
  FoodData Central (public-domain, free) for chains and generic restaurant dishes, and
  converts a chosen portion into grams of protein. Signed-in copy only, because the
  request is proxied so the key never ships in the page.
- **Progress** — strength per exercise (first → latest), bodyweight trend, stack
  consistency, and CSV / JSON export.

Each person only ever sees their own numbers. Any past day can be backfilled without
pretending it happened today. Installs as a PWA and works fully offline.

## Where the data lives

The app is local-first in both places it runs. Every read and write hits
`localStorage`, so it works with no network at all.

- **On GitHub Pages** there is no backend. Data stays on that one device, and the
  header chip reads *Local*.
- **On the Cloudflare Worker** (see [cloud/README.md](cloud/README.md)) the same data
  also round-trips to a per-person SQLite database, so it survives a lost phone and
  follows you between devices. The chip shows who is signed in.

The client detects which one it is by calling `./api/me` at startup; a 404 simply
means local-only. Keys are prefixed `jt-lupe-`:

| Key shape | Holds | History |
| --- | --- | --- |
| `jt-lupe-load-w{week}-d{day}-e{index}-{profile}` | working load | one slot per week + weekday + exercise |
| `jt-lupe-reps-w{week}-d{day}-e{index}-{profile}` | reps on the last set — what the coach reads | one slot per week + weekday + exercise |
| `jt-lupe-done-w{week}-d{day}-e{index}-{profile}` | exercise ticked off | one slot per week + weekday + exercise |
| `jt-lupe-meal-{profile}-{YYYY-MM-DD}-{id}` | `{"name","protein"}` for one meal | every meal kept |
| `jt-lupe-habit-{profile}-{YYYY-MM-DD}-{habit}` | daily-stack check-in | every calendar day kept |
| `jt-lupe-weightlog-{profile}-{YYYY-MM-DD}` | bodyweight as `value\|unit` | every calendar day kept |
| `jt-lupe-{profile}-weight`, `-unit` | current bodyweight for the protein calculator | latest only |
| `jt-lupe-profile`, `-active-day`, `-week`, `-theme` | UI preferences | latest only |
| `jt-lupe-schema-version` | storage schema number, used to run migrations | — |
| `jt-lupe-sync-cursor`, `-device`, `-dirty` | sync bookkeeping | — |

The last two groups are device-local and never leave the phone: which day you are
looking at and your theme belong to the device, not the account.

Loads are keyed by *training week*, not by date, so re-entering week 3 / Tuesday
overwrites that slot rather than appending. Habits and bodyweight are keyed by
calendar date and accumulate indefinitely.

Deploying a new version never touches this data: the service worker caches app files
only, and the Cache API cannot reach `localStorage`. Key-shape changes go through the
versioned migration in `migrateStorage()`, which copies old keys forward before
removing them.

On the GitHub Pages copy the data is device-local, so it is lost if the browser's site data is cleared, if
the browser evicts storage under pressure (iOS Safari does this for sites that have not
been visited in about a week unless the app is added to the home screen), or if a
private window is used. The app calls `navigator.storage.persist()` to opt out of
routine eviction where the browser honours it. Use **Backup** before clearing browser
data or changing devices, and **Export CSV** to pull the log into a spreadsheet.
Signing in to the Worker copy removes most of this risk, because the device stops
being the only copy.

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

## Deployment

- **GitHub Pages** publishes from the root of `main`; `.nojekyll` disables Jekyll.
  This is the local-only copy.
- **Cloudflare Worker** serves the same files plus the sync API. See
  [cloud/README.md](cloud/README.md). `.assetsignore` keeps `cloud/` and the docs out
  of the uploaded asset bundle.

## Development

Serve the repository over HTTP so the service worker can register:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8765>. That runs the local-only copy. To develop against
the sync backend instead, use `wrangler dev` as described in
[cloud/README.md](cloud/README.md).
