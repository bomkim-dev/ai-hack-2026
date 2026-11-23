import { foods, equipment, takeCookingSelection, stageCookingSelection, stageCookingUsage } from './pantry-data.js';
import { transcribe } from './cooking-api.js';
import { recordAudio, supportsRecording } from './recording.js';
import { openConversation, supportsConversation } from './conversation.js';

const get = id => document.getElementById(id);
const start = get('start');
const form = get('voice-form');
const input = get('utterance');
const instruction = get('instruction');
const timer = get('boil-timer');
const timerStatus = get('timer-status');
const remaining = get('remaining');
const record = get('record');
const talk = get('conversation');
const talkStatus = get('conversation-status');
const voiceStatus = get('voice-status');
const submit = form.querySelector('button[type=submit]');
const lead = instruction.textContent;
const timerLead = timerStatus.textContent;
const demo = new URLSearchParams(location.search).get('demo') === '1';
const canRecord = !demo && supportsRecording();
const canTalk = !demo && supportsConversation();
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
let deadline;
let timerId;
let shownSeconds;
let finished = false;
let spokenInstruction = lead;
let operation;
let timerAnnouncement;
let queuedSpeech;
let stopRecording;
let timerDue = false;
let conversation;
let activeSpeech;

function speak(message, after) {
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance !== 'function') {
    after?.();
    return;
  }
  const speaking = Symbol('speech');
  activeSpeech = speaking;
  syncConversation();
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'ja-JP';
  const voice = speechSynthesis.getVoices().find(item => /^ja([-_]|$)/iu.test(item.lang));
  if (voice) utterance.voice = voice;
  const finishedSpeaking = () => {
    if (activeSpeech !== speaking) return;
    activeSpeech = undefined;
    after?.();
    syncConversation();
  };
  utterance.onend = finishedSpeaking;
  utterance.onerror = finishedSpeaking;
  speechSynthesis.speak(utterance);
}

function showInstruction(message) {
  instruction.textContent = message;
  spokenInstruction = message;
  if (!timerDue) speakGuidance(message);
}

function speakGuidance(message) {
  if (timerAnnouncement) {
    queuedSpeech = message;
    return;
  }
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
    timer.classList.add('is-expired');
    timerStatus.textContent = '時間になりました。パスタの茹で具合を確認してください。';
    timerDue = true;
    announceTimer();
  }
}

function announceTimer() {
  if (!timerDue || operation) return;
  timerDue = false;
  const speakAlert = message => {
    const announcement = Symbol('timer');
    timerAnnouncement = announcement;
    speak(message, () => {
      if (timerAnnouncement !== announcement) return;
      timerAnnouncement = undefined;
      const next = queuedSpeech;
      queuedSpeech = undefined;
      if (next) speakGuidance(next);
    });
  };
  if (demo) {
    speakAlert(timerStatus.textContent);
    return;
  }
  run(async signal => {
    try {
      const result = await logic.handleTimerElapsed(state, signal);
      signal.throwIfAborted();
      state = result.state;
      if (result.message) instruction.textContent = spokenInstruction = result.message;
      speakAlert('時間になりました。' + (result.message || spokenInstruction));
    } catch (error) {
      if (signal.aborted) return;
      speakAlert(timerStatus.textContent);
      throw error;
    }
  });
}

function startTimer(seconds, endsAt) {
  if (deadline !== undefined || !Number.isSafeInteger(seconds) || seconds < 1) return;
  timer.classList.remove('is-expired');
  const accelerated = demo && get('demo-timer').checked;
  deadline = endsAt ?? Date.now() + (accelerated ? Math.min(seconds, 10) : seconds) * 1000;
  timerStatus.textContent = accelerated ? 'デモ用タイマー（最長10秒）' : '計測中';
  updateTimer();
  if (deadline !== undefined) timerId = setInterval(updateTimer, 200);
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
  get('demo-timer-option').hidden = started || !demo;
  timer.hidden = !started;
  form.hidden = !started;
}

