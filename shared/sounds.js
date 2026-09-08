/**
 * Mimic Party — sound library.
 *
 * Every sound is synthesised from a small description (notes with pitch glides), so the
 * SAME definition drives three things: playback through the Web Audio API, the reference
 * pitch contour the scorer compares against, and the rhythm (note onsets).
 * No audio files needed — and the reference contour is exact.
 *
 * Shared by the client (playback + scoring) and the game core (round timing).
 */

/** @typedef {{ t: number, d: number, f0: number, f1?: number }} Note  — start (s), duration (s), start/end frequency (Hz) */

export const SOUNDS = [
  { id: 'siren',    name: 'Police Siren',  emoji: '🚨', wave: 'sawtooth', hint: 'Weeee-ooooo', notes: [{ t: 0, d: 1.2, f0: 520, f1: 880 }, { t: 1.2, d: 1.2, f0: 880, f1: 520 }] },
  { id: 'doorbell', name: 'Doorbell',      emoji: '🔔', wave: 'sine',     hint: 'Ding… dong!', notes: [{ t: 0, d: 0.6, f0: 659 }, { t: 0.75, d: 0.9, f0: 523 }] },
  { id: 'cat',      name: 'Cat Meow',      emoji: '🐱', wave: 'triangle', hint: 'Meee-aaoow', vibrato: 6, notes: [{ t: 0, d: 0.5, f0: 560, f1: 820 }, { t: 0.5, d: 0.9, f0: 820, f1: 470 }] },
  { id: 'laser',    name: 'Laser Gun',     emoji: '🔫', wave: 'square',   hint: 'Pew pew pew', notes: [{ t: 0, d: 0.35, f0: 1000, f1: 260 }, { t: 0.5, d: 0.35, f0: 1000, f1: 260 }, { t: 1.0, d: 0.35, f0: 1000, f1: 260 }] },
  { id: 'cuckoo',   name: 'Cuckoo Clock',  emoji: '🐦', wave: 'sine',     hint: 'Cu-ckoo, cu-ckoo', notes: [{ t: 0, d: 0.35, f0: 660 }, { t: 0.42, d: 0.5, f0: 528 }, { t: 1.2, d: 0.35, f0: 660 }, { t: 1.62, d: 0.5, f0: 528 }] },
  { id: 'horn',     name: 'Car Horn',      emoji: '🚗', wave: 'sawtooth', hint: 'Beep, beeeeep', notes: [{ t: 0, d: 0.45, f0: 440 }, { t: 0.65, d: 1.1, f0: 440 }] },
  { id: 'rooster',  name: 'Rooster',       emoji: '🐓', wave: 'sawtooth', hint: 'Cock-a-doodle-dooo', notes: [{ t: 0, d: 0.3, f0: 600, f1: 700 }, { t: 0.35, d: 0.3, f0: 800, f1: 900 }, { t: 0.7, d: 0.6, f0: 1000, f1: 950 }, { t: 1.35, d: 0.8, f0: 800, f1: 500 }] },
  { id: 'mosquito', name: 'Mosquito',      emoji: '🦟', wave: 'sawtooth', hint: 'Zzzzzzzzzz', vibrato: 9, notes: [{ t: 0, d: 2.2, f0: 640, f1: 700 }] },
  { id: 'boing',    name: 'Boing!',        emoji: '🪀', wave: 'triangle', hint: 'Boiiing', notes: [{ t: 0, d: 0.9, f0: 300, f1: 720 }, { t: 0.9, d: 0.6, f0: 720, f1: 380 }] },
  { id: 'ufo',      name: 'UFO',           emoji: '🛸', wave: 'sine',     hint: 'Wiu wiu wiu', notes: [{ t: 0, d: 0.4, f0: 400, f1: 900 }, { t: 0.4, d: 0.4, f0: 900, f1: 400 }, { t: 0.8, d: 0.4, f0: 400, f1: 900 }, { t: 1.2, d: 0.4, f0: 900, f1: 400 }] },
];

