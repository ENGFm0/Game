/**
 * Scoring — compares the recorded pitch frames with the reference sound.
 *
 *  1. Both contours become semitone sequences (20 ms steps). Octave jumps in the recording are folded.
 *  2. A global time shift (0–1.2 s) absorbs the player's reaction delay.
 *  3. PITCH: dynamic-time-warping distance between the two contours after each is centred on its own
 *     median → the *shape* matters, not whether you sing an octave lower. Coverage (how much of the
 *     reference you actually voiced) scales the result.
 *  4. RHYTHM: onsets of voiced segments vs. the reference note onsets, plus total voiced duration.
 *  5. score = 0.6 · pitch + 0.4 · rhythm  (0–100).
 */
import { referenceContour, referenceOnsets, soundDurationMs } from '../../shared/sounds.js';
import { hzToSemitone } from '../audio/pitch';

export interface Frame { t: number; f: number | null; clarity?: number; rms?: number }
export interface ScoreResult {
  score: number; pitch: number; rhythm: number; coverage: number; offsetMs: number; title: string;
  contour: (number | null)[];      // recording, semitones relative to its median, 40 ms steps (for the results graph)
  reference: (number | null)[];    // reference, same format
}

const STEP = 20;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** Frames → semitone contour on a 20 ms grid, with octave folding and a 3-point median filter. */
function toContour(frames: Frame[], lengthMs: number): (number | null)[] {
  const n = Math.floor(lengthMs / STEP) + 1;
  const raw: (number | null)[] = new Array(n).fill(null);
  for (const fr of frames) {
    const i = Math.round(fr.t / STEP);
    if (i < 0 || i >= n) continue;
    const voiced = fr.f != null && (fr.clarity == null || fr.clarity >= 0.62) && (fr.rms == null || fr.rms >= 0.012);
    raw[i] = voiced ? hzToSemitone(fr.f!) : null;
  }
  // octave folding: a jump of ~12 semitones from the previous voiced value is a detector octave error
  let prev: number | null = null;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (v == null) continue;
    if (prev != null) { let d = v - prev; while (d > 7) { raw[i]! -= 12; d -= 12; } while (d < -7) { raw[i]! += 12; d += 12; } }
    prev = raw[i];
  }
  // median filter (3) removes single-frame spikes
  const out = raw.slice();
  for (let i = 1; i < n - 1; i++) {
    const a = raw[i - 1], b = raw[i], c = raw[i + 1];
    if (a != null && b != null && c != null) out[i] = median([a, b, c]);
  }
  return out;
}

function centre(c: (number | null)[]): (number | null)[] {
  const m = median(c.filter((v): v is number => v != null));
  return c.map((v) => (v == null ? null : v - m));
}

/** Onsets (ms) of voiced segments: a new segment starts after ≥ 120 ms of silence and must last ≥ 80 ms. */
function onsetsOf(c: (number | null)[]): number[] {
  const on: number[] = [];
  let silent = 999, run = 0, start = -1;
  for (let i = 0; i < c.length; i++) {
    if (c[i] != null) { if (run === 0) start = i; run++; if (run * STEP >= 80 && silent * STEP >= 120) { on.push(start * STEP); silent = 0; } }
    else { if (run > 0 && run * STEP < 80) { /* too short — ignore */ } run = 0; silent++; }
  }
  return on;
}

/** Banded DTW between two centred semitone contours (nulls skipped). Returns the path cost per reference sample,
 * so stretching a flat hum over a moving contour cannot dilute the error. */
function dtwDistance(a: number[], b: number[], band = 12): number {
  const n = a.length, m = b.length;
  if (!n || !m) return 99;
  const INF = 1e9;
  const D = new Float64Array((n + 1) * (m + 1)).fill(INF);
  D[0] = 0;
  const w = Math.max(band, Math.abs(n - m) + 1);
  for (let i = 1; i <= n; i++) {
    const jLo = Math.max(1, i - w), jHi = Math.min(m, i + w);
    for (let j = jLo; j <= jHi; j++) {
      const cost = Math.abs(a[i - 1] - b[j - 1]);
      const idx = i * (m + 1) + j;
      const c1 = D[idx - (m + 1)], c2 = D[idx - 1], c3 = D[idx - (m + 2)];
      const best = Math.min(c1, c2, c3);
      if (best >= INF) continue;
      D[idx] = best + cost;
    }
  }
  const end = n * (m + 1) + m;
  return D[end] >= INF ? 99 : D[end] / Math.max(n, m);
}

