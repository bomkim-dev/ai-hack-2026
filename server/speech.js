import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { GeminiError, streamGuidance } from './gemini.js';

export async function sendSpeech(response, data) {
  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  if (!text || text.length > 600) throw new GeminiError('600文字以内の案内を送信してください。', 400);
  const controller = new AbortController();
  response.once('close', () => controller.abort());
  // The opening demo guide is a fixed Callirrhoe recording to avoid a cold TTS call.
  const audio = /^お湯を沸かしましょう。?$/u.test(text)
    ? [await readFile(new URL('../assets/demo-boil-water.pcm', import.meta.url))]
    : streamGuidance(text, { signal: controller.signal });
  for await (const chunk of audio) {
    if (!response.headersSent) {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
    }
    if (!response.write(chunk)) await once(response, 'drain', { signal: controller.signal });
  }
  response.end();
}
