import assert from 'node:assert/strict';
import test from 'node:test';
import { GeminiError, streamGuidance } from '../server/gemini.js';

const text = 'お湯を沸かしてください。';

test('Callirrhoe PCM is available before Gemini finishes the speech stream', async () => {
  const pcm = Buffer.from([0, 1, 2, 3]);
  const sse = 'data: ' + JSON.stringify({
    event_type: 'step.delta',
    delta: { type: 'audio', data: pcm.toString('base64') },
  }) + '\r\n\r\n';
  let upstream;
  const result = streamGuidance(text, {
    apiKey: 'test-key',
    fetcher: async (url, options) => {
      assert.match(url, /\/v1beta\/interactions$/);
      const request = JSON.parse(options.body);
      assert.equal(request.input[0].content[0].text, text);
      assert.equal(request.model, 'gemini-3.8-flash-tts');
      assert.equal(request.generation_config.speech_config[0].voice, 'Callirrhoe');
      assert.deepEqual(request.response_format, { type: 'audio', mime_type: 'audio/l16', sample_rate: 24_000 });
      assert.equal(request.stream, true);
      return new Response(new ReadableStream({ start(controller) { upstream = controller; } }));
    },
  });
  const first = result.next();
  try {
    const encoder = new TextEncoder();
    upstream.enqueue(encoder.encode(sse.slice(0, 19)));
    upstream.enqueue(encoder.encode(sse.slice(19)));
    assert.deepEqual(await first, { value: pcm, done: false });
    upstream.enqueue(encoder.encode('data: [DONE]\n\n'));
    upstream.close();
    assert.equal((await result.next()).done, true);
  } finally {
    await result.return();
  }
});

test('Gemini speech failures leave a recoverable error for the browser fallback', async () => {
  await assert.rejects(
    streamGuidance(text, { apiKey: '', fetcher: () => assert.fail('Unexpected Gemini call') }).next(),
    { status: 503 },
  );
  await assert.rejects(
    streamGuidance(text, {
      apiKey: 'test-key',
      fetcher: async () => new Response('data: [DONE]\n\n'),
    }).next(),
    GeminiError,
  );
});
