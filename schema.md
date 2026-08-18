# Data model — first principles

Status: design agreed 2026-08-18, not yet implemented
Supersedes: the flat `jt-lupe-{field}-w{week}-d{day}-e{index}-{profile}` keys

## Why this is being redone

The current shape was grown, not designed, and three failures follow from that.

**It loses data you gave it.** "Seated Row: 3 sets of 12 repetitions at 55 pounds"
is stored as one load and one rep count. The set count has nowhere to go. A lifting
log that cannot record how many sets you did is not a lifting log.

**Exercise identity is an array index.** `e2` means "third item in Monday's list".
Reorder the programme, drop an exercise, insert a warm-up, and every historical entry
silently points at a different lift. Nothing errors; the numbers just quietly become
wrong. This is the most dangerous property of the current model.

**Sessions are keyed by week and weekday, not by date.** There is no way to record a
Saturday session, two sessions in a day, or a deload week that repeats. Re-entering
"week 3, Tuesday" overwrites week 3, Tuesday.

None of this is caused by the app being one HTML file. It is caused by keys invented
one at a time while adding features.

## Principles

1. **Record what happened, not what fits the grid.** A set is the unit of truth.
2. **Identity is stable and semantic.** `seated-row`, never `e2`.
3. **Everything is anchored to a calendar date.** The programme maps dates to sessions;
   dates are never derived back from the programme.
4. **Nothing is inferred on write.** If a set count was not stated, it is absent, not 1.
5. **The record survives programme changes.** Editing the plan must never rewrite history.
6. **One key per record.** Last-write-wins stays correct because each person is the only
   writer of their own records.

## Records

Every key is `{type}:{...}` inside a per-person namespace. The Durable Object is already
per-user, so the profile prefix exists only for the signed-out local copy.

| Key | Value | Notes |
| --- | --- | --- |
| `set:{date}:{exerciseId}:{n}` | `{load, unit, reps, rir, seconds, at}` | one working set, `n` is 1-based |
| `session:{date}` | `{templateId, startedAt, note}` | which session was trained that date |
| `meal:{date}:{id}` | `{name, protein, kcal, fdcId, grams, at}` | `fdcId`/`grams` present when picked from the food database |
| `bodyweight:{date}` | `{value, unit, at}` | one weigh-in per date, latest wins |
| `habit:{date}:{habitId}` | `{done, at}` | |
| `programme` | `{version, days:[...]}` | the plan itself, versioned |

`load` is a number **or** the string `BW`; `unit` is `lb`/`kg`/null. `reps` and `seconds`
are both nullable, and exactly one is expected to be set for a given set. `rir` is
nullable and never guessed.

## Programme, separately from the log

```json
{ "version": 1,
  "days": [ { "id": "pull", "label": "Monday · Pull", "focus": "Back, biceps, grip",
              "exercises": [ { "id": "seated-row", "label": "Seated row",
                               "sets": 3, "repLow": 8, "repHigh": 12, "kind": "load" } ] } ] }
```

`kind` is `load`, `bodyweight`, or `timed`, which is what the coach already branches on -
it stops being re-derived from a prescription string on every render.

Changing the programme bumps `version`. Historical sets keep pointing at `seated-row`
whatever position it occupies, and an exercise removed from the plan still resolves for
display because the id is carried on the record.

## What the coach reads

Today it reads one load and one rep count. Under this model it reads the actual sets for
an exercise on the most recent date they exist, which makes real double progression
possible: all sets at the top of the range, not just the last one.

## Migration, honestly

Existing keys carry `(week, day, exerciseIndex) -> load, lastSetReps, done`. Each maps to:

- date: `CHALLENGE_START + (week-1)*7 + weekdayOffset(day)`
- exerciseId: the slug at that index in programme v1, frozen at migration time
- one `set:` record with `n = 1` and `migrated: true`

The set count is genuinely unknown for historical rows and is left absent rather than
invented. `migrated: true` marks rows whose set count is unknown rather than one.

Nothing is deleted until the new records are written and verified.

## Explicitly not decided here

Whether the client stays a single HTML file or moves to a framework. That question is
independent of this one, and this model is the same either way. Getting the schema right
first means a later port carries a correct model instead of porting a broken one twice.
