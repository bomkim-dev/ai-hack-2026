export function supportsRecording() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export async function recordAudio(signal, onRecord) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    .catch(() => { throw new Error('マイクを使えませんでした。設定を確認するか、文字で入力してください。'); });
  const stopTracks = () => stream.getTracks().forEach(track => track.stop());

  try {
    signal.throwIfAborted();
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 96_000 });
    const chunks = [];
    const stop = () => {
      if (recorder.state === 'recording') recorder.stop();
    };
    const captured = new Promise((resolve, reject) => {
      const abort = () => {
        stop();
        reject(signal.reason);
      };
      recorder.addEventListener('dataavailable', ({ data }) => {
        if (data.size) chunks.push(data);
      });
      recorder.addEventListener('error', () => reject(new Error('録音に失敗しました。')), { once: true });
      recorder.addEventListener('stop', () => {
        resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type }));
      }, { once: true });
      recorder.start();
      signal.addEventListener('abort', abort, { once: true });
      const limit = setTimeout(stop, 30_000);
      const cleanup = () => {
        clearTimeout(limit);
        signal.removeEventListener('abort', abort);
      };
      recorder.addEventListener('stop', cleanup, { once: true });
      recorder.addEventListener('error', cleanup, { once: true });
    });
    onRecord(stop);
    const audio = await captured;
    signal.throwIfAborted();
    if (!audio.size) throw new Error('録音が空です。もう一度お試しください。');
    return audio;
  } finally {
    stopTracks();
  }
}
