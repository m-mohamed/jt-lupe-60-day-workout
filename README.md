# JT + Lupe 60-Day Workout

A small, installable workout application for JT and Lupe. The challenge begins Tuesday, August 11, 2026 and runs through October 9, 2026.

Live app: <https://m-mohamed.github.io/jt-lupe-60-day-workout/>

## What it does

- Provides the Monday-Friday workout plan and automatic weekday selection.
- Tracks separate JT and Lupe loads, exercise completion, protein targets, and daily habits.
- Shows a live 60-day challenge counter and a 90-second rest timer.
- Supports device-local JT and Lupe PIN profiles.
- Supports JSON backup and restore.
- Installs as a progressive web app and caches the core application for offline use.

## Data and login boundary

GitHub Pages is static hosting. This application has no backend and does not transmit PINs, weights, workout entries, or check-ins. PIN hashes and workout data are stored only in the browser's local storage. The login prevents casual access on a shared device; it is not cloud authentication.

Use the Backup button before clearing browser data or changing devices. Restoring the backup does not restore PINs, so each device creates its own access PINs.

## Development

Serve the repository over HTTP so the service worker can register:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8765>.

## Deployment

GitHub Pages publishes directly from the root of `main`. `.nojekyll` disables unnecessary Jekyll processing.
