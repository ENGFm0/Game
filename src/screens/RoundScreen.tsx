import { useEffect, useRef, useState } from 'react';
import type { Ctx } from '../App';
import { soundById, referenceContour, soundDurationMs } from '../../shared/sounds.js';
import { audioContext, playSound, blip, referenceFreqAt, SoundDef } from '../audio/synth';
import { hzToSemitone } from '../audio/pitch';
import { scorePerformance } from '../game/scoring';
import PitchGraph from '../components/PitchGraph';

type Stage = 'preload' | 'listen' | 'countdown' | 'record' | 'analyzing' | 'waiting';

/**
 * One round for one player. All stages are driven by the host-clock timestamps in the round,
 * so every phone plays the sound and starts recording at the same absolute moment.
 */
export default function RoundScreen({ ctx }: { ctx: Ctx }) {
  const { net, room, hostNow, recorder, micReady, toast } = ctx;
  const round = room.round!;
  const sound = soundById(round.soundId) as SoundDef;
  const [stage, setStage] = useState<Stage>('preload');
  const [count, setCount] = useState(3);
  const [progress, setProgress] = useState(0);
  const [live, setLive] = useState<(number | null)[]>([]);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<any>(null);
  const started = useRef(false);

  const refContour = useRef<(number | null)[]>([]);
  useEffect(() => { refContour.current = referenceContour(sound, 40).map((p: any) => (p.f == null ? null : hzToSemitone(p.f))); }, [sound]);

  // Live display: reference (semitones) padded to the record window + the recorded contour folded into the reference octave.
  const recordMs = round.recordEndAt - round.recordAt;
  const liveRef = useRef<(number | null)[]>([]);
  useEffect(() => {
    const n = Math.floor(recordMs / 40) + 1;
    liveRef.current = Array.from({ length: n }, (_, i) => { const f = referenceFreqAt(sound, (i * 40) / 1000); return f == null ? null : hzToSemitone(f); });
  }, [sound, recordMs]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let timers: number[] = [];
    let raf = 0;
    const at = (hostTime: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, hostTime - hostNow())));

    // 1) listen — schedule the reference on the AudioContext clock for sample-accurate start
    const ctxA = audioContext();
    const delay = Math.max(0, round.listenAt - hostNow()) / 1000;
    const durS = soundDurationMs(sound) / 1000;
    try { playSound(sound, ctxA.currentTime + delay, 0.6); } catch { /* audio locked */ }
    at(round.listenAt, () => {
      setStage('listen');
      const t0 = performance.now();
      const tick = () => { const p = Math.min(1, (performance.now() - t0) / 1000 / durS); setProgress(p); if (p < 1) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    });

    // 2) countdown 3-2-1 (blips)
    const cd = room.settings.countdownMs || 3000;
    [3, 2, 1].forEach((n) => at(round.recordAt - (n * cd) / 3, () => { setStage('countdown'); setCount(n); blip(n === 1 ? 990 : 660, 90); }));

    // 3) record — everyone at recordAt
    at(round.recordAt, async () => {
      blip(1320, 160, 'square', 0.2);
      if (!micReady || !recorder.ready) { setStage('record'); toast('Microphone not enabled — you get a zero this round 😬', 4000); }
      else {
        const refMin = Math.min(...liveRef.current.filter((v): v is number => v != null)), refMax = Math.max(...liveRef.current.filter((v): v is number => v != null));
        const pts: (number | null)[] = [];
        recorder.onFrame = (fr) => {
          let v: number | null = fr.f == null ? null : hzToSemitone(fr.f);
          if (v != null) { while (v < refMin - 6) v += 12; while (v > refMax + 6) v -= 12; }
          const i = Math.round(fr.t / 40);
          pts[i] = v;
          if (fr.t % 80 < 25) { setLive(pts.slice()); setLevel(Math.min(1, fr.rms * 6)); }
        };
        try { recorder.start(); } catch (e: any) { toast(e.message); }
        setStage('record');
      }
      const t0 = performance.now();
      const tick = () => { const p = Math.min(1, (performance.now() - t0) / recordMs); setProgress(p); if (p < 1) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    });

    // 4) stop, analyse locally, submit
    at(round.recordEndAt, async () => {
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

    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(raf); recorder.onFrame = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submittedCount = room.players.filter((p) => p.submitted).length;

  return (
    <div className="flex-1 flex flex-col gap-4">
      <div className="flex items-center justify-between text-white/70 text-sm font-bold">
        <span>Round {round.n} / {round.of}</span>
        <span className="pill bg-white/10">{sound.emoji} {sound.name}</span>
      </div>

      {stage === 'preload' && <Big emoji="👂" title="Get ready to listen" sub="The sound plays on every phone at the same time." />}

      {stage === 'listen' && (
        <div className="card text-center animate-pop">
          <div className="text-8xl animate-pulse2">{sound.emoji}</div>
          <h2 className="text-3xl font-extrabold mt-2">Listen… {sound.name}</h2>
          <p className="text-white/70 mt-1">"{sound.hint}"</p>
          <Bar value={progress} color="bg-party-yellow" />
          <PitchGraph reference={refContour.current} contour={[]} height={110} />
        </div>
      )}

      {stage === 'countdown' && (
        <div className="card text-center">
          <div className="text-white/70 font-bold">Everyone mimics in…</div>
          <div key={count} className="text-[9rem] leading-none font-extrabold text-party-yellow animate-pop">{count}</div>
          <div className="text-white/60">"{sound.hint}"</div>
        </div>
      )}

      {stage === 'record' && (
        <div className="card text-center border-party-pink/60 shadow-pink-500/20">
          <div className="text-6xl animate-pulse2">🎤</div>
          <h2 className="text-3xl font-extrabold text-party-pink">GO! Mimic it!</h2>
          <p className="text-white/70">{sound.emoji} "{sound.hint}"</p>
          <Bar value={progress} color="bg-party-pink" />
          <div className="mt-3 flex items-center gap-3">
            <span className="text-xl">🔊</span>
            <div className="flex-1 h-3 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-party-mint via-party-yellow to-party-pink transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} /></div>
          </div>
          <div className="mt-3"><PitchGraph reference={liveRef.current} contour={live} live height={130} /></div>
          <div className="text-xs text-white/50 mt-2">Yellow = the sound · pink = you</div>
        </div>
      )}

      {stage === 'analyzing' && <Big emoji="🧠" title="Judging your noise…" sub="Comparing pitch and rhythm on your phone." spin />}

      {stage === 'waiting' && (
        <div className="card text-center">
          <div className="text-6xl">{result ? (result.score >= 75 ? '🤩' : result.score >= 45 ? '😄' : '😅') : '🫣'}</div>
          {result && <>
            <div className="text-6xl font-extrabold text-party-yellow mt-1">{result.score}</div>
            <div className="font-bold text-lg">{result.title}</div>
            <div className="text-white/70 text-sm">Pitch {result.pitch} · Rhythm {result.rhythm}</div>
            <div className="mt-3"><PitchGraph reference={result.reference} contour={result.contour} height={110} /></div>
          </>}
          <p className="text-white/70 mt-3">Waiting for the others… {submittedCount}/{room.players.length} done</p>
          <ul className="flex flex-wrap justify-center gap-2 mt-2">
            {room.players.map((p) => <li key={p.id} className={`pill ${p.submitted ? 'bg-party-mint text-party-ink' : 'bg-white/10'}`}>{p.avatar} {p.name}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Big({ emoji, title, sub, spin }: { emoji: string; title: string; sub: string; spin?: boolean }) {
  return (
    <div className="card text-center">
      <div className={`text-7xl ${spin ? 'animate-spin [animation-duration:2.5s]' : 'animate-wiggle'} inline-block`}>{emoji}</div>
      <h2 className="text-2xl font-extrabold mt-3">{title}</h2>
      <p className="text-white/70 mt-1">{sub}</p>
    </div>
  );
}
function Bar({ value, color }: { value: number; color: string }) {
  return <div className="mt-4 h-3 rounded-full bg-white/10 overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${Math.round(value * 100)}%` }} /></div>;
}
