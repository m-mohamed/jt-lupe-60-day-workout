import { OnboardingEngine } from '@onboardjs/core';

const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const targetsFor = ({ weight, unit, dailySteps }) => {
  const pounds = unit === 'kg' ? number(weight, 0) * 2.20462 : number(weight, 0);
  const calories = Math.round((pounds * 12) / 10) * 10;
  const protein = Math.round(pounds);
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat, weeklySteps: number(dailySteps, 10000) * 7 };
};

const steps = [
  { id: 'starting-point', type: 'CUSTOM_COMPONENT', payload: { componentKey: 'starting-point' }, nextStep: 'weekly-rhythm' },
  { id: 'weekly-rhythm', type: 'CUSTOM_COMPONENT', payload: { componentKey: 'weekly-rhythm' }, previousStep: 'starting-point', nextStep: 'starting-targets' },
  { id: 'starting-targets', type: 'CONFIRMATION', payload: { title: 'Starting targets' }, previousStep: 'weekly-rhythm', nextStep: null }
];

let activeEngine = null;
const field = id => document.getElementById(id);
const draftKey = profile => `training-onboarding-draft:${profile}`;

function paint(state) {
  const current = String(state.currentStep?.id || 'starting-point');
  document.querySelectorAll('[data-onboard-step]').forEach(node => { node.hidden = node.dataset.onboardStep !== current; });
  field('onboardProgress').textContent = `${state.currentStepNumber} / ${state.totalSteps}`;
  field('onboardProgressBar').style.width = `${state.progressPercentage}%`;
  field('onboardBack').hidden = state.isFirstStep;
  field('onboardNext').textContent = state.isLastStep ? 'Save plan' : 'Continue';

  if (current === 'starting-targets') {
    const data = state.context.flowData || {};
    const targets = targetsFor(data);
    field('onboardCalories').textContent = `${targets.calories.toLocaleString()} kcal`;
    field('onboardProtein').textContent = `${targets.protein.toLocaleString()} g`;
    field('onboardCarbs').textContent = `${targets.carbs.toLocaleString()} g`;
    field('onboardFat').textContent = `${targets.fat.toLocaleString()} g`;
    field('onboardWeeklySteps').textContent = targets.weeklySteps.toLocaleString();
  }
}

function stepData(stepId) {
  if (stepId === 'starting-point') {
    return {
      weight: number(field('onboardWeight').value, 0),
      unit: field('onboardUnit').value === 'kg' ? 'kg' : 'lb',
      heightCm: number(field('onboardHeight').value, 178),
      experience: field('onboardExperience').value
    };
  }
  if (stepId === 'weekly-rhythm') {
    return {
      dailySteps: Math.round(number(field('onboardDailySteps').value, 10000)),
      mealsPerDay: Math.round(number(field('onboardMeals').value, 4)),
      freeMealsPerWeek: Math.round(number(field('onboardFreeMeals').value, 2))
    };
  }
  return { targets: targetsFor(activeEngine.getState().context.flowData || {}) };
}

function valid(stepId, data) {
  if (stepId === 'starting-point') return data.weight >= 40 && data.weight <= 1500
    && data.heightCm >= 100 && data.heightCm <= 250
    && ['new', 'returning', 'consistent'].includes(data.experience);
  if (stepId === 'weekly-rhythm') return data.dailySteps >= 1000 && data.dailySteps <= 50000
    && data.mealsPerDay >= 1 && data.mealsPerDay <= 8
    && data.freeMealsPerWeek >= 0 && data.freeMealsPerWeek <= 7;
  return true;
}

async function openTrainingOnboarding(profile, existing = null) {
  if (!['jt', 'lupe'].includes(profile)) return;
  if (activeEngine) await activeEngine.destroy();
  const initial = existing || {
    weight: '', unit: 'lb', heightCm: 178, experience: 'returning',
    dailySteps: 10000, mealsPerDay: 4, freeMealsPerWeek: 2
  };
  const dialog = field('onboardingDialog');
  field('onboardWeight').value = initial.weight || '';
  field('onboardUnit').value = initial.unit === 'kg' ? 'kg' : 'lb';
  field('onboardHeight').value = initial.heightCm || 178;
  field('onboardExperience').value = initial.experience || 'returning';
  field('onboardDailySteps').value = initial.dailySteps || 10000;
  field('onboardMeals').value = initial.mealsPerDay || 4;
  field('onboardFreeMeals').value = initial.freeMealsPerWeek ?? 2;

  activeEngine = new OnboardingEngine({
    flowId: `training-plan-${profile}`,
    flowName: 'Training plan setup',
    flowVersion: '1.0.0',
    steps,
    initialContext: { flowData: initial },
    loadData: () => {
      try { return JSON.parse(localStorage.getItem(draftKey(profile))) || null; } catch { return null; }
    },
    persistData: (context, currentStepId) => {
      localStorage.setItem(draftKey(profile), JSON.stringify({ flowData: context.flowData, currentStepId }));
    },
    clearPersistedData: () => localStorage.removeItem(draftKey(profile)),
    analytics: false,
    onFlowComplete: context => {
      localStorage.removeItem(draftKey(profile));
      dialog.close();
      const data = context.flowData;
      window.dispatchEvent(new CustomEvent('training-onboarding-complete', {
        detail: { profile, plan: {
          weight: data.weight, unit: data.unit, heightCm: data.heightCm, experience: data.experience,
          dailySteps: data.dailySteps, mealsPerDay: data.mealsPerDay,
          freeMealsPerWeek: data.freeMealsPerWeek, targets: targetsFor(data)
        } }
      }));
    }
  });
  activeEngine.addEventListener('stateChange', ({ state }) => paint(state));
  await activeEngine.ready();
  paint(activeEngine.getState());
  if (!dialog.open) dialog.showModal();
  field('onboardWeight').focus();
}

field('onboardNext').addEventListener('click', async () => {
  const state = activeEngine?.getState();
  if (!state?.currentStep) return;
  const data = stepData(String(state.currentStep.id));
  const error = field('onboardError');
  if (!valid(String(state.currentStep.id), data)) {
    error.textContent = 'Check the highlighted values.';
    return;
  }
  error.textContent = '';
  await activeEngine.next(data);
});
field('onboardBack').addEventListener('click', () => activeEngine?.previous());

window.openTrainingOnboarding = openTrainingOnboarding;
window.trainingOnboardingTargets = targetsFor;
window.trainingOnboardingReady = true;
window.dispatchEvent(new Event('training-onboarding-ready'));
