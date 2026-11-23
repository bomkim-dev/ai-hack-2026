import { advanceCooking, quickCookingTurn, startCooking } from './demo-logic.js';
import { openConversation, supportsConversation } from './voice/conversation.js';
import { transcribe } from './voice/cooking-api.js';
import { playSpeech, playTimerChime, prepareSpeech } from './voice/speech-output.js';

const byId = id => document.getElementById(id);
const recipe = byId('recipe');
const cooking = byId('cooking');
const feedback = byId('feedback');
const timer = byId('timer');
const timerLabel = byId('timer-label');
const remaining = byId('remaining');
const mic = byId('mic-button');
const interrupt = byId('interrupt');
const utterance = byId('utterance');
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
let currentGuide;
let deadline = 0;
let ticker;
let conversation;
let typedTurn;
let history = [];
let activeSpeech;
let timerPending;
const speechQueue = [];
const timerMessage = '茹で時間が終わりました。';
const durationPrompt = '袋に書いてある茹で時間を教えてください。';
const waitForPasta = 'パスタはまだ茹でています。タイマーが鳴ったら、茹で具合を確認して湯を切ってください。';

function addMessage(role, text, followLatest = role === 'user') {
  if (!text) return '';
  const atLatest = messages.scrollHeight - messages.clientHeight - messages.scrollTop < 24;
  const item = document.createElement('li');
  const name = document.createElement('small');
  name.textContent = role === 'user' ? 'あなた' : 'ミミシェフ';
  item.className = role;
  item.append(name, text);
  messages.append(item);
  if (atLatest || followLatest) messages.scrollTop = messages.scrollHeight;
  history = [...history.slice(-7), { role, text: text.slice(0, 500) }];
  return text;
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
  speechQueue.length = 0;
  stopSpeech();
  updateVoice('idle');
  if (message) setFeedback(message);
}

function reportVoiceProblem(message, spokenMessage) {
  stopConversation(message === spokenMessage ? undefined : message);
  announce(spokenMessage);
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
  const message = timerPending ?? speechQueue.shift();
  timerPending = undefined;
  if (message) {
    playAnnouncement(message);
  } else if (conversation) {
    startListening();
  }
}

function readAloud(message) {
  if (!message) return;
  speechQueue.push(message);
  continueConversation();
}

function announce(message) {
  readAloud(addMessage('assistant', message));
}

function playAnnouncement(message) {
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
  timer.classList.remove('expired');
  timerPending = undefined;
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
  const relevantSpeech = speechQueue.map(message => message
    .replace(waitForPasta, '')
    .replace(/(?:\d+分(?:\d+秒)?|\d+秒)のタイマーを始めました。/u, '')
    .trim()).filter(Boolean);
  speechQueue.splice(0, speechQueue.length, ...relevantSpeech);
  if (current.stepId === 'drain') currentGuide = current.message;
  timerPending = addMessage('assistant', timerMessage + (current.stepId === 'drain'
    ? currentGuide : 'パスタの茹で具合を確認してください。'));
  conversation?.capture?.setListening(false);
  playTimerChime();
  continueConversation();
}

function render(result) {
  current = result;
  currentGuide = result.stepId === 'drain' && deadline ? waitForPasta : result.message;
  utterance.placeholder = result.done ? '' : '例：' + examples[result.stepId];
  byId('voice-dock').hidden = Boolean(result.done);
  byId('finish-dock').hidden = !result.done;
  if (result.done) byId('finish').focus();
}

function presentTurn({ advance, timerSeconds, reply: response }) {
  setFeedback('');
  const result = advance ? advanceCooking(current, timerSeconds) : current;
  if (advance && result.awaitingDuration) {
    current = result;
    currentGuide = durationPrompt;
    utterance.placeholder = '例：7分';
    const message = response?.includes(durationPrompt) ? response : [response, durationPrompt].filter(Boolean).join(' ');
    return addMessage('assistant', message);
  }
  if (!advance) return addMessage('assistant', response);

  let timerStarted;
  if (result.timerSeconds) {
    deadline = Date.now() + result.timerSeconds * 1000;
    timer.hidden = false;
    timerLabel.textContent = '茹で時間';
    tick();
    ticker = setInterval(tick, 250);
    const minutes = Math.floor(result.timerSeconds / 60);
    const seconds = result.timerSeconds % 60;
    const duration = (minutes ? `${minutes}分` : '') + (seconds ? `${seconds}秒` : '');
    timerStarted = `${duration}のタイマーを始めました。`;
  } else if (current.stepId === 'drain' && result.stepId !== 'drain') {
    clearTimer();
  }
  render(result);
  return addMessage('assistant', [response, timerStarted, currentGuide].filter(Boolean).join(' '), true);
}

