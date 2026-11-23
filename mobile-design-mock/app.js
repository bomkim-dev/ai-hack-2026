import { advanceCooking, quickCookingTurn, startCooking } from './demo-logic.js';
import { openConversation, supportsConversation } from './voice/conversation.js';
import { transcribe } from './voice/cooking-api.js';
import { playSpeech, playTimerChime, prepareSpeech } from './voice/speech-output.js';

const byId = id => document.getElementById(id);
const recipe = byId('recipe');
const cooking = byId('cooking');
const instruction = byId('instruction');
const feedback = byId('feedback');
const timer = byId('timer');
const timerLabel = byId('timer-label');
const timerNote = byId('timer-note');
const remaining = byId('remaining');
const mic = byId('mic-button');
const interrupt = byId('interrupt');
const utterance = byId('utterance');
const conversationHistory = byId('conversation-history');
const messages = byId('messages');
const typing = document.querySelector('[data-open="typing"]');

const examples = {
  boil: 'お湯が沸いた',
  add: 'パスタを入れた。7分',
  prepare: 'ベーコンを切った',
  fry: '炒めた。火を止めた',
  drain: '湯を切った',
  season: '味付けできた',
  serve: '盛り付けできた',
};

const voiceLabels = {
  idle: '会話を始める',
  starting: 'マイクを準備中',
  listening: '聞いています',
  transcribing: '文字起こし中',
  responding: '返答を考えています',
  speaking: '読み上げ中',
};

let current;
let deadline = 0;
let ticker;
let conversation;
let typedTurn;
let history = [];
let activeSpeech;
let timerPending = false;
const timerMessage = '茹で時間が終わりました。';

function rememberMessage(role, text) {
  history = [...history.slice(-7), { role, text: text.slice(0, 500) }];
}

function addMessage(author, text) {
  conversationHistory.hidden = false;
  const atLatest = messages.scrollHeight - messages.clientHeight - messages.scrollTop < 24;
  const item = document.createElement('li');
  const name = document.createElement('small');
  name.textContent = author;
  item.classList.toggle('user', author === 'あなた');
  item.append(name, text);
  messages.append(item);
  if (atLatest) messages.scrollTop = messages.scrollHeight;
  rememberMessage(author === 'あなた' ? 'user' : 'assistant', text);
}

function setFeedback(text) {
  feedback.textContent = text;
  feedback.hidden = !text;
}

function updateVoice(status, busy = false) {
  mic.setAttribute('aria-pressed', String(Boolean(conversation)));
  mic.dataset.state = status;
  byId('voice-status').textContent = voiceLabels[status];
  byId('voice-stop').hidden = !conversation;
  interrupt.hidden = !(conversation?.capture && ['speaking', 'responding', 'transcribing'].includes(status) && !current.done);
  typing.disabled = busy;
  mic.disabled = busy && !conversation;
}

function stopConversation(message) {
  if (!conversation) return;
  conversation.controller.abort();
  conversation = undefined;
  stopSpeech();
  updateVoice('idle');
  if (message) setFeedback(message);
}

function stopSpeech() {
  const speech = activeSpeech;
  activeSpeech = undefined;
  speech?.abort();
}

function startListening() {
  if (current.done) {
    stopConversation();
    return;
  }
  updateVoice('listening');
  conversation.capture.setListening(true);
}

function continueConversation() {
  if (activeSpeech || conversation?.turn || (conversation && !conversation.capture)) return;
  if (timerPending) {
    timerPending = false;
    speak(timerMessage);
  } else if (conversation) {
    startListening();
  }
}

function speak(message) {
  if (!message) return;
  stopSpeech();
  const speech = new AbortController();
  activeSpeech = speech;
  if (conversation) {
    conversation.capture?.setListening(false);
    updateVoice('speaking', true);
  }
  const finish = () => {
    if (activeSpeech !== speech) return;
    activeSpeech = undefined;
    continueConversation();
  };
  void playSpeech(message, speech.signal).then(finish, finish);
}

function clearTimer() {
  clearInterval(ticker);
  deadline = 0;
  timer.hidden = true;
  timerNote.hidden = true;
  timer.classList.remove('expired');
  timerPending = false;
}

function tick() {
  if (!deadline) return;
  const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  remaining.textContent = minutes + ':' + String(seconds % 60).padStart(2, '0');
  if (seconds > 0) return;

  clearInterval(ticker);
  deadline = 0;
  timer.classList.add('expired');
  timerLabel.textContent = '茹で時間終了';
  timerNote.hidden = false;
  rememberMessage('assistant', timerMessage);
  conversation?.capture?.setListening(false);
  playTimerChime();
  timerPending = true;
  continueConversation();
}

function render(result) {
  current = result;
  instruction.textContent = result.message;
  rememberMessage('assistant', result.message);
  utterance.placeholder = result.done ? '' : '例：' + examples[result.stepId];
  byId('voice-dock').hidden = Boolean(result.done);
  byId('finish-dock').hidden = !result.done;
  if (result.done) byId('finish').focus();
}

