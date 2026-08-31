const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROFILE = /^(jt|lupe)$/;
const UTF8 = new TextEncoder();
export const MAX_SNAPSHOT_BYTES = 96 * 1024;
const SNAPSHOT_LISTS = ['sets', 'meals', 'supplements', 'bodyweight', 'habits', 'steps'];

const read = raw => {
  try { return JSON.parse(raw); } catch { return null; }
};

const dayKey = date => date.toISOString().slice(0, 10);
const byteLength = value => UTF8.encode(JSON.stringify(value)).byteLength;
const boundedNumber = (value, min, max) => {
  const tag = Object.prototype.toString.call(value);
  if (!['[object Number]', '[object String]'].includes(tag) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};
const boundedLoad = value => {
  const tag = Object.prototype.toString.call(value);
  if (tag === '[object Number]') return boundedNumber(value, 0, 10000);
  if (tag === '[object String]') return String(value).trim().slice(0, 30) || null;
  return null;
};

/** Keep storage collection and final snapshot parsing on the same validity rule. */
export function isTrainingSnapshotCandidate(key, raw, prefix) {
  if (!key.startsWith(prefix)) return false;
  const parts = key.slice(prefix.length).split(':');
  const [kind, date] = parts;
  if (!DATE.test(date || '')) return false;
  const value = read(raw);
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;

  if (kind === 'set') {
    return Boolean(parts[2]) && /^\d+$/.test(parts[3] || '') && Number.isSafeInteger(Number(parts[3]));
  }
  if (kind === 'meal' || kind === 'supplement') return Boolean(value.name);
  if (kind === 'bodyweight') return boundedNumber(value.value, 40, 1500) !== null;
  if (kind === 'steps') return boundedNumber(value.value, 0, 100000) !== null;
  if (kind === 'habit') return Boolean(parts[2]);
  return false;
}

export function trainingSnapshotWindow(profile, now = new Date()) {
  if (!PROFILE.test(profile)) throw new Error('invalid profile');
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - 59);
  return {
    keyPrefix: `jt-lupe:${profile}:`,
    kinds: ['set', 'meal', 'supplement', 'bodyweight', 'habit', 'steps'],
    oldest: dayKey(cutoff),
    through: dayKey(now)
  };
}

/**
 * Normal two-month challenge data remains complete. Only a pathological namespace
 * is trimmed, newest-first and across every record type, before it can become Pi
 * tool output. The snapshot itself tells the model exactly what was omitted.
 */
function boundSnapshot(snapshot) {
  snapshot.snapshotLimitBytes = MAX_SNAPSHOT_BYTES;
  snapshot.truncated = snapshot.candidateLimitReached || snapshot.sourceScanLimitReached;
  if (byteLength(snapshot) <= MAX_SNAPSHOT_BYTES) return snapshot;

  const bounded = {
    profile: snapshot.profile,
    plan: snapshot.plan,
    windowDays: snapshot.windowDays,
    through: snapshot.through,
    sets: [], meals: [], supplements: [], bodyweight: [], habits: [], steps: [],
    snapshotLimitBytes: MAX_SNAPSHOT_BYTES,
    truncated: true,
    candidateLimitReached: snapshot.candidateLimitReached,
    candidateKindsLimited: snapshot.candidateKindsLimited,
    sourceScanLimitReached: snapshot.sourceScanLimitReached,
    sourceScanKindsLimited: snapshot.sourceScanKindsLimited
  };
  const omitted = Object.fromEntries(SNAPSHOT_LISTS.map(key => [key, snapshot[key].length]));
  const cursors = Object.fromEntries(SNAPSHOT_LISTS.map(key => [key, 0]));
  // Reserve room for omitted-count metadata. A final exact check below is still the
  // authority, so this is an efficiency guard rather than a correctness assumption.
  let used = byteLength(bounded);
  const workingLimit = MAX_SNAPSHOT_BYTES - 512;
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const key of SNAPSHOT_LISTS) {
      const index = cursors[key];
      if (index >= snapshot[key].length) continue;
      remaining = true;
      const row = snapshot[key][index];
      cursors[key] += 1;
      const cost = byteLength(row) + (bounded[key].length ? 1 : 0);
      if (used + cost > workingLimit) continue;
      bounded[key].push(row);
      omitted[key] -= 1;
      used += cost;
    }
  }

  bounded.omitted = Object.fromEntries(Object.entries(omitted).filter(([, count]) => count > 0));
  while (byteLength(bounded) > MAX_SNAPSHOT_BYTES) {
    const key = SNAPSHOT_LISTS
      .filter(name => bounded[name].length)
      .toSorted((a, b) => byteLength(bounded[b].at(-1)) - byteLength(bounded[a].at(-1)))[0];
    if (!key) break;
    bounded[key].pop();
    omitted[key] += 1;
    bounded.omitted = Object.fromEntries(Object.entries(omitted).filter(([, count]) => count > 0));
  }
  return bounded;
}

