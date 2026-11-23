import { foods, equipment, takeCookingSelection, stageCookingUsage } from './pantry-data.js';
import { requestRecipe, requestCookingReply } from './cooking-api.js';

const get = id => document.getElementById(id);
const start = get('start');
const form = get('voice-form');
const input = get('utterance');
const instruction = get('instruction');
const timerStatus = get('timer-status');
const remaining = get('remaining');
const lead = instruction.textContent;
const timerLead = timerStatus.textContent;
const demo = new URLSearchParams(location.search).get('demo') === '1';
const pantryUrl = new URL('./pantry.html', location);
if (demo) pantryUrl.searchParams.set('demo', '1');
get('pantry-link').href = pantryUrl;
const finishUrl = new URL(pantryUrl);
finishUrl.hash = 'usage';
get('finish-link').href = finishUrl;

let selection = null;
try {
  selection = takeCookingSelection();
} catch {
  // A direct cooking session does not require browser storage.
}

let logic;
let context;
let state;
let recipe;
let stepId = null;
let deadline;
let timerId;
let shownSeconds;
let finished = false;
let spokenInstruction = lead;
let operation;
let timerAnnouncement;
let queuedSpeech;

function speak(message, after) {
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance !== 'function') {
    after?.();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'ja-JP';
  const voice = speechSynthesis.getVoices().find(item => /^ja([-_]|$)/iu.test(item.lang));
  if (voice) utterance.voice = voice;
  utterance.onend = after ?? null;
  utterance.onerror = after ?? null;
  speechSynthesis.speak(utterance);
}

function showInstruction(message) {
  instruction.textContent = message;
  spokenInstruction = message;
  speakGuidance(message);
}

function speakGuidance(message) {
  if (timerAnnouncement) {
    queuedSpeech = message;
    return;
  }
  window.speechSynthesis?.cancel();
  speak(message);
}

function stopTimer() {
  clearInterval(timerId);
  deadline = undefined;
}