function presentTurn(text, { advance, timerSeconds, reply: response }) {
  setFeedback('');
  addMessage('あなた', text);
  const result = advance ? advanceCooking(current, timerSeconds) : current;
  if (advance && result.awaitingDuration) {
    current = result;
    if (!response) response = '袋に書いてある茹で時間を教えてください。';
    utterance.placeholder = '例：7分';
  }
  if (response) addMessage('ミミシェフ', response);
  if (!advance || result.awaitingDuration) return response;

  if (result.timerSeconds) {
    deadline = Date.now() + result.timerSeconds * 1000;
    timer.hidden = false;
    timerLabel.textContent = '茹で時間';
    tick();
    ticker = setInterval(tick, 250);
  } else if (current.stepId === 'drain' && result.stepId !== 'drain') {
    clearTimer();
  }
  render(result);
  return [response, result.message].filter(Boolean).join(' ');
}

async function respond(text, signal) {
  signal.throwIfAborted();
  const quick = quickCookingTurn(text, current.stepId, current.awaitingDuration);
  if (quick) return presentTurn(text, quick);

  const response = await fetch('/api/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      stepId: current.stepId,
      awaitingDuration: Boolean(current.awaitingDuration),
      remainingSeconds: timer.hidden ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
      history,
    }),
    signal,
  });
  const result = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok || !result) throw new Error(result?.error || '返答を受け取れませんでした。もう一度お試しください。');
  return presentTurn(text, result);
}

function returnToRecipe() {
  clearTimer();
  stopConversation();
  typedTurn?.abort();
  typedTurn = undefined;
  updateVoice('idle');
  stopSpeech();
  cooking.hidden = true;
  recipe.hidden = false;
  byId('start').focus();
  window.scrollTo(0, 0);
}

function beginCooking() {
  prepareSpeech();
  messages.replaceChildren();
  history = [];
  utterance.value = '';
  setFeedback('');
  conversationHistory.hidden = true;
  recipe.hidden = true;
  cooking.hidden = false;
  render(startCooking());
  byId('cooking-title').focus();
  window.scrollTo(0, 0);
}

async function startConversation(readOpening = false) {
  prepareSpeech();
  if (!supportsConversation()) {
    setFeedback('このブラウザでは会話モードを使えません。文字で入力できます。');
    return;
  }

  const session = { controller: new AbortController() };
  const { signal } = session.controller;
  conversation = session;
  setFeedback('');
  updateVoice('starting', true);
  try {
    const onTurn = async audio => {
      if (signal.aborted || activeSpeech || session.turn) return;
      const turn = new AbortController();
      session.turn = turn;
      const turnSignal = AbortSignal.any([signal, turn.signal]);
      updateVoice('transcribing', true);
      try {
        const text = await transcribe(audio, turnSignal);
        turnSignal.throwIfAborted();
        updateVoice('responding', true);
        const message = await respond(text, turnSignal);
        turnSignal.throwIfAborted();
        speak(message);
      } catch (error) {
        if (!turnSignal.aborted) stopConversation(error.message);
      } finally {
        if (session.turn === turn) {
          session.turn = undefined;
          continueConversation();
        }
      }
    };
    const onFailure = () => {
      if (!signal.aborted) stopConversation('マイクが切断されました。文字で入力できます。');
    };
    session.capture = await openConversation(signal, onTurn, onFailure);
    if (signal.aborted) return;
    if (readOpening) speak(current.message);
    else continueConversation();
  } catch (error) {
    if (signal.aborted) return;
    stopConversation(error.name === 'NotAllowedError'
      ? 'マイクが許可されていません。ブラウザの設定で許可するか、文字で入力してください。'
      : '会話モードを開始できませんでした。文字で入力できます。');
    continueConversation();
  }
}

function openTyping() {
  stopConversation();
  byId('typing').showModal();
  utterance.focus();
}

byId('start').addEventListener('click', () => {
  beginCooking();
  void startConversation(true);
});
byId('start-text').addEventListener('click', () => {
  beginCooking();
  openTyping();
});
mic.addEventListener('click', () => {
  if (conversation) {
    stopConversation();
    continueConversation();
  } else {
    void startConversation();
  }
});
interrupt.addEventListener('click', () => {
  if (!conversation?.capture || current.done) return;
  conversation.turn?.abort();
  conversation.turn = undefined;
  stopSpeech();
  startListening();
  mic.focus({ preventScroll: true });
});
byId('turn').addEventListener('submit', async event => {
  event.preventDefault();
  const text = utterance.value.trim();
  if (!text || typedTurn || current.done) return;
  byId('typing').close();
  const turn = new AbortController();
  typedTurn = turn;
  setFeedback('返答を考えています…');
  updateVoice('idle', true);
  try {
    await respond(text, turn.signal);
    utterance.value = '';
  } catch (error) {
    if (!turn.signal.aborted) setFeedback(error.message || '返答を受け取れませんでした。');
  } finally {
    if (typedTurn === turn) {
      typedTurn = undefined;
      updateVoice('idle');
    }
  }
});
byId('quit-cooking').addEventListener('click', () => {
  byId('quit').close();
  returnToRecipe();
});
byId('finish').addEventListener('click', returnToRecipe);
byId('cooking-home').addEventListener('click', returnToRecipe);

for (const button of document.querySelectorAll('[data-open]')) {
  button.addEventListener('click', () => {
    if (button.dataset.open === 'typing') openTyping();
    else byId(button.dataset.open).showModal();
  });
}
for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopConversation();
  tick();
});
window.addEventListener('pagehide', () => {
  clearTimer();
  stopConversation();
  stopSpeech();
  typedTurn?.abort();
});
