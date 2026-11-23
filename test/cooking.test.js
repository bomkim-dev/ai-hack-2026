import assert from 'node:assert/strict';
import test from 'node:test';
import { handleCookingTurn, startCooking } from '../server/cooking.js';
import { startCooking as startDemo, handleUtterance as advanceDemo } from '../demo-logic.js';
import { GeminiError, interpretWithGemini } from '../server/gemini.js';

const demoTime = 1_800_000_000_000;

function update(completed = [], pending = [], durationSeconds = null) {
  return { action: 'update', completed, pending, durationSeconds };
}

function turn(utterance, progress, intent, now = demoTime) {
  return handleCookingTurn({ utterance, progress }, async () => intent, () => now);
}

test('a status report skips completed steps and leaves explicitly unfinished work open', async () => {
  const result = await turn('お湯は沸いた。玉ねぎは切った。ベーコンはまだ', undefined,
    update(['boilWater', 'cutOnion'], ['cutBacon']));
  assert.deepEqual(result.progress.completed, ['boilWater', 'cutOnion']);
  assert.equal(result.progress.currentStep, 'addPasta');
  assert.equal(result.timer, null);
});

test('pasta goes on a timer once and can cook while the user prepares the topping', async () => {
  const ready = await turn('お湯は沸いた。玉ねぎも切った', undefined, update(['boilWater', 'cutOnion']));
  const cooking = await turn('入れた。７分', ready.progress, update(['addPasta'], [], 420));
  assert.equal(cooking.progress.currentStep, 'cutBacon');
  assert.match(cooking.guidance, /ベーコンを1cm幅に切り/);
  assert.deepEqual(cooking.timer, { action: 'start', durationSeconds: 420, endsAt: demoTime + 420_000 });

  const repeat = await turn('もう一回', cooking.progress, { ...update(), action: 'repeat' });
  assert.equal(repeat.guidance, cooking.guidance);
  assert.equal(repeat.timer, null);

  const duplicate = await turn('パスタを入れた。７分', cooking.progress, update(['addPasta'], [], 420), demoTime + 1000);
  assert.equal(duplicate.progress.timerEndsAt, cooking.progress.timerEndsAt);
  assert.equal(duplicate.timer, null);
});

test('the demo names the ingredient and how to prepare it', () => {
  const start = startDemo({ method: 'standard', protein: 'bacon' });
  const boiled = advanceDemo('お湯は沸いた', start.state);
  const bacon = advanceDemo('パスタを入れた。7分', boiled.state);
  assert.match(bacon.message, /ベーコンを1cm幅に切り/);
  assert.equal(bacon.timerSeconds, 420);

  const tuna = startDemo({ method: 'onePan', protein: 'tuna' });
  assert.match(tuna.message, /玉ねぎを薄切り.*ツナ缶を開けて汁気を切り/);
});

test('an elapsed timer guides the user to drain the pasta and the recipe can finish', async () => {
  const prepared = await turn('お湯を沸かして具材も炒めた。パスタを入れた。７分', undefined,
    update(['boilWater', 'cutOnion', 'cutBacon', 'saute', 'addPasta'], [], 420));
  assert.equal(prepared.progress.currentStep, 'waitForPasta');
  const expired = await handleCookingTurn(
    { event: 'timerElapsed', progress: prepared.progress },
    () => assert.fail('Timer events do not need Gemini'),
    () => demoTime + 420_000,
  );
  assert.equal(expired.progress.currentStep, 'drain');
  const drained = await turn('湯を切った', expired.progress, update(['drain']), demoTime + 421_000);
  assert.equal(drained.progress.currentStep, 'season');
  assert.deepEqual(drained.timer, { action: 'cancel' });
  const seasoned = await turn('味付けできた', drained.progress, update(['season']), demoTime + 422_000);
  const plated = await turn('盛り付けた', seasoned.progress, update(['plate']), demoTime + 423_000);
  assert.equal(plated.finished, true);
});

test('a missing cooking duration is requested and an unclear statement preserves progress', async () => {
  const start = startCooking();
  const unclear = await turn('あの、えっと', start.progress, { ...update(), action: 'clarify' });
  assert.deepEqual(unclear.progress, start.progress);
  assert.match(unclear.guidance, /もう一度/);
  const cooking = await turn('パスタを入れた', undefined, update(['addPasta']));
  assert.equal(cooking.progress.currentStep, 'askDuration');
  assert.equal(cooking.timer, null);
  const duration = await turn('７分', cooking.progress, update([], [], 420));
  assert.equal(duration.timer.durationSeconds, 420);
});

test('the Gemini adapter requests structured data and rejects out-of-recipe IDs', async () => {
  const progress = startCooking().progress;
  const fakeFetch = intent => async (url, request) => {
    const body = JSON.parse(request.body);
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(JSON.parse(body.contents[0].parts[0].text).utterance, 'お湯は沸いた');
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(intent) }] } }] });
  };
  const result = await interpretWithGemini('お湯は沸いた', progress, { apiKey: 'test', fetcher: fakeFetch(update(['boilWater'])) });
  assert.deepEqual(result.completed, ['boilWater']);
  await assert.rejects(
    interpretWithGemini('お湯は沸いた', progress, { apiKey: 'test', fetcher: fakeFetch(update(['unknown'])) }),
    GeminiError,
  );
});