function applyResult(result) {
  if (!result || typeof result.message !== 'string' || !result.message.trim()) {
    throw new Error('Invalid cooking logic response');
  }
  state = result.state;
  if (result.timer?.action === 'cancel' && (deadline !== undefined || timerDue)) {
    stopTimer();
    timerDue = false;
    timer.classList.remove('is-expired');
    remaining.textContent = '--:--';
    timerStatus.textContent = '茹で時間の計測を終了しました。';
  }
  showInstruction(result.message);
  if (result.timer?.action === 'start') startTimer(result.timer.durationSeconds, result.timer.endsAt);
  if (demo && result.timerSeconds != null) startTimer(result.timerSeconds);
  if (!result.done) return;
  finished = true;
  stopConversation();
  if (selection) {
    try {
      stageCookingUsage(context);
      get('completion').hidden = false;
    } catch {
      get('recipe-source').textContent = '在庫の確認画面を準備できませんでした。';
    }
  }
}

function syncInput() {
  submit.disabled = Boolean(operation) || finished;
  record.disabled = Boolean(conversation) || (Boolean(operation) && !stopRecording) || finished;
  record.textContent = stopRecording ? '録音を止める' : '録音する';
  talk.disabled = !conversation && (Boolean(operation) || finished);
  syncConversation();
}

function syncConversation() {
  if (!conversation?.capture) return;
  const listening = !operation && !activeSpeech && !timerDue && !finished;
  conversation.capture.setListening(listening);
  talkStatus.textContent = listening ? '聞いています。' :
    activeSpeech ? '読み上げ中です。' : '次の案内を確認しています。';
}

function stopConversation({ cancelTurn = true, message = '' } = {}) {
  if (!conversation) return;
  conversation.controller.abort();
  if (cancelTurn && conversation.turn === operation) operation?.abort();
  conversation = undefined;
  talk.textContent = '会話を始める';
  talkStatus.textContent = message;
  syncInput();
}

function run(task) {
  if (operation) return;
  const pending = new AbortController();
  operation = pending;
  start.disabled = true;
  voiceStatus.textContent = '';
  syncInput();
  task(pending.signal, pending).catch(error => {
    if (!pending.signal.aborted) {
      if (conversation?.turn === pending) stopConversation({ cancelTurn: false });
      voiceStatus.textContent = error.message || '処理できませんでした。もう一度お試しください。';
      if (form.hidden) get('recipe-source').textContent = voiceStatus.textContent;
    }
  }).finally(() => {
    if (operation !== pending) return;
    operation = undefined;
    stopRecording = undefined;
    start.disabled = false;
    announceTimer();
    syncInput();
  });
}

start.addEventListener('click', () => run(async signal => {
  context = selection ? { ...selection, cookId: crypto.randomUUID() } : currentContext();
  get('recipe-source').textContent = demo ? '画面確認用のレシピです。' : 'レシピを準備しています…';
  const result = await logic.startCooking({ ...context, signal });
  signal.throwIfAborted();
  if (!demo) get('recipe-source').textContent = '';
  applyResult(result);
  setControls(true);
}));

async function submitUtterance(text, signal) {
  voiceStatus.textContent = '次の手順を確認中…';
  const result = await logic.handleUtterance(text, state, signal);
  signal.throwIfAborted();
  voiceStatus.textContent = '';
  if (result?.needsChat) {
    showInstruction('画面確認用デモです。現在の手順を続けてください。');
  } else {
    applyResult(result);
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || operation || finished) return;
  run(async signal => {
    await submitUtterance(text, signal);
    if (input.value.trim() === text) input.value = '';
  });
});

record.addEventListener('click', () => {
  if (stopRecording) {
    stopRecording();
    stopRecording = undefined;
    syncInput();
    return;
  }
  run(async signal => {
    voiceStatus.textContent = 'マイクを準備中…';
    const audio = await recordAudio(signal, stop => {
      timerAnnouncement = queuedSpeech = activeSpeech = undefined;
      window.speechSynthesis?.cancel();
      stopRecording = stop;
      voiceStatus.textContent = '録音中です。話し終わったら録音を止めてください。';
      syncInput();
    });
    stopRecording = undefined;
    syncInput();
    voiceStatus.textContent = 'Aqua Voice で文字起こし中…';
    const text = await transcribe(audio, signal);
    signal.throwIfAborted();
    input.value = text;
    await submitUtterance(text, signal);
  });
});

