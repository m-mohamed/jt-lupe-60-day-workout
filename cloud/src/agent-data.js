const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROFILE = /^(jt|lupe)$/;

const read = raw => {
  try { return JSON.parse(raw); } catch { return null; }
};

const dayKey = date => date.toISOString().slice(0, 10);

/**
 * Build the small, profile-scoped context the model may inspect. The complete
 * Durable Object export never leaves the Worker. Old records and the other profile
 * are removed before the prompt reaches OpenRouter.
 */
export function buildTrainingSnapshot(dump, profile, now = new Date()) {
  if (!PROFILE.test(profile)) throw new Error('invalid profile');
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - 59);
  const oldest = dayKey(cutoff);
  const prefix = `jt-lupe:${profile}:`;
  const snapshot = { profile, windowDays: 60, through: dayKey(now), sets: [], meals: [], supplements: [], bodyweight: [], habits: [] };

  for (const [key, raw] of Object.entries(dump?.data || {})) {
    if (!key.startsWith(prefix)) continue;
    const parts = key.slice(prefix.length).split(':');
    const [kind, date] = parts;
    if (!DATE.test(date || '') || date < oldest || date > snapshot.through) continue;
    const value = read(raw);
    if (value === null || Array.isArray(value)) continue;

    if (kind === 'set') {
      const exerciseId = String(parts[2] || '').slice(0, 80);
      const setNumber = Number(parts[3]);
      if (!exerciseId || !Number.isInteger(setNumber)) continue;
      const set = {
        date, exerciseId, setNumber,
        load: value.load ?? null,
        reps: Number.isFinite(Number(value.reps)) ? Number(value.reps) : null
      };
      if (Array.isArray(value.drops) && value.drops.length) {
        set.drops = value.drops.slice(0, 6).map(drop => ({ load: drop.load ?? null, reps: Number(drop.reps) || 0 }));
      }
      snapshot.sets.push(set);
    } else if (kind === 'meal' && value.name) {
      snapshot.meals.push({ date, name: String(value.name).slice(0, 120), protein: Number(value.protein) || 0, kcal: Number(value.kcal) || 0 });
    } else if (kind === 'supplement' && value.name) {
      snapshot.supplements.push({ date, name: String(value.name).slice(0, 100), dose: value.dose, unit: String(value.unit || '').slice(0, 20) });
    } else if (kind === 'bodyweight' && Number(value.value)) {
      snapshot.bodyweight.push({ date, value: Number(value.value), unit: value.unit === 'kg' ? 'kg' : 'lb' });
    } else if (kind === 'habit' && parts[2]) {
      snapshot.habits.push({ date, habit: String(parts[2]).slice(0, 40), done: value.done === true });
    }
  }

  for (const list of [snapshot.sets, snapshot.meals, snapshot.supplements, snapshot.bodyweight, snapshot.habits]) {
    list.sort((a, b) => b.date.localeCompare(a.date));
    if (list.length > 160) list.length = 160;
  }
  return snapshot;
}
