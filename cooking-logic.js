import { sendTurn, startSession } from './cooking-api.js';
import { recipeForChoice } from './recipes.js';

function toUiResult({ progress, guidance, timer, finished }) {
  return { state: progress, stepId: progress.currentStep, message: guidance, timer, done: finished };
}

export async function startCooking({ protein = 'bacon', method = 'standard', signal } = {}) {
  const recipe = recipeForChoice(protein, method);
  if (!recipe) throw new Error('対応しているレシピを選んでください。');
  return toUiResult(await startSession(recipe.id, signal));
}

export async function handleUtterance(text, state, signal) {
  return toUiResult(await sendTurn(state, { utterance: text }, signal));
}

export async function handleTimerElapsed(state, signal) {
  return toUiResult(await sendTurn(state, { event: 'timerElapsed' }, signal));
}