talk.addEventListener('click', async () => {
  if (conversation) {
    stopConversation();
    return;
  }

  const session = { controller: new AbortController() };
  conversation = session;
  talk.textContent = '会話を止める';
  talkStatus.textContent = 'マイクを準備しています。';
  syncInput();
  const onFailure = () => {
    if (conversation === session) stopConversation({ message: 'マイクを使えません。文字で入力できます。' });
  };
  try {
    const capture = await openConversation(session.controller.signal, audio => {
      if (conversation !== session || operation || activeSpeech || finished) return;
      run(async (signal, turn) => {
        session.turn = turn;
        voiceStatus.textContent = 'Aqua Voice で文字起こし中…';
        const text = await transcribe(audio, signal);
        signal.throwIfAborted();
        input.value = text;
        await submitUtterance(text, signal);
      });
    }, onFailure);
    if (conversation !== session) return;
    session.capture = capture;
    syncConversation();
  } catch {
    onFailure();
  }
});

get('repeat').addEventListener('click', () => {
  if (!stopRecording) showInstruction(spokenInstruction);
});
get('reset').addEventListener('click', () => {
  stopConversation();
  operation?.abort();
  operation = undefined;
  stopRecording = undefined;
  start.disabled = false;
  stopTimer();
  timerDue = false;
  timerAnnouncement = undefined;
  queuedSpeech = undefined;
  activeSpeech = undefined;
  window.speechSynthesis?.cancel();
  state = undefined;
  finished = false;
  input.value = '';
  voiceStatus.textContent = '';
  remaining.textContent = '--:--';
  timer.classList.remove('is-expired');
  timerStatus.textContent = timerLead;
  instruction.textContent = lead;
  spokenInstruction = lead;
  get('recipe-source').textContent = '';
  get('completion').hidden = true;
  syncInput();
  setControls(false);
  updateChoice();
  start.focus();
});
for (const id of ['protein', 'method']) get(id).addEventListener('change', updateChoice);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopConversation({ message: '画面が切り替わったため会話を停止しました。' });
  updateTimer();
});
window.addEventListener('pagehide', () => stopConversation());
window.addEventListener('pageshow', updateTimer);
setControls(false);
updateChoice();
record.hidden = !canRecord;
talk.hidden = !canTalk;
if (demo || !canRecord) get('input-help').textContent = '調理状況を文字で入力してください。';

try {
  logic = demo ? await import('./demo-logic.js') : await import('./cooking-logic.js');
  if (typeof logic.startCooking !== 'function' || typeof logic.handleUtterance !== 'function') {
    throw new Error('Unsupported cooking logic contract');
  }
  if (demo) {
    get('mode').textContent = '画面確認用デモ';
    get('mode').hidden = false;
  }
  if (!demo) {
    get('protein').querySelector('option[value=tuna]').disabled = true;
    get('method').querySelector('option[value=onePan]').disabled = true;
  }
  const unsupported = !demo && selection && (selection.protein !== 'bacon' || selection.method !== 'standard');
  if (unsupported) {
    get('recipe-source').textContent = 'この組み合わせは画面確認用デモで試せます。';
    const link = document.createElement('a');
    const url = new URL(location);
    url.searchParams.set('demo', '1');
    link.href = url;
    link.textContent = '画面確認用デモを開く';
    link.addEventListener('click', () => {
      stageCookingSelection({ ...selection, toolIds: selection.tools });
    });
    start.after(link);
  }
  start.disabled = Boolean(unsupported);
} catch {
  const link = document.createElement('a');
  const preview = new URL(location);
  preview.searchParams.set('demo', '1');
  link.href = preview;
  link.textContent = '画面確認用デモを開く';
  start.after(link);
  instruction.textContent = '調理モジュールは未接続です。画面確認用デモで試せます。';
}