/**
 * Build the small, profile-scoped context the model may inspect. The complete
 * Durable Object export never leaves the Worker. Old records and the other profile
 * are removed before the prompt reaches OpenRouter.
 */
export function buildTrainingSnapshot(dump, profile, now = new Date()) {
  const window = trainingSnapshotWindow(profile, now);
  const oldest = window.oldest;
  const prefix = window.keyPrefix;
  const snapshot = {
    profile, windowDays: 60, through: window.through,
    plan: null, sets: [], meals: [], supplements: [], bodyweight: [], habits: [], steps: [],
    candidateLimitReached: dump?.candidateLimitReached === true,
    candidateKindsLimited: Array.isArray(dump?.candidateLimitedKinds) ? dump.candidateLimitedKinds : [],
    sourceScanLimitReached: dump?.sourceScanLimitReached === true,
    sourceScanKindsLimited: Array.isArray(dump?.sourceScanLimitedKinds) ? dump.sourceScanLimitedKinds : []
  };
  snapshot.truncated = snapshot.candidateLimitReached || snapshot.sourceScanLimitReached;

  const rawPlan = read(dump?.data?.[`${prefix}profile`]);
  if (Object.prototype.toString.call(rawPlan) === '[object Object]') {
    const weight = boundedNumber(rawPlan.weight, 40, 1500);
    const heightCm = boundedNumber(rawPlan.heightCm, 100, 250);
    const dailySteps = boundedNumber(rawPlan.dailySteps, 1000, 50000);
    const mealsPerDay = boundedNumber(rawPlan.mealsPerDay, 1, 8);
    const freeMealsPerWeek = boundedNumber(rawPlan.freeMealsPerWeek, 0, 7);
    if (weight !== null && heightCm !== null && dailySteps !== null
      && mealsPerDay !== null && freeMealsPerWeek !== null) {
      snapshot.plan = {
        weight, unit: rawPlan.unit === 'kg' ? 'kg' : 'lb', heightCm,
        experience: ['new', 'returning', 'consistent'].includes(rawPlan.experience) ? rawPlan.experience : 'returning',
        dailySteps, mealsPerDay, freeMealsPerWeek
      };
    }
  }

  for (const [key, raw] of Object.entries(dump?.data || {})) {
    if (!key.startsWith(prefix)) continue;
    const parts = key.slice(prefix.length).split(':');
    const [kind, date] = parts;
    if (!DATE.test(date || '') || date < oldest || date > snapshot.through) continue;
    if (!isTrainingSnapshotCandidate(key, raw, prefix)) continue;
    const value = read(raw);

    if (kind === 'set') {
      const exerciseId = String(parts[2] || '').slice(0, 80);
      const setNumber = Number(parts[3]);
      if (!exerciseId || !Number.isInteger(setNumber)) continue;
      const set = {
        date, exerciseId, setNumber,
        load: boundedLoad(value.load),
        reps: boundedNumber(value.reps, 0, 999)
      };
      if (Array.isArray(value.drops) && value.drops.length) {
        set.drops = value.drops.slice(0, 6).map(drop => ({
          load: boundedLoad(drop.load), reps: boundedNumber(drop.reps, 0, 999)
        }));
      }
      snapshot.sets.push(set);
    } else if (kind === 'meal' && value.name) {
      snapshot.meals.push({ date, id: String(parts.slice(2).join(':')).slice(0, 160),
        name: String(value.name).slice(0, 120), protein: boundedNumber(value.protein, 0, 500) ?? 0,
        carbs: boundedNumber(value.carbs, 0, 1500) ?? 0,
        fat: boundedNumber(value.fat, 0, 500) ?? 0,
        kcal: boundedNumber(value.kcal, 0, 10000) ?? 0 });
    } else if (kind === 'supplement' && value.name) {
      snapshot.supplements.push({ date, id: String(parts.slice(2).join(':')).slice(0, 160),
        name: String(value.name).slice(0, 100), dose: boundedNumber(value.dose, 0, 10000),
        unit: String(value.unit || '').slice(0, 20) });
    } else if (kind === 'bodyweight' && boundedNumber(value.value, 40, 1500) !== null) {
      snapshot.bodyweight.push({ date, value: boundedNumber(value.value, 40, 1500), unit: value.unit === 'kg' ? 'kg' : 'lb' });
    } else if (kind === 'habit' && parts[2]) {
      snapshot.habits.push({ date, habit: String(parts[2]).slice(0, 40), done: value.done === true });
    } else if (kind === 'steps') {
      snapshot.steps.push({ date, value: boundedNumber(value.value, 0, 100000) });
    }
  }

  for (const list of [snapshot.sets, snapshot.meals, snapshot.supplements, snapshot.bodyweight, snapshot.habits, snapshot.steps]) {
    list.sort((a, b) => b.date.localeCompare(a.date));
  }
  return boundSnapshot(snapshot);
}
