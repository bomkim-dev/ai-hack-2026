import assert from 'node:assert/strict';
import test from 'node:test';
import { startCooking as startCookingInBrowser } from '../cooking-logic.js';
import { answerCookingQuestion } from '../cooking-help.js';
import {
  applyCookingUsage, loadPantry, pendingCookingUsage, recommend, savePantry,
  stageCookingSelection, stageCookingUsage, takeCookingSelection,
} from '../pantry-data.js';
import { recipeForChoice } from '../recipes.js';
import { CookingInputError, handleCookingTurn, startCooking } from '../server/cooking.js';
import { GeminiError, interpretWithGemini } from '../server/gemini.js';

const noon = 1_800_000_000_000;
const tunaRecipe = 'tuna-one-pan';
const pantry = {
  stock: {
    pasta: { mode: 'quantity', amount: 200 },
    onion: { mode: 'quantity', amount: 1 },
    tuna: { mode: 'quantity', amount: 2 },
    bacon: { mode: 'quantity', amount: 0 },
  },
  tools: { pot: 'absent', deepPan: 'present' },
  shopping: [],
  appliedCooks: [],
};

function fakeStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test('tuna one-pan flows from pantry recommendation to confirmed stock deduction', async () => {
  const local = fakeStorage();
  const session = fakeStorage();
  savePantry(pantry, local);
  const route = recommend(loadPantry(local));
  assert.equal(recipeForChoice(route.protein, route.method).id, tunaRecipe);
  assert.deepEqual(route.missingFood, []);
  assert.deepEqual(route.missingTools, []);
  stageCookingSelection(route, session);
  const selection = takeCookingSelection(session);
  assert.equal(takeCookingSelection(session), null);
  assert.deepEqual(selection.tools, ['deepPan']);

  let result = startCooking(recipeForChoice(selection.protein, selection.method).id);
  let now = noon;
  const report = async (utterance, completed, durationSeconds = null) => {
    result = await handleCookingTurn({ utterance, progress: result.progress },
      async () => ({ action: 'update', completed: [completed], pending: [], durationSeconds }), () => now);
  };
  assert.equal(result.progress.currentStep, 'cutOnion');
  await report('玉ねぎを切った', 'cutOnion');
  assert.equal(result.progress.currentStep, 'openTuna');
  await report('ツナ缶を開けて汁気を切った', 'openTuna');
  assert.equal(result.progress.currentStep, 'sauteOnion');
  assert.match(answerCookingQuestion('火加減は？', result.progress.currentStep, selection), /中火/);
  await report('玉ねぎが透き通った', 'sauteOnion');
  assert.match(result.guidance, /フライパンに水500ml/);
  await report('お湯が沸いた', 'boilWater');
  await report('パスタを入れた。7分', 'addPasta', 420);
  assert.equal(result.progress.currentStep, 'waitForPasta');
  assert.equal(result.timer.endsAt, noon + 420_000);
  assert.equal(pendingCookingUsage(session), null);

  now += 420_000;
  result = await handleCookingTurn({ event: 'timerElapsed', progress: result.progress },
    () => assert.fail('Timer expiry does not need Gemini'), () => now);
  assert.equal(result.progress.currentStep, 'finishOnePan');
  assert.match(result.guidance, /湯切りせずに火を止めて/);
  result = await handleCookingTurn({ utterance: 'あと1分茹でる', progress: result.progress },
    () => assert.fail('Extra cooking time does not need Gemini'), () => now);
  assert.equal(result.timer.durationSeconds, 60);
  now += 60_000;
  await report('茹で具合を確認して火を止めた', 'finishOnePan');
  assert.deepEqual(result.timer, { action: 'cancel' });
  await report('ツナを混ぜて味付けした', 'season');
  await report('盛り付けた', 'plate');
  assert.equal(result.finished, true);
  assert.ok(result.progress.completed.every(step => step !== 'drain' && step !== 'cutBacon'));

  stageCookingUsage(selection, selection.ingredients, session);
  const usage = pendingCookingUsage(session);
  assert.deepEqual(usage.ingredients.map(item => item.id), ['pasta', 'onion', 'tuna']);
  assert.equal(loadPantry(local).stock.tuna.amount, 2);
  assert.equal(applyCookingUsage(usage.selection, [{ id: 'tuna', amount: 1 }], local), 'updated');
  assert.equal(applyCookingUsage(usage.selection, [{ id: 'tuna', amount: 1 }], local), 'unchanged');
  assert.equal(loadPantry(local).stock.tuna.amount, 1);
  assert.equal(loadPantry(local).stock.bacon.amount, 0);
});

test('recipe selection reports the tools for the chosen route', () => {
  const allTools = { pot: 'present', pan: 'present', strainer: 'present', deepPan: 'present' };
  const eitherRecipe = { ...pantry, tools: allTools };
  assert.equal(recommend(eitherRecipe).method, 'onePan');
  assert.equal(recommend(eitherRecipe, { demo: true }).method, 'standard');
  const tunaWithoutPan = recommend({ ...pantry, tools: { ...allTools, deepPan: 'absent' } }, { recipeId: tunaRecipe });
  assert.deepEqual(tunaWithoutPan.missingTools, [{ id: 'deepPan', status: 'absent' }]);
  assert.equal(recommend(eitherRecipe, { recipeId: 'bacon-standard' }).protein, 'bacon');
});

test('the browser session starts with the selected recipe ID', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, '/api/cooking?recipe=tuna-one-pan');
    return Response.json(startCooking(tunaRecipe));
  });
  const result = await startCookingInBrowser({ protein: 'tuna', method: 'onePan' });
  assert.equal(result.state.recipeId, tunaRecipe);
  assert.equal(result.stepId, 'cutOnion');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('Gemini is restricted to steps from the selected recipe', async () => {
  const progress = startCooking(tunaRecipe).progress;
  const fakeFetch = id => async (_url, request) => {
    const body = JSON.parse(request.body);
    const ids = body.generationConfig.responseJsonSchema.properties.completed.items.enum;
    assert.ok(ids.includes('finishOnePan'));
    assert.ok(!ids.includes('drain'));
    assert.match(body.systemInstruction.parts[0].text, /ツナ缶と玉ねぎのワンパンパスタ/);
    const text = JSON.stringify({ action: 'update', completed: [id], pending: [], durationSeconds: null });
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
  };
  assert.deepEqual((await interpretWithGemini('ツナを準備した', progress, {
    apiKey: 'test', fetcher: fakeFetch('openTuna'),
  })).completed, ['openTuna']);
  await assert.rejects(
    interpretWithGemini('湯を切った', progress, { apiKey: 'test', fetcher: fakeFetch('drain') }), GeminiError,
  );
  await assert.rejects(handleCookingTurn({ utterance: 'できた', progress: {
    ...progress, completed: ['drain'],
  } }), CookingInputError);
  assert.throws(() => startCooking('unknown'), CookingInputError);
});

test('bacon progress saved without a recipe ID keeps using the default', async () => {
  const result = await handleCookingTurn({
    utterance: 'お湯は沸いた',
    progress: { completed: [], currentStep: 'boilWater', timerEndsAt: null },
  }, async () => ({ action: 'update', completed: ['boilWater'], pending: [], durationSeconds: null }));
  assert.equal(result.progress.recipeId, 'bacon-standard');
  assert.equal(result.progress.currentStep, 'cutOnion');
});
