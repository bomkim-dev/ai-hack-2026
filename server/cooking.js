import { confirmPastaTiming, interpretPastaExtension } from '../pasta-confirmation.js';
import { defaultRecipeId, getRecipe } from '../recipes.js';

export const maxTimerSeconds = 120 * 60;
const sharedGuides = {
  askDuration: '袋に書いてある茹で時間を教えてください。',
  waitForPasta: 'パスタのタイマーが鳴るまで待ちましょう。',
  finished: '完成です。おつかれさまでした。',
};

function guideFor(recipe, step) {
  return Object.hasOwn(sharedGuides, step) ? sharedGuides[step] : recipe.steps.find(item => item.id === step)?.guide;
}

function readRecipe(id = defaultRecipeId) {
  const recipe = getRecipe(id);
  if (!recipe) throw new CookingInputError('対応しているレシピを選んでください。');
  return recipe;
}

export class CookingInputError extends Error {}

function initialProgress(recipe) {
  return { recipeId: recipe.id, completed: [], currentStep: recipe.beforePasta[0], timerEndsAt: null };
}

function readProgress(progress, recipe) {
  if (progress === undefined) return initialProgress(recipe);

  const stepIds = new Set(recipe.steps.map(({ id }) => id));

  if (!progress || !Array.isArray(progress.completed)
      || !progress.completed.every(id => stepIds.has(id))
      || new Set(progress.completed).size !== progress.completed.length
      || typeof progress.currentStep !== 'string' || !guideFor(recipe, progress.currentStep)
      || (progress.pendingPastaSeconds !== undefined
        && (progress.currentStep !== 'addPasta' || progress.completed.includes('addPasta')
          || !Number.isSafeInteger(progress.pendingPastaSeconds) || progress.pendingPastaSeconds < 1
          || progress.pendingPastaSeconds > maxTimerSeconds))
      || (progress.awaitingExtraCookTime !== undefined
        && (progress.awaitingExtraCookTime !== true || progress.timerEndsAt === null
          || !progress.completed.includes('addPasta') || progress.completed.includes(recipe.finishBoiling)))
      || (progress.timerEndsAt !== null
        && (!Number.isSafeInteger(progress.timerEndsAt) || progress.timerEndsAt <= 0
          || !progress.completed.includes('addPasta') || progress.completed.includes(recipe.finishBoiling)))) {
    throw new CookingInputError('進捗には前回のレスポンスの progress を指定してください。');
  }

  return {
    recipeId: recipe.id,
    completed: progress.completed,
    currentStep: progress.currentStep,
    timerEndsAt: progress.timerEndsAt,
    ...(progress.pendingPastaSeconds !== undefined && { pendingPastaSeconds: progress.pendingPastaSeconds }),
    ...(progress.awaitingExtraCookTime && { awaitingExtraCookTime: true }),
  };
}

function nextStep(recipe, completed, timerEndsAt, now) {
  const has = id => completed.has(id);
  const firstMissing = ids => ids.find(id => !has(id));
  const pastaFinished = has(recipe.finishBoiling);

  if (has('addPasta') && !pastaFinished) {
    if (timerEndsAt === null) return 'askDuration';
    if (timerEndsAt <= now) return recipe.finishBoiling;
  }
  if (!has('addPasta') && !pastaFinished) {
    return firstMissing(recipe.beforePasta) ?? 'addPasta';
  }
  const toppingReady = recipe.duringPasta.length && has(recipe.duringPasta.at(-1));
  return (!toppingReady && firstMissing(recipe.duringPasta))
    || (!pastaFinished && 'waitForPasta')
    || firstMissing(recipe.afterPasta)
    || 'finished';
}

function reply(recipe, progress, guidance = guideFor(recipe, progress.currentStep), timer = null) {
  return { progress, guidance, timer, finished: progress.currentStep === 'finished' };
}

export function startCooking(recipeId) {
  const recipe = readRecipe(recipeId);
  return reply(recipe, initialProgress(recipe));
}

