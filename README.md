# JT + Lupe 60-Day Workout

A small, installable workout application for JT and Lupe. The challenge begins Tuesday, August 11, 2026 and runs through October 9, 2026.

Live app: <https://m-mohamed.github.io/jt-lupe-60-day-workout/>

## What it does

- Provides the Monday-Friday workout plan and automatic weekday selection.
- Tracks separate JT and Lupe loads, exercise completion, protein targets, and daily habits.
- Shows a live 60-day challenge counter and a 90-second rest timer.
- Switches between the JT and Lupe profiles from the top bar. There is no login.
- Keeps a browsable log book of every load, daily-stack check-in, and bodyweight entry.
- Supports JSON backup/restore and CSV export.
- Installs as a progressive web app and caches the core application for offline use.

## Where the data lives

There is no backend. GitHub Pages serves static files only, and nothing is ever uploaded.
Everything is written to `localStorage` on the device, under the origin
`m-mohamed.github.io`, with keys prefixed `jt-lupe-`:

| Key shape | Holds | History |
| --- | --- | --- |
| `jt-lupe-load-w{week}-d{day}-e{index}-{jt\|lupe}` | one working load | one slot per week + weekday + exercise |
| `jt-lupe-done-w{week}-d{day}-e{index}` | exercise ticked off | one slot per week + weekday + exercise, shared by both |
| `jt-lupe-habit-{profile}-{YYYY-MM-DD}-{habit}` | daily-stack check-in | every calendar day kept |
| `jt-lupe-weightlog-{profile}-{YYYY-MM-DD}` | bodyweight as `value\|unit` | every calendar day kept |
| `jt-lupe-{profile}-weight`, `-unit` | current bodyweight for the protein calculator | latest only |
| `jt-lupe-profile`, `-active-day`, `-week`, `-theme` | UI preferences | latest only |
| `jt-lupe-schema-version` | storage schema number, used to run migrations | — |

Loads are keyed by *training week*, not by date, so re-entering week 3 / Tuesday
overwrites that slot rather than appending. Habits and bodyweight are keyed by
calendar date and accumulate indefinitely.

Deploying a new version never touches this data: the service worker caches app files
only, and the Cache API cannot reach `localStorage`. Key-shape changes go through the
versioned migration in `migrateStorage()`, which copies old keys forward before
removing them.

The data is still device-local, so it is lost if the browser's site data is cleared, if
the browser evicts storage under pressure (iOS Safari does this for sites that have not
been visited in about a week unless the app is added to the home screen), or if a
private window is used. The app calls `navigator.storage.persist()` to opt out of
routine eviction where the browser honours it. Use **Backup** before clearing browser
data or changing devices, and **Export CSV** to pull the log into a spreadsheet.

## Development

Serve the repository over HTTP so the service worker can register:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8765>.

## Deployment

GitHub Pages publishes directly from the root of `main`. `.nojekyll` disables unnecessary Jekyll processing.