export function titleFor(score: number): string {
  if (score >= 90) return '🏆 Golden Throat';
  if (score >= 75) return '🎶 Sound Machine';
  if (score >= 55) return '😅 Close Enough';
  if (score >= 35) return '🦆 Duck Impression';
  if (score > 0) return '🔇 Mysterious Noise';
  return '🫣 Stage Fright';
}

export function scorePerformance(sound: any, frames: Frame[], recordMs: number): ScoreResult {
  const refMs = soundDurationMs(sound);
  const ref = referenceContour(sound, STEP).map((p: { f: number | null }) => (p.f == null ? null : hzToSemitone(p.f)));
  const refOnsets: number[] = referenceOnsets(sound);
  const rec = toContour(frames, recordMs);
  const refC = centre(ref), refVoiced = ref.filter((v: number | null) => v != null).length;

  // 1) reaction-delay search: pick the shift where the recording overlaps the reference best
  let bestShift = 0, bestCost = Infinity;
  const maxShift = Math.min(1200, Math.max(0, recordMs - refMs));
  for (let shift = 0; shift <= maxShift; shift += 40) {
    const off = shift / STEP;
    let covered = 0, err = 0, pairs = 0;
    const seg = rec.slice(off, off + ref.length);
    const segC = centre(seg);
    for (let i = 0; i < ref.length; i++) {
      if (refC[i] == null) continue;
      if (segC[i] != null) { covered++; err += Math.abs(segC[i]! - refC[i]!); pairs++; }
    }
    const coverage = covered / Math.max(1, refVoiced);
    const cost = (pairs ? err / pairs : 24) + (1 - coverage) * 10;
    if (cost < bestCost) { bestCost = cost; bestShift = shift; }
  }
  const off = bestShift / STEP;
  const seg = rec.slice(off, off + ref.length + 10);
  const segC = centre(seg);

  // 2) coverage + pitch (DTW on voiced samples only)
  let covered = 0;
  for (let i = 0; i < ref.length; i++) if (refC[i] != null && segC[i] != null) covered++;
  const coverage = covered / Math.max(1, refVoiced);
  const a = refC.filter((v): v is number => v != null);
  const b = segC.filter((v): v is number => v != null);
  const dist = dtwDistance(a, b);
  // exp curve: 0.3 st → 91, 1 st → 73, 2.3 st (a monotone hum on a siren) → 49
  let pitch = 100 * Math.exp(-dist / 3.2);
  pitch *= 0.45 + 0.55 * clamp(coverage, 0, 1);

  // 3) rhythm: onsets + voiced duration
  const recOnsets = onsetsOf(seg);
  let rhythm: number;
  if (!recOnsets.length) rhythm = 0;
  else {
    const errs = refOnsets.map((t) => Math.min(...recOnsets.map((r) => Math.abs(r - t))));
    const meanErr = errs.reduce((s, e) => s + e, 0) / errs.length;
    const countPenalty = Math.abs(recOnsets.length - refOnsets.length) * 12;
    const onsetScore = clamp(100 - meanErr / 5 - countPenalty, 0, 100);
    const refDur = refVoiced * STEP, recDur = seg.filter((v) => v != null).length * STEP;
    const durRatio = Math.min(refDur, recDur) / Math.max(refDur, recDur, 1);
    rhythm = 0.7 * onsetScore + 30 * durRatio;
  }

  const score = Math.round(clamp(0.6 * pitch + 0.4 * rhythm, 0, 100));
  const down = (c: (number | null)[]) => c.filter((_, i) => i % 2 === 0).map((v) => (v == null ? null : Math.round(v * 10) / 10));
  return { score, pitch: Math.round(pitch), rhythm: Math.round(rhythm), coverage: Math.round(coverage * 100) / 100, offsetMs: bestShift, title: titleFor(score), contour: down(segC.slice(0, ref.length)), reference: down(refC) };
}
