import { sendTurn, startSession } from './cooking-api.js';

function toUiResult({ progress, guidance, timer, finished }) {
  return { state: progress, message: guidance, timer, done: finished };
}

export async function startCooking({ signal } = {}) {
  return toUiResult(await startSession(signal));
}

export async function handleUtterance(text, state, signal) {
  return toUiResult(await sendTurn(state, { utterance: text }, signal));
}

export async function handleTimerElapsed(state, signal) {
  return toUiResult(await sendTurn(state, { event: 'timerElapsed' }, signal));
}
