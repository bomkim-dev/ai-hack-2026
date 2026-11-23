const endSilenceMs = 800;
const warmupMs = 240;
const minSpeechMs = 120;
const maxSpeechMs = 12_000;

function loudness(samples) {
  let squared = 0;
  for (const sample of samples) squared += sample * sample;
  return Math.sqrt(squared / samples.length);
}

export function createTurnDetector(sampleRate, calibrationMs = 0) {
  let frames = [];
  let queuedMs = 0;
  let speechMs = 0;
  let trailingMs = 0;
  let turnMs = 0;
  let noise = 0;

  return samples => {
    const ms = samples.length * 1000 / sampleRate;
    const level = loudness(samples);
    if (calibrationMs > 0) {
      calibrationMs -= ms;
      noise = Math.max(noise, level);
      return null;
    }
    const isSpeech = level >= Math.max(0.009, noise * 2.8);
    if (!isSpeech) noise = noise * 0.9 + level * 0.1;
    frames.push({ samples, ms });
    queuedMs += ms;
    if (speechMs < minSpeechMs && !isSpeech) {
      speechMs = 0;
      while (queuedMs > warmupMs && frames.length > 1) {
        queuedMs -= frames.shift().ms;
      }
      return null;
    }
    if (isSpeech) {
      speechMs += ms;
      trailingMs = 0;
    } else {
      trailingMs += ms;
    }
    if (speechMs < minSpeechMs) return null;
    turnMs += ms;
    if (trailingMs < endSilenceMs && turnMs < maxSpeechMs) return null;

    const turn = frames.map(frame => frame.samples);
    frames = [];
    queuedMs = speechMs = trailingMs = turnMs = 0;
    return turn;
  };
}

export function encodeWave(frames, sampleRate) {
  const length = frames.reduce((total, frame) => total + frame.length, 0) * 2;
  const bytes = new ArrayBuffer(44 + length);
  const view = new DataView(bytes);
  const label = (offset, value) => {
    for (const [index, char] of [...value].entries()) view.setUint8(offset + index, char.charCodeAt(0));
  };
  label(0, 'RIFF');
  view.setUint32(4, length + 36, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, length, true);
  let offset = 44;
  for (const frame of frames) {
    for (const sample of frame) {
      const value = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, value < 0 ? value * 32768 : value * 32767, true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export function supportsConversation() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.AudioContext && window.AudioWorkletNode && window.speechSynthesis);
}

export async function openConversation(signal, onTurn, onFailure) {
  const context = new AudioContext({ sampleRate: 16_000 });
  let stream;
  let worklet;
  let detector;
  let listening = false;
  let resumeAfter = 0;
  const enableMicrophone = value => stream.getAudioTracks().forEach(track => { track.enabled = value; });
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    worklet?.disconnect();
    stream?.getTracks().forEach(track => track.stop());
    void context.close().catch(() => {});
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    const ready = context.resume();
    const microphone = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    }).then(value => {
      if (closed) value.getTracks().forEach(track => track.stop());
      stream = value;
    });
    await Promise.all([ready, microphone]);
    signal.throwIfAborted();
    await context.audioWorklet.addModule(new URL('./voice-capture.js', import.meta.url));
    signal.throwIfAborted();

    enableMicrophone(false);
    worklet = new AudioWorkletNode(context, 'cooking-voice-capture');
    worklet.port.onmessage = ({ data }) => {
      if (!listening || closed || data.endTime < resumeAfter) return;
      const turn = detector(data.samples);
      if (!turn) return;
      listening = false;
      enableMicrophone(false);
      worklet.port.postMessage(false);
      detector = null;
      onTurn(encodeWave(turn, context.sampleRate));
    };
    worklet.addEventListener('processorerror', onFailure, { once: true, signal });
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', onFailure, { once: true, signal }));
    context.createMediaStreamSource(stream).connect(worklet).connect(context.destination);

    return {
      setListening(value) {
        if (closed || value === listening) return;
        listening = value;
        enableMicrophone(value);
        worklet.port.postMessage(value);
        detector = value ? createTurnDetector(context.sampleRate, 150) : null;
        if (value) resumeAfter = context.currentTime + 0.15;
      },
    };
  } catch (error) {
    close();
    signal.removeEventListener('abort', close);
    throw error;
  }
}
