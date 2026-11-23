export const defaultRecipeId = 'bacon-standard';

const cutOnion = { id: 'cutOnion', description: '玉ねぎを切った', guide: '玉ねぎを薄切りにしてください。' };
const addPasta = { id: 'addPasta', description: 'パスタをお湯に入れた', guide: 'パスタを入れてください。入れたら、袋の茹で時間も教えてください。' };
const plate = { id: 'plate', description: 'パスタを皿に盛り付けた', guide: 'お皿に盛り付けてください。' };

const recipes = [
  {
    id: defaultRecipeId,
    title: 'ベーコンと玉ねぎのパスタ',
    protein: 'bacon',
    method: 'standard',
    beforePasta: ['boilWater', 'cutOnion'],
    duringPasta: ['cutOnion', 'cutBacon', 'saute'],
    finishBoiling: 'drain',
    afterPasta: ['season', 'plate'],
    steps: [
      { id: 'boilWater', description: 'パスタ用のお湯が沸いた', guide: 'パスタ用のお湯を沸かしてください。' },
      cutOnion,
      addPasta,
      { id: 'cutBacon', description: 'ベーコンを切った', guide: 'パスタを茹でている間に、ベーコンを1cm幅に切りましょう。' },
      { id: 'saute', description: 'ベーコンと玉ねぎを炒め終えた。玉ねぎが透き通ったという報告も含む', guide: 'ベーコンと玉ねぎをオリーブ油で炒め、玉ねぎが透き通ったら火を止めてください。' },
      { id: 'drain', description: 'パスタの湯を切った', guide: 'パスタの茹で具合を確認し、よければ湯を切ってください。' },
      { id: 'season', description: 'パスタと具材を混ぜ、味付けを終えた', guide: 'パスタと具材を混ぜ、塩こしょうで味を整えてください。' },
      plate,
    ],
  },
  {
    id: 'tuna-one-pan',
    title: 'ツナ缶と玉ねぎのワンパンパスタ',
    protein: 'tuna',
    method: 'onePan',
    beforePasta: ['cutOnion', 'openTuna', 'sauteOnion', 'boilWater'],
    duringPasta: [],
    finishBoiling: 'finishOnePan',
    afterPasta: ['season', 'plate'],
    steps: [
      cutOnion,
      { id: 'openTuna', description: 'ツナ缶を開けて汁気を切った', guide: 'ツナ缶を開けて汁気を切ってください。' },
      { id: 'sauteOnion', description: '玉ねぎを炒め終えた、玉ねぎが透き通った', guide: '深めのフライパンにオリーブ油を入れ、中火で玉ねぎが透き通るまで炒めてください。' },
      { id: 'boilWater', description: 'フライパンに水を入れて沸かした。お湯が沸いた', guide: '同じフライパンに水500mlを加えて沸かしてください。' },
      addPasta,
      { id: 'finishOnePan', description: 'パスタの茹で具合を確認し火を止めた。湯切りはしない', guide: 'パスタを1本取って硬さを確認してください。よければ湯切りせずに火を止めてください。' },
      { id: 'season', description: 'ツナを加えて混ぜ、味付けした', guide: 'ツナを加えて混ぜ、塩こしょうで味を整えてください。' },
      plate,
    ],
  },
];

export function getRecipe(id) {
  return recipes.find(recipe => recipe.id === id);
}

export function recipeForChoice(protein, method) {
  return recipes.find(recipe => recipe.protein === protein && recipe.method === method);
}
