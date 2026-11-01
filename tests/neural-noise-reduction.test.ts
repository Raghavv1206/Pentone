import test from 'node:test';
import assert from 'node:assert/strict';
import { neuralNoiseReductionService } from '../lib/audio/neural-noise-reduction-service';

test('Neural Noise Reduction: Basic silence and noise suppression', async () => {
  const sampleRate = 16000;
  const durationSec = 1.0;
  const numSamples = Math.floor(sampleRate * durationSec);

  // Generate synthetic white/fan noise (stationary Gaussian noise)
  const noisyBuffer = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    noisyBuffer[i] = (Math.random() - 0.5) * 0.08; // 80mV RMS noise
  }

  const { enhancedAudio, metrics } = await neuralNoiseReductionService.enhanceAudio(noisyBuffer, {
    aggressiveness: 0.70,
  });

  assert.equal(enhancedAudio.length, numSamples, 'Output length matches input length');
  assert.ok(metrics.processingLatencyMs < 50, `Latency is minimal (<50ms, got ${metrics.processingLatencyMs.toFixed(2)}ms)`);
  assert.ok(metrics.outputRms < metrics.inputRms, 'Noise is attenuated (output RMS < input RMS)');
  console.log(`[Test] Input RMS: ${metrics.inputRms.toFixed(4)}, Output RMS: ${metrics.outputRms.toFixed(4)}, Latency: ${metrics.processingLatencyMs.toFixed(2)}ms`);
});

test('Neural Noise Reduction: Preserves speech tone while reducing background noise', async () => {
  const sampleRate = 16000;
  const durationSec = 1.5;
  const numSamples = Math.floor(sampleRate * durationSec);

  // Synthetic speech vowel tone (300 Hz fundamental + harmonics) mixed with background noise
  const mixedBuffer = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const speech = 0.25 * Math.sin(2 * Math.PI * 300 * t) + 0.15 * Math.sin(2 * Math.PI * 600 * t);
    const noise = (Math.random() - 0.5) * 0.05;
    mixedBuffer[i] = speech + noise;
  }

  const { enhancedAudio, metrics } = await neuralNoiseReductionService.enhanceAudio(mixedBuffer);

  assert.ok(metrics.speechProbability > 0.4, 'Identifies speech presence');
  assert.ok(metrics.outputRms > 0.1, 'Preserves fundamental speech energy');
  assert.ok(metrics.processingLatencyMs < 80, `Fast execution (<80ms, got ${metrics.processingLatencyMs.toFixed(2)}ms)`);
});
