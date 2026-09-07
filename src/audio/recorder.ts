/**
 * Microphone capture: getUserMedia → MediaRecorder (the audio file for playback) and, in
 * parallel, an AnalyserNode sampled every 20 ms → pitch frames for scoring and the live graph.
 */
import { detectPitch } from './pitch';
import { audioContext } from './synth';

export interface PitchFrame { t: number; f: number | null; clarity: number; rms: number }
export interface Recording { blob: Blob; mimeType: string; frames: PitchFrame[]; durationMs: number; dataUrl: string }

const FRAME_MS = 20;

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'];
  return candidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || '';
}

export class MimicRecorder {
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buf = new Float32Array(2048);
  private timer = 0;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private frames: PitchFrame[] = [];
  private t0 = 0;
  onFrame: ((frame: PitchFrame) => void) | null = null;

  get ready() { return !!this.stream; }

  /** Asks for the microphone (call from a user tap). Raw audio: no browser noise processing, so pitch stays intact. */
  async init(): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot access the microphone. Use Safari on iPhone or Chrome on Android over HTTPS.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false });
    } catch (e: any) {
      throw new Error(/NotAllowed|Permission/i.test(e?.name) ? 'Microphone permission denied — allow it in the browser settings and reload.' : 'Could not open the microphone (' + (e?.name || e) + ').');
    }
    const ctx = audioContext();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    this.source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);           // analyser only — never routed to the speakers (no feedback)
  }

  /** Current loudness 0..1 for the level meter (works before/without recording). */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0; for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    return Math.min(1, Math.sqrt(s / this.buf.length) * 6);
  }

  start(): void {
    if (!this.stream || !this.analyser) throw new Error('Microphone not initialised');
    this.frames = []; this.chunks = [];
    const mimeType = pickMimeType();
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(250);
    this.t0 = performance.now();
    const sr = audioContext().sampleRate;
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      const r = detectPitch(this.buf, sr);
      const frame: PitchFrame = { t: Math.round(performance.now() - this.t0), f: r.freq, clarity: r.clarity, rms: r.rms };
      this.frames.push(frame);
      this.onFrame && this.onFrame(frame);
    };
    this.timer = window.setInterval(tick, FRAME_MS);
  }

  stop(): Promise<Recording> {
    clearInterval(this.timer);
    const rec = this.rec; this.rec = null;
    const durationMs = Math.round(performance.now() - this.t0);
    const frames = this.frames;
    return new Promise((resolve) => {
      if (!rec || rec.state === 'inactive') return resolve(this.finish(frames, durationMs, rec?.mimeType || ''));
      rec.onstop = () => resolve(this.finish(frames, durationMs, rec.mimeType));
      rec.stop();
    });
  }

  private async finish(frames: PitchFrame[], durationMs: number, mimeType: string): Promise<Recording> {
    const type = mimeType || (this.chunks[0]?.type) || 'audio/webm';
    const blob = new Blob(this.chunks, { type });
    const dataUrl = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob); });
    return { blob, mimeType: type, frames, durationMs, dataUrl };
  }

  dispose(): void {
    clearInterval(this.timer);
    try { this.rec && this.rec.state !== 'inactive' && this.rec.stop(); } catch { /* ignore */ }
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null; this.analyser = null; this.source = null;
  }
}
