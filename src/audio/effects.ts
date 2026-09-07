/**
 * Funny playback effects for the recorded mimic (results screen).
 */
import { audioContext } from './synth';

export const EFFECTS = [
  { id: 'normal', name: 'Original', emoji: '🎙️' },
  { id: 'chipmunk', name: 'Chipmunk', emoji: '🐿️' },
  { id: 'giant', name: 'Giant', emoji: '🦣' },
  { id: 'robot', name: 'Robot', emoji: '🤖' },
  { id: 'cave', name: 'Cave echo', emoji: '🏔️' },
  { id: 'reverse', name: 'Reverse', emoji: '⏪' },
] as const;
export type EffectId = (typeof EFFECTS)[number]['id'];

const cache = new Map<string, AudioBuffer>();

async function decode(src: string | Blob): Promise<AudioBuffer> {
  const key = typeof src === 'string' ? src : '';
  if (key && cache.has(key)) return cache.get(key)!;
  const ctx = audioContext();
  const bytes = typeof src === 'string' ? await (await fetch(src)).arrayBuffer() : await src.arrayBuffer();
  const buf = await ctx.decodeAudioData(bytes.slice(0));
  if (key) cache.set(key, buf);
  return buf;
}

export interface Playback { stop: () => void; duration: number; done: Promise<void> }

/** Plays a recording (data URL or Blob) with an effect. */
export async function playWithEffect(src: string | Blob, effect: EffectId): Promise<Playback> {
  const ctx = audioContext();
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  let buffer = await decode(src);

  if (effect === 'reverse') {
    const rev = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) rev.getChannelData(c).set(Array.from(buffer.getChannelData(c)).reverse());
    buffer = rev;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const out = ctx.createGain(); out.gain.value = 1.2;
  let node: AudioNode = source;
  const extras: { stop: () => void }[] = [];

  if (effect === 'chipmunk') source.playbackRate.value = 1.55;
  if (effect === 'giant') source.playbackRate.value = 0.68;
  if (effect === 'robot') {
    // ring modulation: multiply the voice by a 35 Hz carrier
    const ring = ctx.createGain(); ring.gain.value = 0;
    const carrier = ctx.createOscillator(); carrier.frequency.value = 35; carrier.type = 'sine';
    carrier.connect(ring.gain); carrier.start();
    node.connect(ring); node = ring;
    extras.push({ stop: () => carrier.stop() });
  }
  if (effect === 'cave') {
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.21;
    const fb = ctx.createGain(); fb.gain.value = 0.45;
    const wet = ctx.createGain(); wet.gain.value = 0.7;
    node.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(out);
  }
  node.connect(out); out.connect(ctx.destination);

  const rate = source.playbackRate.value;
  const duration = buffer.duration / rate + (effect === 'cave' ? 1.2 : 0.05);
  const done = new Promise<void>((res) => { source.onended = () => res(); setTimeout(res, duration * 1000 + 100); });
  source.start();
  return { stop: () => { try { source.stop(); } catch { /* already stopped */ } extras.forEach((e) => e.stop()); }, duration, done };
}
