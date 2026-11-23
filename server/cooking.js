import { confirmPastaTiming } from '../pasta-confirmation.js';

const steps = [
  { id: 'boilWater', description: 'パスタ用のお湯が沸いた', guide: 'パスタ用のお湯を沸かしてください。' },
  { id: 'cutOnion', description: '玉ねぎを切った', guide: '玉ねぎを薄切りにしてください。' },
  { id: 'addPasta', description: 'パスタをお湯に入れた', guide: 'パスタを入れてください。入れたら、袋の茹で時間も教えてください。' },
  { id: 'cutBacon', description: 'ベーコンを切った', guide: 'パスタを茹でている間に、ベーコンを1cm幅に切りましょう。' },
  { id: 'saute', description: 'ベーコンと玉ねぎを炒め終えた。玉ねぎが透き通ったという報告も含む', guide: 'ベーコンと玉ねぎをオリーブ油で炒め、玉ねぎが透き通ったら火を止めてください。' },
  { id: 'drain', description: 'パスタの湯を切った', guide: 'パスタの茹で具合を確認し、よければ湯を切ってください。' },
  { id: 'season', description: 'パスタと具材を混ぜ、味付けを終えた', guide: 'パスタと具材を混ぜ、塩こしょうで味を整えてください。' },
  { id: 'plate', description: 'パスタを皿に盛り付けた', guide: 'お皿に盛り付けてください。' },
];

export const recipeSteps = steps.map(({ id, description }) => ({ id, description }));
export const maxTimerSeconds = 120 * 60;
const stepIds = new Set(steps.map(({ id }) => id));
const guides = new Map(steps.map(({ id, guide }) => [id, guide]));
guides.set('askDuration', '袋に書いてある茹で時間を教えてください。');
guides.set('waitForPasta', 'パスタのタイマーが鳴るまで待ちましょう。');
guides.set('finished', '完成です。おつかれさまでした。');

export class CookingInputError extends Error {}

function initialProgress() {
  return { completed: [], currentStep: 'boilWater', timerEndsAt: null };
}

function readProgress(progress) {
  if (progress === undefined) return initialProgress();

  if (!progress || !Array.isArray(progress.completed)
      || !progress.completed.every(id => stepIds.has(id))
      || new Set(progress.completed).size !== progress.completed.length
      || !guides.has(progress.currentStep)
      || (progress.pendingPastaSeconds !== undefined
        && (progress.currentStep !== 'addPasta' || progress.completed.includes('addPasta')
          || !Number.isSafeInteger(progress.pendingPastaSeconds) || progress.pendingPastaSeconds < 1
          || progress.pendingPastaSeconds > maxTimerSeconds))
      || (progress.timerEndsAt !== null
        && (!Number.isSafeInteger(progress.timerEndsAt) || progress.timerEndsAt <= 0
          || !progress.completed.includes('addPasta') || progress.completed.includes('drain')))) {
    throw new CookingInputError('進捗には前回のレスポンスの progress を指定してください。');
  }

  return {
    completed: progress.completed,
    currentStep: progress.currentStep,
    timerEndsAt: progress.timerEndsAt,
    ...(progress.pendingPastaSeconds !== undefined && { pendingPastaSeconds: progress.pendingPastaSeconds }),
  };
}

function nextStep(completed, timerEndsAt, now) {
  const has = id => completed.has(id);

  if (has('addPasta') && !has('drain')) {
    if (timerEndsAt === null) return 'askDuration';
    if (timerEndsAt <= now) return 'drain';
  }
  if (!has('addPasta') && !has('drain')) {
    if (!has('boilWater')) return 'boilWater';
    if (!has('cutOnion')) return 'cutOnion';
    return 'addPasta';
  }
  if (!has('cutOnion') && !has('saute')) return 'cutOnion';
  if (!has('cutBacon') && !has('saute')) return 'cutBacon';
  if (!has('saute')) return 'saute';
  if (!has('drain')) return 'waitForPasta';
  if (!has('season')) return 'season';
  if (!has('plate')) return 'plate';
  return 'finished';
}

function reply(progress, guidance = guides.get(progress.currentStep), timer = null) {
  return { progress, guidance, timer, finished: progress.currentStep === 'finished' };
}

export function startCooking() {
  return reply(initialProgress());
}

export async function handleCookingTurn(input, interpret, clock = Date.now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CookingInputError('JSON オブジェクトを指定してください。');
  }

  const progress = readProgress(input.progress);
  const receivedAt = clock();
  const completed = new Set(progress.completed);

  if (input.event === 'timerElapsed') {
    if (progress.timerEndsAt === null || receivedAt < progress.timerEndsAt || progress.currentStep === 'drain') {
      return reply(progress, null);
    }
    return reply({ ...progress, currentStep: nextStep(completed, progress.timerEndsAt, receivedAt) });
  }

  if (input.event !== undefined || typeof input.utterance !== 'string'
      || !input.utterance.trim() || input.utterance.length > 500) {
    throw new CookingInputError('発話テキストを１〜500文字で指定してください。');
  }

  const text = input.utterance.trim();
  const needsPastaConfirmation = progress.currentStep === 'addPasta';
  const confirmation = needsPastaConfirmation || progress.currentStep === 'askDuration'
    ? confirmPastaTiming(text, progress.pendingPastaSeconds, maxTimerSeconds)
    : null;
  if (needsPastaConfirmation && confirmation && confirmation.action !== 'start') {
    return reply({ ...progress, pendingPastaSeconds: confirmation.seconds }, confirmation.message);
  }

  const intent = confirmation
    ? { action: 'update', completed: ['addPasta'], pending: [], durationSeconds: confirmation.seconds }
    : await interpret(text, progress);
  if (intent.action === 'repeat') return reply(progress);
  if (intent.action === 'clarify'
      || intent.completed.some(id => intent.pending.includes(id))) {
    return reply(progress, `状況をもう一度教えてください。いまの案内は「${guides.get(progress.currentStep)}」です。`);
  }

  for (const id of intent.completed) completed.add(id);
  for (const id of intent.pending) completed.delete(id);

  let timerEndsAt = progress.timerEndsAt;
  let timer = null;
  const pastaIsCooking = completed.has('addPasta') && !completed.has('drain');
  if (!pastaIsCooking && timerEndsAt !== null) {
    timer = { action: 'cancel' };
    timerEndsAt = null;
  }
  const durationSeconds = intent.durationSeconds ?? progress.pendingPastaSeconds ?? null;
  if (pastaIsCooking && timerEndsAt === null && durationSeconds !== null) {
    timerEndsAt = receivedAt + durationSeconds * 1000;
    timer = { action: 'start', durationSeconds, endsAt: timerEndsAt };
  }

  const currentStep = nextStep(completed, timerEndsAt, clock());
  return reply({
    ...(currentStep === 'addPasta' && progress.pendingPastaSeconds !== undefined
      && { pendingPastaSeconds: progress.pendingPastaSeconds }),
    completed: steps.filter(({ id }) => completed.has(id)).map(({ id }) => id),
    currentStep,
    timerEndsAt,
  }, undefined, timer);
}
