const heatQuestion = /^(?:火加減(?:は|を教えて(?:ください)?)?|何火(?:ですか|で(?:すればいい(?:ですか)?|いい(?:ですか)?))?|火は(?:どのくらい|どれくらい)(?:ですか)?|[弱中強]火でいい(?:ですか)?)$/u;
const cutQuestion = /^(?:何(?:cm|センチ(?:メートル)?)(?:幅|ぐらい|くらい)?(?:(?:に)?切(?:る|りますか|れば(?:いい|よい)(?:ですか)?|ったらいい(?:ですか)?)|で(?:いい|よい)(?:ですか)?|くらいですか|ですか)?|(?:どのくらい|どれくらい)の大きさ(?:に切る|ですか)?|切り方(?:は|を教えて(?:ください)?)?|(?:どう|どうやって)切(?:る|ればいい(?:ですか)?))$/iu;
const readinessQuestion = /^(?:(?:できあがり|焼き加減|茹で加減|ゆで加減|仕上がり)(?:の目安)?(?:は|を教えて(?:ください)?)?|(?:どのくらい|どれくらい)(?:炒め|茹で|ゆで)(?:る|ますか)|(?:もう)?(?:火が通った|茹で上がった|ゆで上がった)(?:か|かな|ですか)?|(?:いつ|何分)(?:まで)?(?:炒め|茹で|ゆで)(?:る|ますか))$/u;

const saute = {
  heat: '中火です。玉ねぎが透き通ったら火を止めてください。',
  readiness: '時間より、玉ねぎが透き通ったかを目安にしてください。',
};
const boiling = {
  heat: '湯が軽く沸き続けるように火を調整してください。吹きこぼれそうなら少し弱めてください。',
  readiness: '袋の茹で時間を目安に、1本取り出して芯が硬すぎないか確かめてください。',
};
const byStep = {
  boilWater: { heat: '強火でお湯を沸かしてください。' },
  boil: { heat: '強火でお湯を沸かしてください。' },
  cutOnion: { cut: '玉ねぎは薄切りにしてください。' },
  openTuna: { cut: 'ツナ缶を開けて汁気を切ってください。' },
  cutBacon: { cut: 'ベーコンは1cm幅に切ってください。' },
  addPasta: boiling,
  add: boiling,
  askDuration: boiling,
  waitForPasta: boiling,
  saute: saute,
  sauteOnion: saute,
  fry: saute,
  drain: { readiness: boiling.readiness },
  finishOnePan: { heat: 'パスタの硬さを確かめ、よければ火を止めてください。', readiness: boiling.readiness },
};

export const baconCutInstruction = byStep.cutBacon.cut;

export function answerCookingQuestion(text, stepId, { protein, method } = {}) {
  const phrase = text.normalize('NFKC').replace(/[\s、。?!]/gu, '');
  const detail = byStep[stepId];

  if (heatQuestion.test(phrase)) {
    return detail?.heat ?? '今の手順には火加減の指定がありません。';
  }
  const subject = phrase.match(/^(ベーコン|玉ねぎ)[はを]?(?=何|ど|切り方)/u);
  if (cutQuestion.test(phrase.slice(subject?.[0].length ?? 0))) {
    if (subject?.[1] === 'ベーコン') return protein === 'tuna' ? null : baconCutInstruction;
    if (subject?.[1] === '玉ねぎ') return byStep.cutOnion.cut;
    if (stepId === 'prepare') {
      const topping = protein === 'tuna' ? 'ツナは缶を開けて汁気を切ってください。' : 'ベーコンは1cm幅に切ってください。';
      return method === 'onePan' ? '玉ねぎは薄切りにしてください。' + topping : topping;
    }
    return detail?.cut ?? '今の手順には切り方の指定がありません。';
  }
  if (readinessQuestion.test(phrase)) {
    if (stepId === 'season' && method === 'onePan') return boiling.readiness;
    return detail?.readiness ?? '今の手順には仕上がりの目安がありません。';
  }
  return null;
}
