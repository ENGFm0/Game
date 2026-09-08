/**
 * Turns a recorded or uploaded clip into a custom sound: trims silence, caps the length at 4 s,
 * analyses the pitch contour + onsets (same detector the game uses), and re-encodes the kept part
 * as a small mono WAV so every phone can decode it.
 */
import { detectPitch } from './pitch';
import { audioContext } from './synth';
import { CUSTOM_LIMITS } from '../../shared/sounds.js';

export interface ClipAnalysis { durationMs: number; audio: string; contour: { t: number; f: number | null }[]; onsets: number[]; voicedRatio: number }

const STEP_MS = 20, WIN = 2048;

export async function analyzeClip(src: Blob | ArrayBuffer): Promise<ClipAnalysis> {
  const ctx = audioContext();
  const bytes = src instanceof Blob ? await src.arrayBuffer() : src;
  const decoded = await ctx.decodeAudioData(bytes.slice(0));
  const sr = decoded.sampleRate;
  const mono = mixToMono(decoded);

  // frame-by-frame pitch + loudness
  const frames: { t: number; f: number | null; rms: number; clarity: number }[] = [];
  const hop = Math.round((STEP_MS / 1000) * sr);
  for (let i = 0; i + WIN <= mono.length; i += hop) {
    const r = detectPitch(mono.subarray(i, i + WIN), sr);
    frames.push({ t: Math.round((i / sr) * 1000), f: r.freq, rms: r.rms, clarity: r.clarity });
  }
  const peak = Math.max(0.001, ...frames.map((f) => f.rms));
  const loud = (f: { rms: number }) => f.rms > Math.max(0.008, peak * 0.08);
  const first = frames.findIndex(loud);
  if (first < 0) throw new Error('The clip is silent — record something louder.');
  let last = frames.length - 1;
  while (last > first && !loud(frames[last])) last--;
  const startMs = Math.max(0, frames[first].t - 60);
  const endMs = Math.min(frames[last].t + 120, startMs + CUSTOM_LIMITS.maxDurationMs);
  const durationMs = Math.max(300, endMs - startMs);

  const kept = frames.filter((f) => f.t >= startMs && f.t <= endMs);
  const contour = kept.map((f) => ({ t: f.t - startMs, f: f.f != null && f.clarity >= 0.62 && loud(f) ? Math.round(f.f * 10) / 10 : null }));
  const voiced = contour.filter((p) => p.f != null).length;
  if (voiced < 8) throw new Error('No clear pitch found — hum, sing or use a tonal sound (not noise).');

  // onsets: voiced segments after ≥120 ms of silence, lasting ≥80 ms
  const onsets: number[] = [];
  let silent = 99, run = 0, start = 0;
  for (const p of contour) {
    if (p.f != null) { if (run === 0) start = p.t; run++; if (run * STEP_MS >= 80 && silent * STEP_MS >= 120) { onsets.push(start); silent = 0; } }
    else { run = 0; silent++; }
  }

  const audio = await blobToDataUrl(encodeWav(mono, sr, startMs / 1000, endMs / 1000, 22050));
  return { durationMs, audio, contour, onsets: onsets.length ? onsets : [0], voicedRatio: voiced / contour.length };
}

function mixToMono(buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels; }
  return out;
}

/** Mono 16-bit PCM WAV of samples[startS..endS], resampled to `rate` (linear), normalised to −1 dB. */
export function encodeWav(samples: Float32Array, sr: number, startS: number, endS: number, rate = 22050): Blob {
  const s0 = Math.floor(startS * sr), s1 = Math.min(samples.length, Math.floor(endS * sr));
  const n = Math.floor(((s1 - s0) * rate) / sr);
  let peak = 0.0001; for (let i = s0; i < s1; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = 0.89 / peak;
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const pos = s0 + (i * sr) / rate, j = Math.floor(pos), frac = pos - j;
    const v = (samples[j] || 0) * (1 - frac) + (samples[j + 1] || 0) * frac;
    data[i] = Math.max(-32768, Math.min(32767, Math.round(v * gain * 32767)));
  }
  const header = new ArrayBuffer(44), dv = new DataView(header);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  return new Blob([header, data.buffer], { type: 'audio/wav' });
}

export const blobToDataUrl = (b: Blob) => new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b); });
