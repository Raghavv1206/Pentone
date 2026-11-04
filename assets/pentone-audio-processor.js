/**
 * Pentone Audio Capture Processor (AudioWorkletProcessor)
 * Captures 16 kHz Float32 PCM audio frames and chunks them in 4096-sample batches.
 * Runs on the dedicated audio rendering thread for zero-latency, drop-free capture.
 */
class PentoneAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bytesWritten = 0;

    this.port.onmessage = (event) => {
      if (event.data && event.data.command === 'flush' && this.bytesWritten > 0) {
        const remaining = this.buffer.subarray(0, this.bytesWritten);
        const copy = new Float32Array(remaining.length);
        copy.set(remaining);
        this.port.postMessage(copy);
        this.bytesWritten = 0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channel = input[0];
      if (channel && channel.length > 0) {
        let i = 0;
        while (i < channel.length) {
          const toWrite = Math.min(channel.length - i, this.bufferSize - this.bytesWritten);
          this.buffer.set(channel.subarray(i, i + toWrite), this.bytesWritten);
          this.bytesWritten += toWrite;
          i += toWrite;

          if (this.bytesWritten >= this.bufferSize) {
            const chunk = new Float32Array(this.bufferSize);
            chunk.set(this.buffer);
            this.port.postMessage(chunk);
            this.bytesWritten = 0;
          }
        }
      }
    }
    return true;
  }
}

registerProcessor('pentone-audio-processor', PentoneAudioProcessor);
