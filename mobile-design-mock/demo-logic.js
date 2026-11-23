import { answerCookingQuestion, baconCutInstruction } from '../cooking-help.js';

const steps = [
  ['boil', 'お湯を沸かしましょう', 'パスタ用のお湯が沸いた', /^(?:パスタ用の)?お湯[がは][沸湧](?:いた|きました)$/u],
  ['add', '沸いたお湯にパスタを入れて、袋に書いてある茹で時間を教えてください。', 'パスタをお湯に入れた。袋に書いてある茹で時間も必要', /^(?:お湯に)?パスタを?入れ(?:た|ました)$/u],
  ['prepare', baconCutInstruction, 'ベーコンを切り終えた', /^ベーコンを?切(?:った|りました)$/u],
  ['fry', 'ベーコンと薄切りの玉ねぎを中火で炒め、玉ねぎが透き通ったら火を止めてください。', 'ベーコンと玉ねぎを炒め終えた', /^ベーコンと玉ねぎを炒め(?:た|ました)$/u],
  ['drain', '茹で具合を確認し、湯を切りましょう。', 'パスタの湯を切った', /^(?:パスタの)?お?湯を切(?:った|りました)$/u],
  ['season', '具材と混ぜ、味を整えましょう。', '具材を混ぜ、味付けを終えた', /^味付けが?(?:できた|できました|終わった|終わりました)$/u],
  ['serve', 'お皿に盛り付けましょう。', 'お皿に盛り付けた', /^(?:お?皿に)?盛り付け(?:た|ました|できた|できました)$/u],
];

export const stepDetails = Object.fromEntries(
  steps.map(([id, guidance, completion]) => [id, { guidance, completion }]),
);

export const maxTimerSeconds = 3600;

export function quickCookingTurn(text, stepId, awaitingDuration = false) {
  const phrase = text.normalize('NFKC').trim().replace(/[。.!]+$/u, '').trim();
  const stepPattern = steps.find(([id]) => id === stepId)?.[3];
  if (stepId === 'add') {
    const report = phrase.match(/^(?:お湯に)?パスタを?入れ(?:た|ました)(?:[、,。\s]+(.+))?$/u);
    const duration = (report?.[1] ?? (awaitingDuration ? phrase : '')).match(/^(\d+|七)\s*(分|秒)(?:です)?$/u);
    if (duration) {
      const seconds = (duration[1] === '七' ? 7 : Number(duration[1])) * (duration[2] === '分' ? 60 : 1);
      if (Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= maxTimerSeconds) {
        return { advance: true, timerSeconds: seconds, reply: '' };
      }
    }
  }
  if (stepPattern?.test(phrase)) return { advance: true, timerSeconds: null, reply: '' };

  const reply = answerCookingQuestion(phrase, stepId, { protein: 'bacon' });
  return reply ? { advance: false, timerSeconds: null, reply } : null;
}

export function explicitlyCompleted(text, stepId) {
  const pattern = steps.find(([id]) => id === stepId)?.[3];
  // A question mark is part of that sentence, so a question cannot match a report.
  const sentences = text.normalize('NFKC').split(/[。!\n]+/u).map(sentence => sentence.trim());
  const reported = sentences.findLastIndex(sentence => pattern?.test(sentence));
  return reported >= 0 && !sentences.slice(reported + 1).some(sentence => /^(まだ|訂正|違う|いや|と思った|間違)/u.test(sentence));
}

function turn(index) {
  const step = steps[index];
  return step
    ? { index, stepId: step[0], message: step[1] }
    : { index, done: true, message: '盛り付けまで完了しました。' };
}

export function startCooking() {
  return turn(0);
}

export function advanceCooking(current, timerSeconds) {
  if (current.done) return current;
  if (current.stepId !== 'add') return turn(current.index + 1);
  if (!Number.isInteger(timerSeconds) || timerSeconds < 1 || timerSeconds > maxTimerSeconds) {
    return { ...current, awaitingDuration: true };
  }
  return { ...turn(current.index + 1), timerSeconds };
}
