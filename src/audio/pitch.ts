/**
 * Fundamental-frequency (pitch) detection — McLeod Pitch Method (normalised square
 * difference function + parabolic interpolation). Runs on every 20 ms analyser frame in the
 * browser, so the server never touches audio.
 */
export interface PitchResult {
  freq: number | null;   // Hz, null when unvoiced / too quiet
  clarity: number;       // 0..1 confidence of the periodicity
  rms: number;           // loudness of the frame
}

const MIN_RMS = 0.012;       // below this the frame is treated as silence
const CLARITY_MIN = 0.62;    // below this the frame is treated as noise / unvoiced

export function rmsOf(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

export function detectPitch(buf: Float32Array, sampleRate: number, fmin = 70, fmax = 1200): PitchResult {
  const rms = rmsOf(buf);
  if (rms < MIN_RMS) return { freq: null, clarity: 0, rms };

  const maxLag = Math.min(Math.floor(sampleRate / fmin), buf.length >> 1);
  const minLag = Math.max(2, Math.floor(sampleRate / fmax));
  const W = buf.length - maxLag;                       // analysis window length
  const nsdf = new Float32Array(maxLag + 1);

  // NSDF(τ) = 2·Σ x[i]·x[i+τ] / Σ (x[i]² + x[i+τ]²)
  for (let tau = minLag; tau <= maxLag; tau++) {
    let acf = 0, m = 0;
    for (let i = 0; i < W; i++) {
      const a = buf[i], b = buf[i + tau];
      acf += a * b; m += a * a + b * b;
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }

  // Peak picking: highest point of every positive lobe after the first negative zero crossing.
  const peaks: { tau: number; val: number }[] = [];
  let tau = minLag;
  while (tau <= maxLag && nsdf[tau] > 0) tau++;        // skip the initial lobe (τ≈0 side)
  while (tau <= maxLag) {
    while (tau <= maxLag && nsdf[tau] <= 0) tau++;
    let best = -1, bestTau = tau;
    while (tau <= maxLag && nsdf[tau] > 0) { if (nsdf[tau] > best) { best = nsdf[tau]; bestTau = tau; } tau++; }
    if (best > 0) peaks.push({ tau: bestTau, val: best });
  }
  if (!peaks.length) return { freq: null, clarity: 0, rms };

  const highest = Math.max(...peaks.map((p) => p.val));
  const chosen = peaks.find((p) => p.val >= highest * 0.85)!;   // first lobe close to the maximum → avoids octave errors
  if (chosen.val < CLARITY_MIN) return { freq: null, clarity: chosen.val, rms };

  // Parabolic interpolation around the chosen lag for sub-sample precision.
  const t = chosen.tau;
  const y0 = nsdf[t - 1] ?? nsdf[t], y1 = nsdf[t], y2 = nsdf[t + 1] ?? nsdf[t];
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom !== 0 ? (y2 - y0) / denom : 0;
  const period = t + Math.max(-1, Math.min(1, shift));
  const freq = sampleRate / period;
  if (freq < fmin || freq > fmax) return { freq: null, clarity: chosen.val, rms };
  return { freq, clarity: chosen.val, rms };
}

/** Hz → semitones relative to A4 (440 Hz). */
export const hzToSemitone = (f: number) => 12 * Math.log2(f / 440);
