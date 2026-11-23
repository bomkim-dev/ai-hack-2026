import assert from 'node:assert/strict';
import test from 'node:test';
import { answerCookingQuestion } from '../cooking-help.js';
import { quickCookingTurn } from '../mobile-design-mock/demo-logic.js';
import { respondWithGemini } from '../mobile-design-mock/gemini-guide.js';

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

test('mobile guide answers natural cutting questions without progressing or calling Gemini', async () => {
  const result = await respondWithGemini({
    text: 'ベーコンは何センチに切ればいい？',
    stepId: 'prepare',
    awaitingDuration: false,
    history: [],
    remainingSeconds: 12,
  }, {
    apiKey: '',
    fetcher: () => assert.fail('This recipe question must not call Gemini'),
  });
  assert.deepEqual(result, {
    advance: false, timerSeconds: null, reply: 'ベーコンは1cm幅に切ってください。',
  });
  assert.match(quickCookingTurn('玉ねぎは何センチに切る？', 'prepare').reply, /玉ねぎ.*薄切り/);
});

test('mobile guide handles simple progress and timing without swallowing mixed turns', () => {
  assert.deepEqual(quickCookingTurn('パスタを入れた。７分。', 'add'), {
    advance: true, timerSeconds: 420, reply: '',
  });
  assert.equal(quickCookingTurn('７分', 'add'), null);
  assert.equal(quickCookingTurn('７分です', 'add', true).timerSeconds, 420);
  assert.equal(quickCookingTurn('７分でいい？', 'add', true), null);
  assert.equal(quickCookingTurn('パスタを入れた。７分でいい？', 'add'), null);
  assert.equal(quickCookingTurn('ベーコンを切った。次は中火？', 'prepare'), null);
  assert.equal(quickCookingTurn('ベーコン切った。', 'prepare').advance, true);
});
