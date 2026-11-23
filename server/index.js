import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { AquaError, audioExtensions, transcribeAudio } from './aqua.js';
import { CookingInputError, handleCookingTurn, startCooking } from './cooking.js';
import { GeminiError, interpretWithGemini, synthesizeGuidance } from './gemini.js';

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const publicFiles = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/assets/bacon-onion-pasta.jpg', ['assets/bacon-onion-pasta.jpg', 'image/jpeg']],
  ['/cooking-api.js', ['cooking-api.js', 'text/javascript']],
  ['/cooking-logic.js', ['cooking-logic.js', 'text/javascript']],
  ['/cooking-help.js', ['cooking-help.js', 'text/javascript']],
  ['/conversation.js', ['conversation.js', 'text/javascript']],
  ['/voice-capture.js', ['voice-capture.js', 'text/javascript']],
  ['/demo-logic.js', ['demo-logic.js', 'text/javascript']],
  ['/pasta-confirmation.js', ['pasta-confirmation.js', 'text/javascript']],
  ['/pantry.html', ['pantry.html', 'text/html']],
  ['/pantry.js', ['pantry.js', 'text/javascript']],
  ['/pantry-data.js', ['pantry-data.js', 'text/javascript']],
  ['/pantry.css', ['pantry.css', 'text/css']],
]);

function getContentType(request) {
  return request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw new RequestError(413, 'リクエストが大きすぎます。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function readJson(request) {
  if (getContentType(request) !== 'application/json') {
    throw new RequestError(415, 'Content-Type は application/json を指定してください。');
  }
  const body = await readBody(request, 8192);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new RequestError(400, '正しい JSON を送信してください。');
  }
}

async function readAudio(request) {
  const type = getContentType(request);
  if (!audioExtensions.has(type)) {
    throw new RequestError(415, 'WebM、M4A、Ogg、WAV のいずれかの録音を送信してください。');
  }
  const body = await readBody(request, 4 * 1024 * 1024);
  if (!body.length) throw new RequestError(400, '録音が空です。');
  return new Blob([body], { type });
}

const server = createServer(async (request, response) => {
  try {
    const path = request.url.split('?', 1)[0];
    const asset = publicFiles.get(path);
    if (asset && request.method === 'GET') {
      const [file, type] = asset;
      const content = await readFile(new URL(`../${file}`, import.meta.url));
      const contentType = type.startsWith('image/') ? type : `${type}; charset=utf-8`;
      response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      response.end(content);
      return;
    }
    if (path === '/api/speech') {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'POST を使用してください。' });
        return;
      }
      const data = await readJson(request);
      const text = typeof data?.text === 'string' ? data.text.trim() : '';
      if (!text || text.length > 600) throw new RequestError(400, '600文字以内の案内を送信してください。');
      const controller = new AbortController();
      response.once('close', () => controller.abort());
      const audio = await synthesizeGuidance(text, { signal: controller.signal });
      response.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' });
      response.end(audio);
      return;
    }
    if (path === '/api/transcribe') {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'POST を使用してください。' });
        return;
      }
      sendJson(response, 200, { text: await transcribeAudio(await readAudio(request)) });
      return;
    }
    if (path !== '/api/cooking') {
      sendJson(response, 404, { error: 'この API はありません。' });
      return;
    }
    if (request.method === 'GET') {
      sendJson(response, 200, startCooking());
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      sendJson(response, 405, { error: 'GET または POST を使用してください。' });
      return;
    }

    const input = await readJson(request);
    sendJson(response, 200, await handleCookingTurn(input, interpretWithGemini));
  } catch (error) {
    request.resume();
    if (response.destroyed) return;
    if (error instanceof RequestError || error instanceof GeminiError || error instanceof AquaError) {
      sendJson(response, error.status, { error: error.message });
    } else if (error instanceof CookingInputError) {
      sendJson(response, 400, { error: error.message });
    } else {
      sendJson(response, 500, { error: '調理ガイドでエラーが発生しました。' });
    }
  }
});

try {
  loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const port = Number(process.env.PORT || 3001);
server.listen(port, '127.0.0.1', () => {
  console.log(`Cooking guide: http://127.0.0.1:${server.address().port}`);
});
