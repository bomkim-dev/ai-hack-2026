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

export function interpretPastaExtension(utterance, { timing, awaitingDuration, maxSeconds }) {
  const text = utterance.normalize('NFKC').trim().replace(/[。.!！]+$/u, '').trim();
  const phrase = text.replace(/^まだ(?:硬|固|かた)い(?:です)?[、。,.]\s*/u, '');
  const explicit = phrase.match(/^(?:パスタを)?(?:あと|もう|さらに)\s*(\d+|[一二三四五六七八九十])\s*(分|秒)[、\s]*(?:だけ)?\s*(?:追加で)?(?:茹で|ゆで)(?:る|たい|ます|て(?:ください)?)(?:よ)?$/u);
  const prompted = awaitingDuration
    ? phrase.match(/^(?:(?:あと|もう)\s*)?(\d+|[一二三四五六七八九十])\s*(分|秒)(?:です)?$/u)
    : null;
  const duration = explicit ?? prompted;
  const asksForMore = /^(?:まだ(?:硬|固|かた)い(?:です)?|もう少し(?:茹で|ゆで)(?:る|たい|ます))$/u.test(phrase)
    || (awaitingDuration && /^もう一(?:回|度)$/u.test(phrase));
  if (!duration && !asksForMore) return null;

  if (timing === 'drained') return { message: '湯切りや味付けの後は、茹で時間を追加できません。' };
  if (timing !== 'expired') return { message: '追加の茹で時間は、タイマーが終わってから設定できます。' };

  if (duration) {
    const amount = /^\d+$/u.test(duration[1]) ? Number(duration[1]) : '〇一二三四五六七八九十'.indexOf(duration[1]);
    const seconds = amount * (duration[2] === '分' ? 60 : 1);
    if (Number.isSafeInteger(seconds) && seconds > 0 && seconds <= maxSeconds) {
      return { seconds, message: `あと${durationLabel(seconds)}、茹でましょう。` };
    }
  }
  return { awaitingDuration: true, message: 'あと何分茹でますか？' };
}
