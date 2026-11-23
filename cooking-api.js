async function request(path, { signal, ...options } = {}) {
  const timeout = AbortSignal.timeout(25_000);
  const response = await fetch(path, { ...options, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw new Error(result?.error || '調理サーバーに接続できませんでした。');
  }
  return result;
}

export function startSession(recipeId, signal) {
  const query = new URLSearchParams();
  if (recipeId) query.set('recipe', recipeId);
  return request(query.size ? `/api/cooking?${query}` : '/api/cooking', { signal });
}

export function sendTurn(state, data, signal) {
  return request('/api/cooking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, progress: state }),
    signal,
  });
}

export async function transcribe(audio, signal) {
  const { text } = await request('/api/transcribe', { method: 'POST', body: audio, signal });
  if (typeof text !== 'string' || !text.trim()) throw new Error('録音を文字起こしできませんでした。');
  return text;
}
