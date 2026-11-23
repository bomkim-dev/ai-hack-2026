class CookingVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.offset = 0;
    this.samples = new Float32Array(Math.ceil(sampleRate * 0.025));
    this.port.onmessage = ({ data }) => {
      this.enabled = data;
      this.offset = 0;
    };
  }

  process(inputs) {
    // Leaving the output untouched keeps the microphone out of the speakers.
    const channel = inputs[0]?.[0];
    if (!this.enabled || !channel) return true;
    for (const sample of channel) {
      this.samples[this.offset++] = sample;
      if (this.offset !== this.samples.length) continue;
      this.port.postMessage({ samples: this.samples, endTime: currentTime }, [this.samples.buffer]);
      this.samples = new Float32Array(Math.ceil(sampleRate * 0.025));
      this.offset = 0;
    }
    return true;
  }
}

registerProcessor('cooking-voice-capture', CookingVoiceCapture);