export async function handleCookingTurn(input, interpret, clock = Date.now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CookingInputError('JSON オブジェクトを指定してください。');
  }

  const recipe = readRecipe(input.progress?.recipeId);
  const progress = readProgress(input.progress, recipe);
  const receivedAt = clock();
  const completed = new Set(progress.completed);

  if (input.event === 'timerElapsed') {
    if (progress.timerEndsAt === null || receivedAt < progress.timerEndsAt || progress.currentStep === recipe.finishBoiling) {
      return reply(recipe, progress, null);
    }
    return reply(recipe, { ...progress, currentStep: nextStep(recipe, completed, progress.timerEndsAt, receivedAt) });
  }

  if (input.event !== undefined || typeof input.utterance !== 'string'
      || !input.utterance.trim() || input.utterance.length > 500) {
    throw new CookingInputError('発話テキストを１〜500文字で指定してください。');
  }

  const text = input.utterance.trim();
  const timerExpired = progress.timerEndsAt !== null && progress.timerEndsAt <= receivedAt;
  const extension = interpretPastaExtension(text, {
    timing: completed.has(recipe.finishBoiling) ? 'drained' : timerExpired ? 'expired' : null,
    awaitingDuration: progress.awaitingExtraCookTime,
    maxSeconds: maxTimerSeconds,
  });
  if (extension) {
    if (!extension.seconds) {
      const next = extension.awaitingDuration ? { ...progress, awaitingExtraCookTime: true } : progress;
      return reply(recipe, next, extension.message);
    }
    const endsAt = receivedAt + extension.seconds * 1000;
    return reply(recipe, {
      recipeId: recipe.id,
      completed: progress.completed,
      currentStep: nextStep(recipe, completed, endsAt, receivedAt),
      timerEndsAt: endsAt,
    }, extension.message, { action: 'start', durationSeconds: extension.seconds, endsAt });
  }
  const needsPastaConfirmation = progress.currentStep === 'addPasta';
  const confirmation = needsPastaConfirmation || progress.currentStep === 'askDuration'
    ? confirmPastaTiming(text, progress.pendingPastaSeconds, maxTimerSeconds)
    : null;
  if (needsPastaConfirmation && confirmation && confirmation.action !== 'start') {
    return reply(recipe, { ...progress, pendingPastaSeconds: confirmation.seconds }, confirmation.message);
  }

  const intent = confirmation
    ? { action: 'update', completed: ['addPasta'], pending: [], durationSeconds: confirmation.seconds }
    : await interpret(text, progress);
  if (intent.action === 'repeat') return reply(recipe, progress);
  if (intent.action === 'clarify'
      || intent.completed.some(id => intent.pending.includes(id))) {
    return reply(recipe, progress, `状況をもう一度教えてください。いまの案内は「${guideFor(recipe, progress.currentStep)}」です。`);
  }

  for (const id of intent.completed) completed.add(id);
  for (const id of intent.pending) completed.delete(id);

  let timerEndsAt = progress.timerEndsAt;
  let timer = null;
  const pastaIsCooking = completed.has('addPasta') && !completed.has(recipe.finishBoiling);
  if (!pastaIsCooking && timerEndsAt !== null) {
    timer = { action: 'cancel' };
    timerEndsAt = null;
  }
  const durationSeconds = intent.durationSeconds ?? progress.pendingPastaSeconds ?? null;
  if (pastaIsCooking && timerEndsAt === null && durationSeconds !== null) {
    timerEndsAt = receivedAt + durationSeconds * 1000;
    timer = { action: 'start', durationSeconds, endsAt: timerEndsAt };
  }

  const currentStep = nextStep(recipe, completed, timerEndsAt, clock());
  return reply(recipe, {
    ...(progress.awaitingExtraCookTime && pastaIsCooking && timerExpired && { awaitingExtraCookTime: true }),
    ...(currentStep === 'addPasta' && progress.pendingPastaSeconds !== undefined
      && { pendingPastaSeconds: progress.pendingPastaSeconds }),
    recipeId: recipe.id,
    completed: recipe.steps.filter(({ id }) => completed.has(id)).map(({ id }) => id),
    currentStep,
    timerEndsAt,
  }, undefined, timer);
}
