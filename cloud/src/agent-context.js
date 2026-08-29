const SURFACES = new Set(['workout', 'food', 'supplements', 'coach', 'progress']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = value => Object.prototype.toString.call(value) === '[object Object]';
const isCalendarDate = value => {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};
const maxPlanningDate = through => {
  const date = new Date(`${through}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString().slice(0, 10);
};

const cleanText = (value, max) => String(value || '')
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

/** Accept only the small orientation object the product itself can emit. */
export function normalizeUiContext(input, through) {
  if (!isRecord(input)) return null;
  const surface = SURFACES.has(input.surface) ? input.surface : null;
  if (!surface) return null;
  const requestedDate = String(input.date || '');
  const date = isCalendarDate(requestedDate) && requestedDate <= maxPlanningDate(through) ? requestedDate : through;
  const context = { surface, date };

  if (surface === 'workout' && isRecord(input.session)) {
    const id = cleanText(input.session.id, 40);
    const label = cleanText(input.session.label, 60);
    const focus = cleanText(input.session.focus, 80);
    if (/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) && label) {
      context.session = { id, label };
      if (focus) context.session.focus = focus;
    }
  }
  return context;
}

export function uiContextInstruction(context) {
  if (!context) return 'Current interface context: none supplied.';
  return `Current interface context (orientation only; verify logged facts with tools): ${JSON.stringify(context)}`;
}