async function respond(text, signal) {
  signal.throwIfAborted();
  const previousHistory = history;
  addMessage('user', text);
  const phrase = text.normalize('NFKC').trim().replace(/[。.!?]+$/u, '');
  if (/^(?:もう一(?:回|度)(?:お願い(?:します)?)?|今の手順(?:を|は)?(?:もう一(?:回|度)|教えて(?:ください)?)?)$/u.test(phrase)) {
    return presentTurn({ advance: false, reply: currentGuide });
  }
  const quick = quickCookingTurn(text, current.stepId, current.awaitingDuration);
  if (quick) return presentTurn(quick);

  const response = await fetch('/api/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      stepId: current.stepId,
      awaitingDuration: Boolean(current.awaitingDuration),
      remainingSeconds: timer.hidden ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
      history: previousHistory,
    }),
    signal,
  });
  const result = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok || !result) throw new Error(result?.error || '返答を受け取れませんでした。もう一度お試しください。');
  return presentTurn(result);
}

function returnToRecipe() {
  clearTimer();
  stopConversation();
  typedTurn?.abort();
  typedTurn = undefined;
  updateVoice('idle');
  speechQueue.length = 0;
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
  recipe.hidden = true;
  cooking.hidden = false;
  render(startCooking());
  addMessage('assistant', currentGuide);
  byId('cooking-title').focus();
  window.scrollTo(0, 0);
}

async function startConversation(readOpening = false) {
  prepareSpeech();
  if (!supportsConversation()) {
    const message = 'このブラウザでは会話モードを使えません。文字で入力できます。';
    announce(message);
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
      let transcribing = true;
      updateVoice('transcribing', true);
      try {
        const text = await transcribe(audio, turnSignal);
        turnSignal.throwIfAborted();
        transcribing = false;
        updateVoice('responding', true);
        const message = await respond(text, turnSignal);
        turnSignal.throwIfAborted();
        readAloud(message);
      } catch (error) {
        if (turnSignal.aborted) return;
        if (transcribing && error.status !== 422) {
          reportVoiceProblem(error.message, '音声入力を続けられません。文字で入力できます。');
        } else {
          setFeedback(error.message);
          announce(transcribing
            ? '聞き取れませんでした。もう一度話してください。'
            : '返答を受け取れませんでした。もう一度話してください。');
        }
      } finally {
        if (session.turn === turn) {
          session.turn = undefined;
          continueConversation();
        }
      }
    };
    const onFailure = () => {
      if (!signal.aborted) {
        const message = 'マイクが切断されました。文字で入力できます。';
        reportVoiceProblem(message, message);
      }
    };
    session.capture = await openConversation(signal, onTurn, onFailure);
    if (signal.aborted) return;
    if (readOpening) readAloud(currentGuide);
    else continueConversation();
  } catch (error) {
    if (signal.aborted) return;
    const message = error.name === 'NotAllowedError'
      ? 'マイクが許可されていません。ブラウザの設定で許可するか、文字で入力してください。'
      : '会話モードを開始できませんでした。文字で入力できます。';
    reportVoiceProblem(message, message);
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
  readAloud(currentGuide);
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
  speechQueue.length = 0;
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
    const message = await respond(text, turn.signal);
    turn.signal.throwIfAborted();
    readAloud(message);
    utterance.value = '';
  } catch (error) {
    if (!turn.signal.aborted) {
      setFeedback(error.message || '返答を受け取れませんでした。');
      announce('返答を受け取れませんでした。もう一度入力してください。');
    }
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
  speechQueue.length = 0;
  stopSpeech();
  typedTurn?.abort();
});
