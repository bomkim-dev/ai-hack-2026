import assert from 'node:assert/strict';
import test from 'node:test';
import { answerCookingQuestion } from '../cooking-help.js';

test('heat and readiness answers follow the active cooking step', () => {
  assert.match(answerCookingQuestion('火加減は？', 'boilWater'), /強火/);
  assert.match(answerCookingQuestion('何火ですか？', 'saute'), /中火.*透き通/);
  assert.match(answerCookingQuestion('どのくらい炒める？', 'fry'), /玉ねぎが透き通/);
  assert.match(answerCookingQuestion('もう茹で上がったかな？', 'drain'), /1本取り出して芯/);
  assert.match(answerCookingQuestion('茹で加減は？', 'season', { method: 'onePan' }), /1本取り出して芯/);
});

test('cutting questions distinguish bacon, onion and the tuna demo', () => {
  assert.match(answerCookingQuestion('何センチに切る？', 'cutBacon'), /ベーコン.*1cm幅/);
  assert.match(answerCookingQuestion('切り方を教えて', 'cutOnion'), /玉ねぎ.*薄切り/);
  assert.match(answerCookingQuestion('何ｃｍ幅？', 'prepare', { protein: 'tuna', method: 'onePan' }), /玉ねぎ.*薄切り.*ツナ.*汁気/);
  assert.match(answerCookingQuestion('火加減は？', 'plate'), /火加減の指定がありません/);
});

test('status updates, extra time, and timer questions are left to their handlers', () => {
  for (const text of ['ベーコン切った', '玉ねぎが透き通った', 'パスタを入れた。7分', 'あと1分茹でる', 'あと何分？']) {
    assert.equal(answerCookingQuestion(text, 'saute'), null, text);
  }
});
