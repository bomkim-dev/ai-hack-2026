function durationLabel(seconds) {
  return seconds % 60 === 0 ? `${seconds / 60}分` : `${seconds}秒`;
}

export function confirmPastaTiming(utterance, pendingSeconds, maxSeconds) {
  const phrase = utterance.normalize('NFKC').trim().replace(/[。.!！]+$/u, '').trim();
  // Desktop dictation can occasionally prepend the literal "Enter" to a duration.
  const duration = phrase.match(/^(?:enter[\s、。:]+)?(\d+|七)\s*(分|秒)(?:\s*です)?$/iu);
  if (duration) {
    const amount = duration[1] === '七' ? 7 : Number(duration[1]);
    const seconds = amount * (duration[2] === '分' ? 60 : 1);
    if (Number.isSafeInteger(seconds) && seconds > 0 && seconds <= maxSeconds) {
      return { action: 'ask', seconds, message: `${durationLabel(seconds)}ですね。パスタはもう入れましたか？` };
    }
  }

  if (pendingSeconds == null) return null;
  if (/^(?:はい|うん|(?:パスタ(?:を|は)?)?(?:もう)?(?:入れた(?:よ)?|入れました))$/u.test(phrase)) {
    return { action: 'start', seconds: pendingSeconds };
  }
  if (/^(?:まだ(?:です|入れていません|入れてない)?|いいえ|入れていません|入れてない)$/u.test(phrase)) {
    return { action: 'wait', seconds: pendingSeconds, message: 'パスタを入れたら「入れた」と教えてください。' };
  }
  if (/^もう一(?:回|度)$/u.test(phrase)) {
    return { action: 'ask', seconds: pendingSeconds, message: `${durationLabel(pendingSeconds)}ですね。パスタはもう入れましたか？` };
  }
  return null;
}
