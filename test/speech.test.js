import assert from 'node:assert/strict';
import test from 'node:test';
import { GeminiError, synthesizeGuidance } from '../server/gemini.js';

const text = 'お湯を沸かしてください。';

test('Japanese guidance requests the Callirrhoe voice and returns Gemini WAV audio', async () => {
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0);
  wav.write('WAVE', 8);
  const result = await synthesizeGuidance(text, {
    apiKey: 'test-key',
    fetcher: async (url, options) => {
      assert.match(url, /\/v1beta\/interactions$/);
      const request = JSON.parse(options.body);
      assert.equal(request.input[0].content[0].text, text);
      assert.equal(request.model, 'gemini-3.8-flash-tts');
      assert.equal(request.generation_config.speech_config[0].voice, 'Callirrhoe');
      assert.equal(request.response_format.mime_type, 'audio/wav');
      return Response.json({
        steps: [{ content: [{ type: 'audio', data: wav.toString('base64') }] }],
      });
    },
  });
  assert.deepEqual(result, wav);
});

test('Gemini speech failures leave a recoverable error for the browser fallback', async () => {
  await assert.rejects(
    synthesizeGuidance(text, { apiKey: '', fetcher: () => assert.fail('Unexpected Gemini call') }),
    { status: 503 },
  );
  await assert.rejects(
    synthesizeGuidance(text, {
      apiKey: 'test-key',
      fetcher: async () => Response.json({ steps: [{ content: [] }] }),
    }),
    GeminiError,
  );
});
