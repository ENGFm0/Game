/* Scoring: perfect mimic → high; transposed + delayed → still high; wrong shape / silence → low. */
import assert from 'node:assert';
import { scorePerformance } from './.build/scoring.mjs';
import { soundById, referenceContour, recordWindowMs } from '../shared/sounds.js';

const sound = soundById('siren');
const recordMs = recordWindowMs(sound);

/** Builds fake pitch frames from the reference: delayed by `delayMs`, transposed by `semis`, with slight jitter. */
function mimic(delayMs = 0, semis = 0, jitter = 0.3, shape = (f) => f) {
  const ref = referenceContour(sound, 20);
  const frames = [];
  for (let t = 0; t <= recordMs; t += 20) {
    const p = ref.find((r) => r.t === t - delayMs);
    const f = p && p.f != null ? shape(p.f) * Math.pow(2, (semis + (Math.random() - 0.5) * jitter) / 12) : null;
    frames.push({ t, f, clarity: f ? 0.95 : 0, rms: f ? 0.2 : 0.001 });
  }
  return frames;
}

const perfect = scorePerformance(sound, mimic(0, 0, 0), recordMs);
assert.ok(perfect.score >= 90, 'perfect mimic scores ≥ 90, got ' + perfect.score);
assert.ok(perfect.pitch >= 90 && perfect.rhythm >= 90, `pitch ${perfect.pitch} rhythm ${perfect.rhythm}`);

const lowVoice = scorePerformance(sound, mimic(300, -12, 0.4), recordMs);   // an octave lower, 300 ms reaction delay
assert.ok(lowVoice.score >= 80, 'octave-down + delay still ≥ 80, got ' + lowVoice.score);
assert.ok(lowVoice.offsetMs >= 200 && lowVoice.offsetMs <= 400, 'delay detected: ' + lowVoice.offsetMs);

const flat = scorePerformance(sound, mimic(100, 0, 0.2, () => 600), recordMs);  // monotone hum instead of a siren
assert.ok(flat.pitch < 60, 'monotone hum loses pitch points, got ' + flat.pitch);
assert.ok(flat.score < perfect.score - 15, 'monotone scores clearly lower');

const inverted = scorePerformance(sound, mimic(0, 0, 0.2, (f) => 520 * 880 / f), recordMs);   // contour upside down
assert.ok(inverted.pitch < 55, 'inverted contour loses pitch points, got ' + inverted.pitch);

const silence = scorePerformance(sound, mimic(0, 0, 0, () => null).map((fr) => ({ ...fr, f: null, rms: 0.001, clarity: 0 })), recordMs);
assert.strictEqual(silence.score, 0);
assert.match(silence.title, /Stage Fright/);

// rhythm: doorbell (two onsets) — clapping the wrong rhythm (three notes) drops rhythm points
const bell = soundById('doorbell');
const bellMs = recordWindowMs(bell);
const good = [], bad = [];
for (let t = 0; t <= bellMs; t += 20) {
  const inGood = (t >= 0 && t < 600) || (t >= 750 && t < 1650);
  const inBad = (t >= 0 && t < 300) || (t >= 500 && t < 800) || (t >= 1000 && t < 1500);
  good.push({ t, f: inGood ? (t < 700 ? 659 : 523) : null, clarity: inGood ? .9 : 0, rms: inGood ? .2 : 0 });
  bad.push({ t, f: inBad ? 600 : null, clarity: inBad ? .9 : 0, rms: inBad ? .2 : 0 });
}
const g = scorePerformance(bell, good, bellMs), b = scorePerformance(bell, bad, bellMs);
assert.ok(g.rhythm >= 90, 'correct rhythm ≥ 90, got ' + g.rhythm);
assert.ok(b.rhythm < g.rhythm - 20, `wrong rhythm scores lower: ${b.rhythm} vs ${g.rhythm}`);

console.log(`✔ scoring test passed (perfect ${perfect.score}, octave-down ${lowVoice.score}, monotone ${flat.score}, inverted ${inverted.score}, wrong-rhythm ${b.rhythm})`);
