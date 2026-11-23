import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { AquaError, transcribeAudio } from '../server/aqua.js';
import { GeminiError } from '../server/gemini.js';
import { sendSpeech } from '../server/speech.js';
import { GuideError, respondWithGemini } from './gemini-guide.js';

const files = new Map([
  ['/', ['./index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['./styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['./app.js', 'text/javascript; charset=utf-8']],
  ['/demo-logic.js', ['./demo-logic.js', 'text/javascript; charset=utf-8']],
  ['/pasta.jpg', ['./pasta.jpg', 'image/jpeg']],
  ['/assets/mimichef-icon.png', ['../assets/mimichef-icon.png', 'image/png']],
  ['/voice/conversation.js', ['../conversation.js', 'text/javascript; charset=utf-8']],
  ['/voice/voice-capture.js', ['../voice-capture.js', 'text/javascript; charset=utf-8']],
  ['/voice/cooking-api.js', ['../cooking-api.js', 'text/javascript; charset=utf-8']],
  ['/voice/speech-output.js', ['../speech-output.js', 'text/javascript; charset=utf-8']],
]);

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readWave(request) {
  if (request.headers['content-type']?.split(';', 1)[0].toLowerCase() !== 'audio/wav') {
    throw new AquaError('WAV形式の音声が必要です。', 415);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) throw new AquaError('録音が大きすぎます。', 413);
    chunks.push(chunk);
  }
  if (bytes <= 44) throw new AquaError('録音が空です。', 400);
  const data = Buffer.concat(chunks, bytes);
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') {
    throw new AquaError('WAV形式の音声が必要です。', 415);
  }
  return new Blob([data], { type: 'audio/wav' });
}

async function readTurn(request) {
  if (request.headers['content-type']?.split(';', 1)[0].toLowerCase() !== 'application/json') {
    throw new GuideError('JSON形式で送信してください。', 415);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 24 * 1024) throw new GuideError('発話データが大きすぎます。', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } catch {
    throw new GuideError('発話データを読み取れませんでした。', 400);
  }
}

try {
  loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const port = Number(process.env.MIMI_PREVIEW_PORT || 3135);
const server = createServer(async (request, response) => {
  try {
    const path = request.url.split('?', 1)[0];
    const file = files.get(path);
    if (file && request.method === 'GET') {
      const [name, type] = file;
      const data = await readFile(new URL(name, import.meta.url));
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(data);
      return;
    }
    if (['/api/transcribe', '/api/respond', '/api/speech'].includes(path) && request.method === 'POST') {
      const origin = request.headers.origin;
      const host = request.headers.host;
      if (!['127.0.0.1:' + port, 'localhost:' + port].includes(host) || (origin && origin !== 'http://' + host)) {
        request.resume();
        json(response, 403, { error: 'このプレビューから送信してください。' });
        return;
      }
      if (path === '/api/transcribe') {
        json(response, 200, { text: await transcribeAudio(await readWave(request)) });
      } else if (path === '/api/speech') {
        await sendSpeech(response, await readTurn(request));
      } else {
        const controller = new AbortController();
        response.once('close', () => controller.abort());
        const result = await respondWithGemini(await readTurn(request), { signal: controller.signal });
        json(response, 200, result);
      }
      return;
    }
    json(response, 404, { error: 'ページが見つかりません。' });
  } catch (error) {
    request.resume();
    if (response.destroyed) return;
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof AquaError || error instanceof GeminiError || error instanceof GuideError) {
      json(response, error.status, { error: error.message });
    } else {
      json(response, 500, { error: 'プレビューでエラーが発生しました。' });
    }
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('ミミシェフ http://127.0.0.1:' + server.address().port);
});
