import assert from 'node:assert/strict';
import test from 'node:test';
import { AquaError, transcribeAudio } from '../server/aqua.js';

const webm = new Blob(['test-audio'], { type: 'audio/webm' });

test('Aqua Voice receives a Japanese dictation request and returns only the transcript', async () => {
  const fetcher = async (url, request) => {
    assert.equal(url, 'https://api.aquavoice.com/v1/dictations');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, 'Bearer test-key');
    assert.equal(request.body.get('audio').name, 'recording.webm');
    assert.equal(request.body.get('language'), 'ja');
    assert.equal(request.body.get('operation'), 'dictate');
    return Response.json({ text: ' お湯は沸いた。 ' });
  };
  assert.equal(await transcribeAudio(webm, { apiKey: 'test-key', fetcher }), 'お湯は沸いた。');
});

test('empty dictation and rate limiting are reported without returning the provider payload', async () => {
  for (const [response, status] of [
    [Response.json({ text: ' ' }), 422],
    [Response.json({}, { status: 429 }), 503],
  ]) {
    await assert.rejects(
      transcribeAudio(webm, { apiKey: 'test-key', fetcher: async () => response }),
      error => error instanceof AquaError && error.status === status,
    );
  }
});
