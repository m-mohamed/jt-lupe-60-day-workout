import { Type } from '@earendil-works/pi-ai';

export const PROPOSAL_TYPES = ['set', 'meal', 'supplement', 'bodyweight', 'habit', 'steps', 'profile', 'removal'];
export const UI_ACTION_TYPES = ['navigate', 'interface'];

const textResult = (text, details = {}) => ({ content: [{ type: 'text', text }], details });
const proposalResult = proposal => textResult(
  'Prepared a draft for the person to review. Nothing has been written yet.',
  { proposal }
);

/**
 * Every mutation is proposal-only. Pi can read the private snapshot and prepare the
 * same record actions exposed by the manual UI, but only the browser approval card
 * can apply one to the log.
 */
export function trainingTools(snapshot, { searchFood = async () => ({ foods: [], error: 'food_search_unavailable' }) } = {}) {
  return [
    {
      name: 'get_training_snapshot',
      label: 'Review training history',
      description: 'Read the signed-in person’s private plan, workout, food, supplement, habit, steps, and bodyweight records from the last 60 days.',
      parameters: Type.Object({}),
      execute: async () => textResult(JSON.stringify(snapshot), {
        recordCounts: Object.fromEntries(
          ['sets', 'meals', 'supplements', 'bodyweight', 'habits', 'steps'].map(key => [key, snapshot[key]?.length || 0])
        ),
        truncated: snapshot.truncated === true,
        omitted: snapshot.omitted || {}
      })
    },
    {
      name: 'search_food_catalog',
      label: 'Search food catalog',
      description: 'Search the same USDA and clearly labelled Whole Foods Hot Bar catalog available in the Food interface. Use this before estimating a meal when the person has not supplied nutrition values.',
      parameters: Type.Object({
        query: Type.String({ minLength: 2, maxLength: 120 })
      }),
      execute: async (_id, args) => {
        const result = await searchFood(args.query);
        return textResult(JSON.stringify(result), { foods: result.foods || [], error: result.error || null });
      }
    },
    {
      name: 'propose_set_log',
      label: 'Draft set log',
      description: 'Create a reviewable workout-set draft. This does not save anything until the person taps Apply.',
      parameters: Type.Object({
        date: Type.String({ description: 'YYYY-MM-DD' }),
        exerciseId: Type.String({ description: 'Stable exercise id from the training snapshot or programme, such as bench-press' }),
        exerciseName: Type.String(),
        setNumber: Type.Integer({ minimum: 1, maximum: 20 }),
        load: Type.Union([Type.Number({ minimum: 0 }), Type.String({ maxLength: 30 })]),
        reps: Type.Integer({ minimum: 0, maximum: 200 }),
        drops: Type.Optional(Type.Array(Type.Object({
          load: Type.Union([Type.Number({ minimum: 0 }), Type.String({ maxLength: 30 })]),
          reps: Type.Integer({ minimum: 1, maximum: 100 })
        }), { maxItems: 6 }))
      }),
      execute: async (_id, args) => proposalResult({ kind: 'set', ...args })
    },
    {
      name: 'propose_meal_log',
      label: 'Draft meal log',
      description: 'Create a reviewable meal draft. Nutrition numbers must be described as estimates unless they came from a label.',
      parameters: Type.Object({
        date: Type.String({ description: 'YYYY-MM-DD' }),
        name: Type.String({ maxLength: 120 }),
        protein: Type.Number({ minimum: 0, maximum: 500 }),
        carbs: Type.Optional(Type.Number({ minimum: 0, maximum: 1500 })),
        fat: Type.Optional(Type.Number({ minimum: 0, maximum: 500 })),
        kcal: Type.Optional(Type.Number({ minimum: 0, maximum: 10000 })),
        estimate: Type.Boolean({ description: 'True unless values came from an exact label or saved food result' })
      }),
      execute: async (_id, args) => proposalResult({ kind: 'meal', ...args })
    },
    {
      name: 'propose_supplement_log',
      label: 'Draft supplement log',
      description: 'Create a reviewable record of a supplement the person says they already took. Never use it to prescribe a supplement.',
      parameters: Type.Object({
        date: Type.String({ description: 'YYYY-MM-DD' }),
        name: Type.String({ maxLength: 100 }),
        dose: Type.Number({ exclusiveMinimum: 0, maximum: 10000 }),
        unit: Type.String({ maxLength: 20 })
      }),
      execute: async (_id, args) => proposalResult({ kind: 'supplement', ...args })
    },
    {
      name: 'propose_bodyweight_log',
      label: 'Draft bodyweight log',
      description: 'Create a reviewable bodyweight draft. This does not save until the person taps Apply.',
      parameters: Type.Object({
        date: Type.String({ description: 'YYYY-MM-DD' }),
        value: Type.Number({ minimum: 40, maximum: 1500 }),
        unit: Type.Union([Type.Literal('lb'), Type.Literal('kg')])
      }),
      execute: async (_id, args) => proposalResult({ kind: 'bodyweight', ...args })
    },
    {
      name: 'propose_habit_log',
      label: 'Draft daily check',
      description: 'Create a reviewable daily-fundamental draft for protein, pre-workout food, or sleep. This can mark the check complete or not complete.',
      parameters: Type.Object({
        date: Type.String({ description: 'YYYY-MM-DD' }),
        habit: Type.Union([Type.Literal('protein'), Type.Literal('preworkout'), Type.Literal('sleep')]),
        done: Type.Boolean()
      }),
      execute: async (_id, args) => proposalResult({ kind: 'habit', ...args })
    },
    {
      name: 'propose_step_log',
      label: 'Draft step log',
      description: 'Create a reviewable daily step-count draft. This does not save until the person taps Apply.',
      parameters: Type.Object({
        date: Type.String({ description: 'YYYY-MM-DD' }),
        value: Type.Integer({ minimum: 0, maximum: 100000 })
      }),
      execute: async (_id, args) => proposalResult({ kind: 'steps', ...args })
    },
    {
      name: 'propose_profile_update',
      label: 'Draft plan update',
      description: 'Create a reviewable update to the person’s starting profile and nutrition/activity plan.',
      parameters: Type.Object({
        weight: Type.Number({ minimum: 40, maximum: 1500 }),
        unit: Type.Union([Type.Literal('lb'), Type.Literal('kg')]),
        heightCm: Type.Number({ minimum: 100, maximum: 250 }),
        experience: Type.Union([Type.Literal('new'), Type.Literal('returning'), Type.Literal('consistent')]),
        dailySteps: Type.Integer({ minimum: 1000, maximum: 50000 }),
        mealsPerDay: Type.Integer({ minimum: 1, maximum: 8 }),
        freeMealsPerWeek: Type.Integer({ minimum: 0, maximum: 7 })
      }),
      execute: async (_id, args) => proposalResult({ kind: 'profile', ...args })
    },
    {
      name: 'propose_record_removal',
      label: 'Draft record removal',
      description: 'Create a reviewable removal draft for an existing set, meal, or supplement. Use identifiers from the private snapshot. Nothing is removed until the person approves.',
      parameters: Type.Object({
        date: Type.String({ description: 'YYYY-MM-DD' }),
        recordKind: Type.Union([Type.Literal('set'), Type.Literal('meal'), Type.Literal('supplement')]),
        recordId: Type.Optional(Type.String({ maxLength: 160, description: 'Meal or supplement id from the snapshot' })),
        exerciseId: Type.Optional(Type.String({ maxLength: 80, description: 'Required for a set' })),
        setNumber: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: 'Required for a set' })),
        label: Type.String({ maxLength: 160, description: 'Human-readable record name for the approval card' })
      }),
      execute: async (_id, args) => proposalResult({ kind: 'removal', ...args })
    },
    {
      name: 'open_training_surface',
      label: 'Open Training OS view',
      description: 'Navigate the person to a dated Workout, Food, Supplements, or Progress view. This changes only the visible interface and never changes a record.',
      parameters: Type.Object({
        surface: Type.Union([
          Type.Literal('workout'),
          Type.Literal('food'),
          Type.Literal('supplements'),
          Type.Literal('progress')
        ]),
        date: Type.Optional(Type.String({ description: 'YYYY-MM-DD. Used by dated Workout, Food, and Supplements views.' }))
      }),
      execute: async (_id, args) => textResult(
        `Opening the ${args.surface} view in Training OS.`,
        { uiAction: { kind: 'navigate', ...args } }
      )
    },
    {
      name: 'control_training_interface',
      label: 'Control Training OS interface',
      description: 'Drive a routine device-side Training OS control. Record changes still require proposal approval. Restore and install only open the relevant user control because the browser requires a person to choose a file or confirm installation.',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('timer_start'),
          Type.Literal('timer_pause'),
          Type.Literal('timer_reset'),
          Type.Literal('food_search'),
          Type.Literal('import_notes'),
          Type.Literal('export_csv'),
          Type.Literal('download_backup'),
          Type.Literal('restore_backup'),
          Type.Literal('toggle_theme'),
          Type.Literal('edit_profile'),
          Type.Literal('install_app')
        ]),
        value: Type.Optional(Type.String({ maxLength: 2000, description: 'Food query or session notes for the matching action.' }))
      }),
      execute: async (_id, args) => {
        const uiAction = { kind: 'interface', action: args.action };
        if (args.value) uiAction.value = args.value;
        return textResult(
          `Driving the ${args.action.replaceAll('_', ' ')} control in Training OS.`,
          { uiAction }
        );
      }
    }
  ];
}