export const SOUND_IDS = SOUNDS.map((s) => s.id);
export const soundById = (id, custom = []) => custom.find((s) => s.id === id) || SOUNDS.find((s) => s.id === id) || SOUNDS[0];

/** Custom sounds (recorded or uploaded by the host) carry their own audio + analysed contour:
 *  { id, name, emoji, custom: true, durationMs, audio: dataURL, contour: [{t, f}], onsets: [ms] } */
export const CUSTOM_LIMITS = { maxSounds: 8, maxDurationMs: 4000, audioBytes: 400 * 1024 };

export function sanitizeCustomSound(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.audio !== 'string' || !/^data:audio\/[a-z0-9.+-]+(;codecs=[a-z0-9.,+-]+)?;base64,[a-z0-9+/=]+$/i.test(s.audio) || s.audio.length > CUSTOM_LIMITS.audioBytes * 1.4) return null;
  const durationMs = Math.min(CUSTOM_LIMITS.maxDurationMs, Math.max(300, Math.round(Number(s.durationMs) || 0)));
  const contour = Array.isArray(s.contour) ? s.contour.slice(0, 400).map((p) => ({ t: Math.max(0, Math.round(Number(p.t) || 0)), f: p.f == null || !Number.isFinite(Number(p.f)) ? null : Math.min(2000, Math.max(50, Number(p.f))) })) : [];
  if (!contour.some((p) => p.f != null)) return null;
  const onsets = Array.isArray(s.onsets) ? s.onsets.slice(0, 20).map((v) => Math.max(0, Math.round(Number(v) || 0))) : [0];
  const name = String(s.name || 'My sound').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'My sound';
  return { id: 'custom-' + Math.random().toString(36).slice(2, 8), name, emoji: '🎵', hint: name, custom: true, durationMs, audio: s.audio, contour, onsets: onsets.length ? onsets : [0] };
}

/** Length of the sound in milliseconds. */
export function soundDurationMs(sound) {
  if (sound.custom) return sound.durationMs;
  return Math.round(Math.max(...sound.notes.map((n) => n.t + n.d)) * 1000);
}

/** Frequency at time t (seconds) inside a note — exponential glide from f0 to f1. */
export function noteFreqAt(note, t) {
  const f1 = note.f1 ?? note.f0;
  const k = Math.min(1, Math.max(0, (t - note.t) / note.d));
  return note.f0 * Math.pow(f1 / note.f0, k);
}

/** Reference pitch contour: [{ t (ms), f (Hz) | null }] sampled every `stepMs`. */
export function referenceContour(sound, stepMs = 20) {
  const out = [];
  const total = soundDurationMs(sound);
  if (sound.custom) {
    // resample the analysed contour onto the requested grid (nearest sample within 15 ms)
    const pts = sound.contour;
    let j = 0;
    for (let ms = 0; ms <= total; ms += stepMs) {
      while (j < pts.length - 1 && pts[j + 1].t <= ms) j++;
      const p = pts[j], q = pts[j + 1];
      const near = q && Math.abs(q.t - ms) < Math.abs(p.t - ms) ? q : p;
      out.push({ t: ms, f: near && Math.abs(near.t - ms) <= 15 ? near.f : null });
    }
    return out;
  }
  for (let ms = 0; ms <= total; ms += stepMs) {
    const t = ms / 1000;
    const note = sound.notes.find((n) => t >= n.t && t < n.t + n.d);
    out.push({ t: ms, f: note ? noteFreqAt(note, t) : null });
  }
  return out;
}

/** Note onsets in ms. Notes that start exactly where the previous one ends are one continuous sound (no new onset). */
export function referenceOnsets(sound) {
  if (sound.custom) return sound.onsets;
  const onsets = [];
  let prevEnd = -1;
  for (const n of sound.notes) {
    if (n.t - prevEnd > 0.03) onsets.push(Math.round(n.t * 1000));
    prevEnd = n.t + n.d;
  }
  return onsets;
}

/** Recording window for a sound: the sound length plus a second of slack, clamped to 3–5 s. */
export function recordWindowMs(sound) {
  return Math.min(5000, Math.max(3000, soundDurationMs(sound) + 1000));
}