function remainingSeconds() {
  return deadline === undefined ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

function updateTimer() {
  const seconds = remainingSeconds();
  if (seconds === null) return;
  if (seconds !== shownSeconds) {
    remaining.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    shownSeconds = seconds;
  }
  if (seconds === 0) {
    stopTimer();
    timerStatus.textContent = '時間になりました。パスタの茹で具合を確認してください。';
    window.speechSynthesis?.cancel();
    const announcement = Symbol('timer');
    timerAnnouncement = announcement;
    speak(timerStatus.textContent, () => {
      if (timerAnnouncement !== announcement) return;
      timerAnnouncement = undefined;
      const next = queuedSpeech;
      queuedSpeech = undefined;
      if (next) speakGuidance(next);
    });
  }
}

function startTimer(seconds) {
  if (deadline !== undefined || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600) return;
  const accelerated = get('demo-timer').checked;
  deadline = Date.now() + (accelerated ? Math.min(seconds, 10) : seconds) * 1000;
  timerStatus.textContent = accelerated ? 'デモ用タイマー（最長10秒）' : '計測中';
  updateTimer();
  timerId = setInterval(updateTimer, 200);
}

function currentContext() {
  if (selection) return selection;
  const protein = get('protein').value;
  const method = get('method').value;
  return {
    protein,
    method,
    ingredients: ['pasta', 'onion', protein].map(id => ({ id, amount: foods[id].amount })),
    tools: method === 'onePan' ? ['deepPan'] : ['pot', 'pan', 'strainer'],
  };
}

function renderRecipe(title, items) {
  get('recipe-name').textContent = title;
  const values = items.map(({ id, amount }) => [foods[id].name, `${amount} ${foods[id].unit}`]);
  get('recipe-ingredients').replaceChildren(...values.map(([label, amount]) => {
    const row = document.createElement('div');
    const name = document.createElement('dt');
    const value = document.createElement('dd');
    name.textContent = label;
    value.textContent = amount;
    row.append(name, value);
    return row;
  }));
}

function updateChoice() {
  const { protein, method, ingredients, tools } = currentContext();
  renderRecipe(`${foods[protein].name}と玉ねぎの${method === 'onePan' ? 'ワンパン' : ''}パスタ`, ingredients);
  get('gear-hint').textContent = `使う道具：${tools.map(id => equipment[id].name).join('・')}。包丁・まな板と火元も確認してください。`;
}

function setControls(started) {
  start.hidden = started;
  get('recipe-choice').hidden = started || Boolean(selection);
  get('demo-timer-option').hidden = started;
  form.hidden = !started;
}

function applyResult(result) {
  if (!result || typeof result.message !== 'string' || !result.message.trim()) {
    throw new Error('Invalid cooking logic response');
  }
  state = result.state;
  recipe = result.recipe ?? recipe;
  stepId = result.stepId ?? stepId;
  showInstruction(result.message);
  if (result.timerSeconds != null) startTimer(result.timerSeconds);
  if (!result.done) return;
  finished = true;
  if (selection) {
    try {
      stageCookingUsage(context, recipe?.ingredients ?? context.ingredients);
      get('completion').hidden = false;
    } catch {
      get('recipe-source').textContent = '在庫の確認画面を準備できませんでした。';
    }
  }
}

function run(task, errorMessage) {
  if (operation) return;
  const pending = new AbortController();
  operation = pending;
  start.disabled = true;
  form.querySelector('button[type=submit]').disabled = true;
  task(pending).catch(() => {
    if (!pending.signal.aborted) showInstruction(errorMessage);
  }).finally(() => {
    if (operation !== pending) return;
    operation = undefined;
    start.disabled = false;
    form.querySelector('button[type=submit]').disabled = false;
    if (!form.hidden) input.focus();
  });
}

start.addEventListener('click', () => run(async pending => {
  context = selection ? { ...selection, cookId: crypto.randomUUID() } : currentContext();
  recipe = null;
  get('recipe-source').textContent = demo ? '画面確認用のレシピです。' : 'レシピを準備しています…';
  if (!demo) {
    try {
      const { protein, method, ingredients, tools } = context;
      const plan = await requestRecipe({ protein, method, ingredients, tools }, pending.signal);
      recipe = plan.recipe;
      if (!recipe?.title || !Array.isArray(recipe.ingredients)) throw new Error('Invalid recipe');
      get('recipe-source').textContent = plan.source === 'openai' ? 'OpenAI で作成したレシピ' : '内蔵レシピを使用しています。';
    } catch {
      if (pending.signal.aborted) return;
      recipe = null;
      get('recipe-source').textContent = 'レシピを生成できなかったため、内蔵の手順を使います。';
    }
  }
  const result = await logic.startCooking({ ...context, recipe });
  if (pending.signal.aborted) return;
  if (recipe) renderRecipe(recipe.title, recipe.ingredients);
  applyResult(result);
  setControls(true);
}, '調理を開始できませんでした。もう一度お試しください。'));

form.addEventListener('submit', event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || operation || finished) return;
  input.value = '';
  run(async pending => {
    const result = await logic.handleUtterance(text, state);
    if (pending.signal.aborted) return;
    if (result?.needsChat) {
      if (demo) {
        showInstruction('画面確認用デモです。現在の手順を続けてください。');
        return;
      }
      try {
        const reply = await requestCookingReply({
          protein: context.protein, method: context.method, ingredients: context.ingredients, tools: context.tools,
          recipe, stepId, question: text, remainingSeconds: remainingSeconds(),
        }, pending.signal);
        if (!pending.signal.aborted) {
          instruction.textContent = reply;
          speakGuidance(reply);
        }
      } catch {
        if (!pending.signal.aborted) instruction.textContent = '今は質問に答えられません。現在の手順を続けてください。';
      }
      return;
    }
    applyResult(result);
  }, '処理できませんでした。もう一度お試しください。');
});

get('repeat').addEventListener('click', () => showInstruction(spokenInstruction));
get('reset').addEventListener('click', () => {
  operation?.abort();
  operation = undefined;
  start.disabled = false;
  form.querySelector('button[type=submit]').disabled = false;
  stopTimer();
  timerAnnouncement = undefined;
  queuedSpeech = undefined;
  window.speechSynthesis?.cancel();
  state = undefined;
  recipe = null;
  stepId = null;
  finished = false;
  input.value = '';
  remaining.textContent = '--:--';
  timerStatus.textContent = timerLead;
  instruction.textContent = lead;
  spokenInstruction = lead;
  get('recipe-source').textContent = '';
  get('completion').hidden = true;
  setControls(false);
  updateChoice();
  start.focus();
});
for (const id of ['protein', 'method']) get(id).addEventListener('change', updateChoice);
document.addEventListener('visibilitychange', updateTimer);
window.addEventListener('pageshow', updateTimer);
setControls(false);
updateChoice();

try {
  logic = demo ? await import('./demo-logic.js') : await import('./cooking-logic.js');
  if (typeof logic.startCooking !== 'function' || typeof logic.handleUtterance !== 'function') {
    throw new Error('Unsupported cooking logic contract');
  }
  if (demo) {
    get('mode').textContent = '画面確認用デモ';
    get('mode').hidden = false;
  }
  start.disabled = false;
} catch {
  const link = document.createElement('a');
  const preview = new URL(location);
  preview.searchParams.set('demo', '1');
  link.href = preview;
  link.textContent = '画面確認用デモを開く';
  start.after(link);
  instruction.textContent = '調理モジュールは未接続です。画面確認用デモで試せます。';
}
