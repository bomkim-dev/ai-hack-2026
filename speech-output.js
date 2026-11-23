let speechOutput;

export function prepareSpeech() {
  if (!window.AudioContext) return;
  try {
    speechOutput ??= new AudioContext();
    if (speechOutput.state !== 'running') speechOutput.resume().catch(() => {});
  } catch {
    // Browser speech remains available if Web Audio cannot start.
  }
}

export function playTimerChime() {
  if (speechOutput?.state !== 'running') return;
  const tone = speechOutput.createOscillator();
  const gain = speechOutput.createGain();
  const start = speechOutput.currentTime;
  tone.frequency.value = 784;
  gain.gain.setValueAtTime(0.12, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
  tone.connect(gain).connect(speechOutput.destination);
  tone.onended = () => {
    tone.disconnect();
    gain.disconnect();
  };
  tone.start(start);
  tone.stop(start + 0.24);
}

async function playGeneratedSpeech(text, signal) {
  if (speechOutput?.state !== 'running') throw new Error('Web Audio unavailable');
  const response = await fetch('/api/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(26_000)]),
  });
  if (!response.ok || !response.body) throw new Error('Speech generation unavailable');

  const sources = new Set();
  const stopPlayback = () => {
    for (const source of sources) source.stop();
  };
  signal.addEventListener('abort', stopPlayback, { once: true });
  let nextStart = 0;
  let trailingByte;
  let lastPlayback;
  try {
    for await (let chunk of response.body) {
      signal.throwIfAborted();
      if (trailingByte !== undefined) {
        const aligned = new Uint8Array(chunk.length + 1);
        aligned[0] = trailingByte;
        aligned.set(chunk, 1);
        chunk = aligned;
      }
      const sampleCount = Math.floor(chunk.length / 2);
      trailingByte = chunk[sampleCount * 2];
      if (!sampleCount) continue;

      const buffer = speechOutput.createBuffer(1, sampleCount, 24_000);
      const samples = buffer.getChannelData(0);
      const pcm = new DataView(chunk.buffer, chunk.byteOffset, sampleCount * 2);
      for (let index = 0; index < sampleCount; index++) {
        samples[index] = pcm.getInt16(index * 2, true) / 32768;
      }
      const source = speechOutput.createBufferSource();
      source.buffer = buffer;
      source.connect(speechOutput.destination);
      const now = speechOutput.currentTime;
      const start = nextStart > now ? nextStart : now + 0.08;
      source.start(start);
      nextStart = start + buffer.duration;
      sources.add(source);
      lastPlayback = new Promise(resolve => {
        source.onended = () => {
          sources.delete(source);
          source.disconnect();
          resolve();
        };
      });
    }
    if (!lastPlayback) throw new Error('Speech stream contained no audio');
  } catch (error) {
    if (!lastPlayback || signal.aborted) throw error;
    // If audio already started, finish the queued samples without repeating the guide.
  } finally {
    try {
      await lastPlayback;
    } finally {
      signal.removeEventListener('abort', stopPlayback);
    }
  }
}

export async function playSpeech(text, signal) {
  try {
    await playGeneratedSpeech(text, signal);
  } catch {
    if (signal.aborted || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    await new Promise(resolve => {
      const finish = () => {
        signal.removeEventListener('abort', cancel);
        resolve();
      };
      const cancel = () => {
        speechSynthesis.cancel();
        finish();
      };
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ja-JP';
      utterance.onend = finish;
      utterance.onerror = finish;
      signal.addEventListener('abort', cancel, { once: true });
      try {
        speechSynthesis.speak(utterance);
      } catch {
        finish();
      }
    });
  }
}
