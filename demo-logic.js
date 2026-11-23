import { confirmPastaTiming, interpretPastaExtension } from './pasta-confirmation.js';

// Local UI fixture. The real cooking module belongs to role B.
const standard = prepare => [
  ['boil', 'お湯を沸かしましょう。', /沸いた/u],
  ['add', '沸いたお湯にパスタを入れましょう。', /入れた/u],
  ['prepare', `パスタを茹でている間に、${prepare}ましょう。`, /切った|開けた|準備/u],
  ['fry', '具材を炒め、火を止めましょう。', /炒めた|火を止めた/u],
  ['drain', '茹で具合を確認し、湯を切りましょう。', /湯を切った/u],
  ['season', '具材と混ぜ、味を整えましょう。', /味付け|味を整/u],
  ['serve', 'お皿に盛り付けましょう。', /盛り付け|盛りつけ/u],
];
const onePan = prepare => [
  ['prepare', `玉ねぎを薄切りにして、${prepare}ましょう。`, /切った|開けた|準備/u],
  ['fry', '深めのフライパンで玉ねぎを炒め、具材を加えましょう。', /炒めた|具材を入れた/u],
  ['boil', '同じフライパンで水を沸かしましょう。', /沸いた/u],
  ['add', 'パスタを入れましょう。袋に書いてある茹で時間を教えてください。', /入れた/u],
  ['season', '茹で具合を確認し、火を止めて味を整えましょう。', /味付け|味を整/u],
  ['serve', 'お皿に盛り付けましょう。', /盛り付け|盛りつけ/u],
];

function turn(state) {
  const current = state.steps[state.index];
  if (!current) return { state, done: true, message: '盛り付けまで完了しました。' };
  const [stepId, message] = current;
  return { state, stepId, message: state.pastaAdded ? '袋に書いてある茹で時間を教えてください。' : message };
}

export function startCooking(context) {
  const prepare = context.protein === 'tuna'
    ? 'ツナ缶を開けて汁気を切り'
    : 'ベーコンを1cm幅に切り';
  const steps = context.method === 'onePan' ? onePan(prepare) : standard(prepare);
  return turn({ steps, index: 0 });
}

export function handleTimerElapsed(state) {
  return state.pastaTiming === 'running' ? { ...state, pastaTiming: 'expired' } : state;
}

export function handleUtterance(text, state) {
  const [id, , matches] = state.steps[state.index];
  const phrase = text.normalize('NFKC');
  const extension = interpretPastaExtension(phrase, {
    timing: state.pastaTiming,
    awaitingDuration: state.awaitingExtraCookTime,
    maxSeconds: 3600,
  });
  if (extension) {
    if (extension.seconds) {
      const next = { ...state, pastaTiming: 'running', awaitingExtraCookTime: false };
      return { ...turn(next), message: extension.message, timerSeconds: extension.seconds };
    }
    const next = extension.awaitingDuration ? { ...state, awaitingExtraCookTime: true } : state;
    return { ...turn(next), message: extension.message };
  }
  if (id === 'add') {
    const confirmation = confirmPastaTiming(phrase, state.pendingPastaSeconds, 3600);
    if (confirmation) {
      if (confirmation.action === 'start' || (state.pastaAdded && confirmation.action === 'ask')) {
        return { ...turn({ steps: state.steps, index: state.index + 1, pastaTiming: 'running' }), timerSeconds: confirmation.seconds };
      }
      return { ...turn({ ...state, pendingPastaSeconds: confirmation.seconds }), message: confirmation.message };
    }
  }
  if (/[?？]|けど|どうし|ですか|ますか/u.test(phrase)) return { needsChat: true };
  if (/もう一回|もう一度/u.test(phrase)) return turn(state);
  if (!matches.test(phrase) && !/^(?:できた|終わった)[。!]?$/u.test(phrase)) {
    return { ...turn(state), message: '今の手順ができたら、「できた」と伝えてください。' };
  }
  const index = state.index + 1;
  if (id === 'drain' || (id === 'season' && state.pastaTiming !== 'drained')) {
    const next = { ...state, index, pastaTiming: 'drained', awaitingExtraCookTime: false };
    return { ...turn(next), timer: { action: 'cancel' } };
  }
  if (id !== 'add') return turn({ ...state, index });
  const time = phrase.match(/(\d+)\s*(分|秒)/u);
  const timerSeconds = time ? Number(time[1]) * (time[2] === '分' ? 60 : 1)
    : /七分/u.test(phrase) ? 420 : state.pendingPastaSeconds;
  if (!timerSeconds || timerSeconds > 3600) {
    return turn({ ...state, pastaAdded: true });
  }
  return { ...turn({ steps: state.steps, index, pastaTiming: 'running' }), timerSeconds };
}
