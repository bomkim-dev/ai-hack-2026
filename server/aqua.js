export const audioExtensions = new Map([
  ['audio/webm', 'webm'],
  ['audio/mp4', 'm4a'],
  ['audio/ogg', 'ogg'],
  ['audio/wav', 'wav'],
]);

export class AquaError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export async function transcribeAudio(audio, { apiKey = process.env.AQUA_API_KEY, fetcher = fetch } = {}) {
  if (!apiKey?.trim()) {
    throw new AquaError('サーバーの AQUA_API_KEY を設定してください。', 503);
  }

  const form = new FormData();
  form.append('audio', audio, `recording.${audioExtensions.get(audio.type)}`);
  form.append('operation', 'dictate');
  form.append('language', 'ja');

  let response;
  try {
    response = await fetcher('https://api.aquavoice.com/v1/dictations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AquaError('Aqua Voice に接続できませんでした。少し待ってからお試しください。');
  }

  if (response.status === 429) {
    throw new AquaError('Aqua Voice の利用制限に達しました。少し待ってからお試しください。', 503);
  }
  if (!response.ok) {
    throw new AquaError(`Aqua Voice が録音を受け付けませんでした（HTTP ${response.status}）。`);
  }
  const data = await response.json().catch(() => null);
  if (typeof data?.text !== 'string') {
    throw new AquaError('Aqua Voice の文字起こし結果を読み取れませんでした。');
  }
  const text = data.text.trim();
  if (!text) throw new AquaError('声を聞き取れませんでした。もう一度録音してください。', 422);
  return text;
}
