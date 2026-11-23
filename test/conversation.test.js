import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTurnDetector, encodeWave } from '../conversation.js';

const sampleRate = 16_000;
const frame = level => new Float32Array(400).fill(level);
const add = (detector, count, level) =>
  Array.from({ length: count }, () => detector(frame(level))).filter(Boolean);

test('quiet, calibrated steady noise and a short bump do not produce a turn', () => {
  const detector = createTurnDetector(sampleRate, 150);
  assert.equal(add(detector, 46, 0.012).length, 0);
  assert.equal(add(detector, 2, 0.12).length, 0);
  assert.equal(add(detector, 45, 0.012).length, 0);
});

test('a pause inside a phrase does not send, and trailing silence sends once', () => {
  const detector = createTurnDetector(sampleRate);
  assert.equal(add(detector, 10, 0.001).length, 0);
  assert.equal(add(detector, 8, 0.07).length, 0);
  assert.equal(add(detector, 16, 0.001).length, 0);
  assert.equal(add(detector, 8, 0.08).length, 0);
  const [turn, duplicate] = add(detector, 45, 0.001);
  assert.ok(turn);
  assert.equal(duplicate, undefined);
  assert.equal(turn[0][0], frame(0.001)[0]);
  assert.ok(turn.some(samples => samples[0] === frame(0.08)[0]));
});

test('a continuous turn has a bounded length', () => {
  const detector = createTurnDetector(sampleRate);
  const [turn, duplicate] = add(detector, 500, 0.08);
  assert.ok(turn);
  assert.equal(duplicate, undefined);
  assert.ok(turn.length * 25 < 12_200);
});

test('each utterance is encoded as a mono 16-bit PCM WAV', async () => {
  const wave = encodeWave([new Float32Array([-1, 0, 1])], sampleRate);
  assert.equal(wave.type, 'audio/wav');
  const data = await wave.arrayBuffer();
  const view = new DataView(data);
  assert.equal(new TextDecoder().decode(data.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), sampleRate);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(48, true), 32767);
});
