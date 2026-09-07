/**
 * Plays a sound definition from shared/sounds.js through the Web Audio API.
 * Each note is an oscillator with an exponential frequency glide and a short gain envelope.
 */
import { noteFreqAt } from '../../shared/sounds.js';

export interface SoundDef {
  id: string; name: string; emoji: string; wave: OscillatorType; hint: string; vibrato?: number;
  notes: { t: number; d: number; f0: number; f1?: number }[];
}

let shared: AudioContext | null = null;
/** One AudioContext for the whole app (must be created/resumed from a user gesture on iOS). */
export function audioContext(): AudioContext {
  if (!shared) shared = new (window.AudioContext || (window as any).webkitAudioContext)();
  return shared;
}
export async function unlockAudio(): Promise<void> {
  const ctx = audioContext();
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  // iOS also wants an actual (silent) buffer to be played from a gesture.
  const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
  s.buffer = b; s.connect(ctx.destination); s.start(0);
}

/** Schedules the sound at `when` (AudioContext time, default now). Returns its duration in seconds. */
export function playSound(sound: SoundDef, when?: number, volume = 0.5): number {
  const ctx = audioContext();
  const start = when ?? ctx.currentTime + 0.05;
  const master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
  let end = 0;
  for (const n of sound.notes) {
    const osc = ctx.createOscillator(); osc.type = sound.wave;
    const g = ctx.createGain();
    const t0 = start + n.t, t1 = t0 + n.d;
    osc.frequency.setValueAtTime(n.f0, t0);
    if (n.f1 && n.f1 !== n.f0) osc.frequency.exponentialRampToValueAtTime(n.f1, t1);
    if (sound.vibrato) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = sound.vibrato; lg.gain.value = n.f0 * 0.03;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t0); lfo.stop(t1 + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(1, t0 + 0.02);
    g.gain.setValueAtTime(1, Math.max(t0 + 0.02, t1 - 0.06));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t1 + 0.02);
    end = Math.max(end, n.t + n.d);
  }
  return end;
}

/** Frequency of the reference at time t (seconds), for the live visualiser. */
export function referenceFreqAt(sound: SoundDef, t: number): number | null {
  const n = sound.notes.find((x) => t >= x.t && t < x.t + x.d);
  return n ? noteFreqAt(n, t) : null;
}

/** Little UI blips (countdown ticks, success jingle). */
export function blip(freq = 880, ms = 90, type: OscillatorType = 'sine', vol = 0.25) {
  try {
    const ctx = audioContext(), t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
  } catch { /* audio not unlocked yet */ }
}
