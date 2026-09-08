/**
 * Plays sound definitions from shared/sounds.js through the Web Audio API:
 *  • built-in sounds: one oscillator per note with an exponential glide and a short gain envelope;
 *  • custom sounds (recorded/uploaded): a decoded buffer.
 * Also: the shared AudioContext, iOS audio unlock, UI blips and crowd sound effects.
 */
import { noteFreqAt } from '../../shared/sounds.js';

export interface SoundDef {
  id: string; name: string; emoji: string; hint: string; wave?: OscillatorType; vibrato?: number;
  notes?: { t: number; d: number; f0: number; f1?: number }[];
  custom?: boolean; durationMs?: number; audio?: string; contour?: { t: number; f: number | null }[]; onsets?: number[];
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
  const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
  s.buffer = b; s.connect(ctx.destination); s.start(0);
}

const bufferCache = new Map<string, AudioBuffer>();
/** Decodes (and caches) a custom sound's audio. Call early (e.g. when the round starts) so playback is instant. */
export async function preloadCustom(sound: SoundDef): Promise<AudioBuffer | null> {
  if (!sound.custom || !sound.audio) return null;
  if (bufferCache.has(sound.id)) return bufferCache.get(sound.id)!;
  const bytes = await (await fetch(sound.audio)).arrayBuffer();
  const buf = await audioContext().decodeAudioData(bytes);
  bufferCache.set(sound.id, buf);
  return buf;
}

/** Schedules the sound at `when` (AudioContext time, default now). Returns its duration in seconds. */
export function playSound(sound: SoundDef, when?: number, volume = 0.5): number {
  const ctx = audioContext();
  const start = when ?? ctx.currentTime + 0.05;
  const master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);

  if (sound.custom) {
    const dur = (sound.durationMs || 0) / 1000;
    const buf = bufferCache.get(sound.id);
    const go = (b: AudioBuffer) => { const src = ctx.createBufferSource(); src.buffer = b; src.connect(master); src.start(Math.max(ctx.currentTime, start), 0, dur + 0.05); };
    if (buf) go(buf); else preloadCustom(sound).then((b) => b && go(b));
    return dur;
  }

  let end = 0;
  for (const n of sound.notes || []) {
    const osc = ctx.createOscillator(); osc.type = sound.wave || 'sine';
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
  if (sound.custom) {
    const ms = t * 1000;
    let best: { t: number; f: number | null } | null = null;
    for (const p of sound.contour || []) { if (!best || Math.abs(p.t - ms) < Math.abs(best.t - ms)) best = p; }
    return best && Math.abs(best.t - ms) <= 15 ? best.f : null;
  }
  const n = (sound.notes || []).find((x) => t >= x.t && t < x.t + x.d);
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

/** Crowd effects synthesised from noise: applause, boo, apple splat. */
export function crowd(kind: 'applause' | 'boo' | 'splat' | 'whoosh') {
  try {
    const ctx = audioContext(), t = ctx.currentTime;
    const noise = (dur: number, vol: number, filterHz: number, q = 0.7) => {
      const n = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1);
      const src = ctx.createBufferSource(); src.buffer = b;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filterHz; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(ctx.destination);
      return { src, g, f };
    };
    if (kind === 'applause') {
      const { src, g } = noise(1.6, 0.0001, 2200, 0.5);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.15); g.gain.setValueAtTime(0.5, t + 1.0); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      // clap texture: amplitude flutter
      for (let i = 0; i < 24; i++) g.gain.setValueAtTime(0.25 + Math.random() * 0.3, t + 0.15 + i * 0.05);
      src.start(t); src.stop(t + 1.7);
    } else if (kind === 'boo') {
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(180 + i * 25, t + i * 0.08); o.frequency.exponentialRampToValueAtTime(110 + i * 15, t + 0.9 + i * 0.08);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
        g.gain.setValueAtTime(0.0001, t + i * 0.08); g.gain.exponentialRampToValueAtTime(0.12, t + 0.15 + i * 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0 + i * 0.08);
        o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t + i * 0.08); o.stop(t + 1.1 + i * 0.08);
      }
    } else if (kind === 'splat') {
      const { src, g } = noise(0.18, 0.5, 700, 0.8);
      g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      src.start(t); src.stop(t + 0.2);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.15);
      og.gain.setValueAtTime(0.3, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); o.connect(og); og.connect(ctx.destination); o.start(t); o.stop(t + 0.17);
    } else {
      const { src, g, f } = noise(0.35, 0.25, 1200, 1.2);
      f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.3);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      src.start(t); src.stop(t + 0.36);
    }
  } catch { /* audio locked */ }
}
