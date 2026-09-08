import { useEffect, useRef, useState } from 'react';
import type { Ctx } from '../App';
import { soundById, referenceContour } from '../../shared/sounds.js';
import { audioContext, playSound, blip, referenceFreqAt, preloadCustom, SoundDef } from '../audio/synth';
import { hzToSemitone } from '../audio/pitch';
import { scorePerformance } from '../game/scoring';
import PitchGraph from '../components/PitchGraph';
import Stage, { StagePlayer } from '../components/Stage';

type Stage_ = 'preload' | 'listen' | 'countdown' | 'record' | 'analyzing' | 'waiting';
const WAVE_BARS = 64;

/**
 * One round for one player. All stages are driven by the host-clock timestamps in the round,
 * so every phone plays the sound and starts recording at the same absolute moment.
 */
export default function RoundScreen({ ctx }: { ctx: Ctx }) {
  const { net, room, myId, hostNow, recorder, micReady, roundSound, toast } = ctx;
  const round = room.round!;
  const sound = soundById(round.soundId, roundSound ? [roundSound] : []) as SoundDef;
  const [stage, setStage] = useState<Stage_>('preload');
  const [count, setCount] = useState(3);
  const [progress, setProgress] = useState(0);
  const [live, setLive] = useState<(number | null)[]>([]);
  const [wave, setWave] = useState<number[]>(() => new Array(WAVE_BARS).fill(0));
  const [level, setLevel] = useState(0);
  const [liveScore, setLiveScore] = useState<number | null>(null);
  const [result, setResult] = useState<any>(null);
  const started = useRef(false);
  const framesRef = useRef<any[]>([]);

  const recordMs = round.recordEndAt - round.recordAt;
  const refContour = useRef<(number | null)[]>([]);
  const liveRef = useRef<(number | null)[]>([]);
  useEffect(() => {
    refContour.current = referenceContour(sound, 40).map((p: any) => (p.f == null ? null : hzToSemitone(p.f)));
    const n = Math.floor(recordMs / 40) + 1;
    liveRef.current = Array.from({ length: n }, (_, i) => { const f = referenceFreqAt(sound, (i * 40) / 1000); return f == null ? null : hzToSemitone(f); });
  }, [sound, recordMs]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const timers: number[] = [];
    let raf = 0, scoreTimer = 0;
    const at = (hostTime: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, hostTime - hostNow())));

    // 1) listen — schedule the reference on the AudioContext clock (custom sounds are decoded first)
    const ctxA = audioContext();
    const durS = (sound.custom ? sound.durationMs! : Math.max(...(sound.notes || []).map((n) => n.t + n.d)) * 1000) / 1000;
    const schedule = () => { const delay = Math.max(0, round.listenAt - hostNow()) / 1000; try { playSound(sound, ctxA.currentTime + delay, 0.7); } catch { /* audio locked */ } };
    if (sound.custom) preloadCustom(sound).then(schedule).catch(() => toast('Could not decode the custom sound')); else schedule();
    at(round.listenAt, () => {
      setStage('listen');
      const t0 = performance.now();
      const tick = () => { const p = Math.min(1, (performance.now() - t0) / 1000 / durS); setProgress(p); if (p < 1) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    });

    // 2) countdown 3-2-1
    const cd = room.settings.countdownMs || 3000;
    [3, 2, 1].forEach((n) => at(round.recordAt - (n * cd) / 3, () => { setStage('countdown'); setCount(n); blip(n === 1 ? 990 : 660, 90); }));

    // 3) record — everyone at recordAt
    at(round.recordAt, () => {
      blip(1320, 160, 'square', 0.2);
      setStage('record');
      if (!micReady || !recorder.ready) { toast('Microphone not enabled — you get a zero this round 😬', 4000); }
      else {
        const voicedRef = liveRef.current.filter((v): v is number => v != null);
        const refMin = Math.min(...voicedRef), refMax = Math.max(...voicedRef);
        const pts: (number | null)[] = [];
        const bars: number[] = new Array(WAVE_BARS).fill(0);
        recorder.onFrame = (fr) => {
          let v: number | null = fr.f == null ? null : hzToSemitone(fr.f);
          if (v != null) { while (v < refMin - 6) v += 12; while (v > refMax + 6) v -= 12; }
          pts[Math.round(fr.t / 40)] = v;
          const bi = Math.min(WAVE_BARS - 1, Math.floor((fr.t / recordMs) * WAVE_BARS));
          bars[bi] = Math.max(bars[bi], Math.min(1, fr.rms * 5));
          framesRef.current.push(fr);
          if (fr.t % 80 < 25) { setLive(pts.slice()); setWave(bars.slice()); setLevel(Math.min(1, fr.rms * 6)); }
        };
        try { recorder.start(); } catch (e: any) { toast(e.message); }
        // live match estimate every 300 ms (same scorer, partial frames)
        scoreTimer = window.setInterval(() => {
          try { const s = scorePerformance(sound, framesRef.current, recordMs); setLiveScore(s.score); } catch { /* ignore */ }
        }, 300);
      }
      const t0 = performance.now();
      const tick = () => { const p = Math.min(1, (performance.now() - t0) / recordMs); setProgress(p); if (p < 1) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    });

    // 4) stop, analyse locally, submit
    at(round.recordEndAt, async () => {
      clearInterval(scoreTimer);
      setStage('analyzing');
      let submission: any = { score: 0, pitch: 0, rhythm: 0, contour: [], audio: null, title: '🫣 Stage Fright' };
      if (micReady && recorder.ready) {
        try {
          const rec = await recorder.stop();
          recorder.onFrame = null;
          const s = scorePerformance(sound, rec.frames, rec.durationMs);
          setResult(s);
          submission = { score: s.score, pitch: s.pitch, rhythm: s.rhythm, contour: s.contour, audio: rec.dataUrl.length < 550_000 ? rec.dataUrl : null, title: s.title };
        } catch (e: any) { toast('Analysis failed: ' + e.message); }
      }
      net.emit('round:submit', submission, (r: any) => { if (!r?.ok) toast('Could not submit your score'); });
      setStage('waiting');
    });

    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(raf); clearInterval(scoreTimer); recorder.onFrame = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submittedCount = room.players.filter((p) => p.submitted).length;
  const phaseLabel = { preload: 'GET READY', listen: 'LISTEN', countdown: 'GET SET', record: 'RECORDING', analyzing: 'JUDGING', waiting: 'WAITING' }[stage];
  const players: StagePlayer[] = room.players.map((p) => ({
    id: p.id, name: p.name, avatar: p.avatar, total: p.total,
    score: p.id === myId ? (stage === 'record' ? liveScore : result ? result.score : null) : (stage === 'waiting' && p.submitted ? '✓' as any : null),
    mood: stage === 'record' ? 'sing' : stage === 'listen' ? 'idle' : stage === 'waiting' ? (p.submitted ? 'idle' : 'shy') : 'idle',
    level: p.id === myId ? level : stage === 'record' ? 0.4 + 0.3 * Math.sin(Date.now() / 150 + p.name.length) : 0,
  }));
  const caption = stage === 'listen' ? `👂 ${sound.emoji} ${sound.name} — "${sound.hint}"` : stage === 'countdown' ? `Everyone in… ${count}` : stage === 'record' ? `GO! ${sound.emoji} "${sound.hint}"` : stage === 'analyzing' ? '🧠 Judging your noise…' : stage === 'waiting' ? `Waiting… ${submittedCount}/${room.players.length} done` : '👂 Get ready to listen';

  return (
    <div className="flex-1 flex flex-col gap-3">
      <Stage players={players} roundLabel={`ROUND ${round.n} / ${round.of}`} phaseLabel={phaseLabel} caption={caption} wave={stage === 'record' ? wave : null} progress={stage === 'record' ? progress : null}>
        {stage === 'countdown' && <div key={count} className="absolute inset-0 grid place-items-center pointer-events-none"><div className="text-[8rem] leading-none font-black text-party-yellow drop-shadow-[0_6px_0_rgba(0,0,0,.4)] animate-pop">{count}</div></div>}
        {stage === 'listen' && <div className="absolute left-3 right-3 bottom-3 h-2 rounded-full bg-black/40 overflow-hidden"><div className="h-full bg-party-yellow" style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      </Stage>

      {stage === 'record' && (
        <div className="card !p-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-extrabold text-party-pink">🎤 Mimic it now!</span>
            <span className="font-black text-party-yellow text-xl tabular-nums">{liveScore ?? '–'}<span className="text-xs text-white/50 font-bold"> / 100</span></span>
          </div>
          <PitchGraph reference={liveRef.current} contour={live} live height={110} />
          <div className="text-xs text-white/50 mt-1">Yellow = the sound · pink = you · the number is your live match</div>
        </div>
      )}

      {stage === 'waiting' && result && (
        <div className="card !p-3 text-center">
          <div className="text-5xl font-black text-party-yellow">{result.score}</div>
          <div className="font-bold">{result.title}</div>
          <div className="text-white/60 text-sm">Pitch {result.pitch} · Rhythm {result.rhythm}</div>
          <div className="mt-2"><PitchGraph reference={result.reference} contour={result.contour} height={96} /></div>
        </div>
      )}
      {stage === 'listen' && <div className="card !p-3"><PitchGraph reference={refContour.current} contour={[]} height={90} /></div>}
    </div>
  );
}
