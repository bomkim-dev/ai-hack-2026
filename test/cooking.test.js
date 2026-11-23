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

test('a duration alone waits for confirmation and does not start the timer', async () => {
  const ready = await turn('お湯は沸いた。玉ねぎも切った', undefined, update(['boilWater', 'cutOnion']));
  const localTurn = (utterance, progress) => handleCookingTurn(
    { utterance, progress }, () => assert.fail('These follow-ups do not need Gemini'), () => demoTime,
  );
  const ask = await localTurn('Enter ７分.', ready.progress);
  assert.equal(ask.guidance, '7分ですね。パスタはもう入れましたか？');
  assert.equal(ask.progress.pendingPastaSeconds, 420);
  assert.equal(ask.timer, null);
  assert.deepEqual(ask.progress.completed, ready.progress.completed);

  const wait = await localTurn('まだ入れてない', ask.progress);
  assert.equal(wait.timer, null);
  assert.equal(wait.progress.pendingPastaSeconds, 420);

  const started = await localTurn('入れたよ。', wait.progress);
  assert.equal(started.timer.durationSeconds, 420);
  assert.equal(started.progress.pendingPastaSeconds, undefined);
  assert.equal(started.progress.currentStep, 'cutBacon');
});

test('only the missing duration is requested when pasta has already been added', async () => {
  const started = await turn('パスタを入れた', undefined, update(['addPasta']));
  assert.equal(started.progress.currentStep, 'askDuration');
  const duration = await handleCookingTurn(
    { utterance: '七分', progress: started.progress },
    () => assert.fail('A standalone duration does not need Gemini'),
    () => demoTime,
  );
  assert.equal(duration.timer.durationSeconds, 420);

  const boiled = advanceDemo('お湯は沸いた', startDemo({ method: 'standard', protein: 'bacon' }).state);
  const missing = advanceDemo('入れたよ', boiled.state);
  assert.match(missing.message, /茹で時間を教えて/);
  assert.equal(advanceDemo('もう一回', missing.state).message, missing.message);
  assert.equal(advanceDemo('七分', missing.state).timerSeconds, 420);
});

test('the demo confirms an ambiguous duration without timers or extra turns', () => {
  const boiled = advanceDemo('お湯は沸いた', startDemo({ method: 'standard', protein: 'bacon' }).state);
  const ask = advanceDemo('Enter 7分.', boiled.state);
  assert.match(ask.message, /パスタはもう入れましたか/);
  assert.equal(ask.timerSeconds, undefined);
  const wait = advanceDemo('まだ', ask.state);
  assert.equal(wait.timerSeconds, undefined);
  const confirmed = advanceDemo('入れたよ', wait.state);
  assert.equal(confirmed.timerSeconds, 420);
  assert.match(confirmed.message, /ベーコンを1cm幅/);
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
