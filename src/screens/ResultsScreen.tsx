import { useEffect, useRef, useState } from 'react';
import type { Ctx } from '../App';
import { soundById, referenceContour } from '../../shared/sounds.js';
import { EFFECTS, EffectId, playWithEffect, Playback } from '../audio/effects';
import { playSound, SoundDef, blip, crowd } from '../audio/synth';
import { hzToSemitone } from '../audio/pitch';
import PitchGraph from '../components/PitchGraph';
import Stage, { StageHandle, StagePlayer } from '../components/Stage';

const MEDALS = ['🥇', '🥈', '🥉'];
const LOW = 40, HIGH = 75;

export default function ResultsScreen({ ctx }: { ctx: Ctx }) {
  const { net, room, myId, isHost, roundResults, roundSound } = ctx;
  const round = room.round!;
  const sound = soundById(round.soundId, roundSound ? [roundSound] : []) as SoundDef;
  const results: any[] = roundResults?.results || round.results || [];
  const [effect, setEffect] = useState<EffectId>('chipmunk');
  const [playing, setPlaying] = useState<string | null>(null);
  const current = useRef<Playback | null>(null);
  const [selected, setSelected] = useState<string>(() => myId);
  const stageRef = useRef<StageHandle>(null);
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const skipRef = useRef(false);
  const reference = referenceContour(sound, 40).map((p: any) => (p.f == null ? null : hzToSemitone(p.f)));
  const isLast = round.n >= round.of;

  /* Playback show: each mimic plays in turn, the score flips on the card, the crowd reacts. */
  useEffect(() => {
    let alive = true;
    const onSplat = () => crowd('splat');
    window.addEventListener('stage:splat', onSplat);
    (async () => {
      await new Promise((r) => setTimeout(r, 600));
      for (const p of room.players) {
        if (!alive || skipRef.current) break;
        const r = results.find((x) => x.id === p.id);
        if (!r) continue;
        setSpeaker(p.id);
        if (r.audio) { try { const pb = await playWithEffect(r.audio, 'normal'); current.current = pb; await pb.done; } catch { /* decode failed */ } }
        else await new Promise((res) => setTimeout(res, 900));
        if (!alive || skipRef.current) break;
        setRevealed((v) => ({ ...v, [p.id]: r.score }));
        if (r.score < LOW) { crowd('boo'); await stageRef.current?.throwApples(p.id, r.missing ? 5 : 3 + Math.round((LOW - r.score) / 12)); }
        else if (r.score >= HIGH) { crowd('applause'); stageRef.current?.cheer(p.id); await new Promise((res) => setTimeout(res, 1400)); }
        else await new Promise((res) => setTimeout(res, 700));
      }
      if (!alive) return;
      setSpeaker(null);
      setRevealed(Object.fromEntries(results.map((r) => [r.id, r.score])));
      setDone(true);
      blip(784, 120); setTimeout(() => blip(1046, 160), 130);
    })();
    return () => { alive = false; window.removeEventListener('stage:splat', onSplat); current.current?.stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const skip = () => { skipRef.current = true; current.current?.stop(); setSpeaker(null); setRevealed(Object.fromEntries(results.map((r) => [r.id, r.score]))); setDone(true); };

  const play = async (r: any) => {
    current.current?.stop();
    if (!r.audio) return;
    setPlaying(r.id);
    try { const pb = await playWithEffect(r.audio, effect); current.current = pb; await pb.done; } catch { /* decode failed */ }
    setPlaying(null);
  };
  const sel = results.find((r) => r.id === selected) || results[0];
  const players: StagePlayer[] = room.players.map((p) => {
    const sc = revealed[p.id];
    return { id: p.id, name: p.name, avatar: p.avatar, total: p.total, score: sc ?? null, speaker: speaker === p.id, mood: speaker === p.id ? 'speak' : sc == null ? 'idle' : sc < LOW ? 'shy' : 'idle' };
  });

  return (
    <div className="flex flex-col gap-3">
      <Stage ref={stageRef} players={players} roundLabel={`ROUND ${round.n} / ${round.of}`} phaseLabel={done ? 'RESULTS' : 'PLAYBACK'} caption={done ? `🏁 ${sound.emoji} ${sound.name}` : speaker ? `🔊 ${room.players.find((p) => p.id === speaker)?.name}'s mimic` : '🎬 Playback…'}>
        {!done && <button className="absolute right-3 bottom-3 rounded-full bg-black/50 px-3 py-1 text-xs font-bold" onClick={skip}>Skip ⏭</button>}
      </Stage>

      {done && (
        <>
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-2xl font-extrabold">🏁 Who nailed it?</h2>
              <button className="pill bg-white/10" onClick={() => playSound(sound)}>{sound.emoji} replay</button>
            </div>
            <ul className="flex flex-col gap-2">
              {results.map((r, i) => (
                <li key={r.id} onClick={() => setSelected(r.id)} className={`rounded-2xl px-3 py-2 cursor-pointer transition ${r.id === myId ? 'bg-party-yellow/20 border border-party-yellow/50' : 'bg-white/5'} ${sel?.id === r.id ? 'ring-2 ring-party-pink' : ''}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-xl w-7 text-center">{MEDALS[i] || `#${i + 1}`}</span>
                    <span className="text-2xl">{r.avatar}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold truncate">{r.name}{r.id === myId && ' (you)'}</div>
                      <div className="text-xs text-white/60">{r.title}{r.missing ? ' · no recording' : ` · pitch ${r.pitch} · rhythm ${r.rhythm}`}{r.score < LOW && ' · 🍎 booed'}</div>
                    </div>
                    <div className="text-3xl font-extrabold text-party-yellow tabular-nums">{r.score}</div>
                    <button className={`text-2xl rounded-xl px-2 py-1 ${playing === r.id ? 'bg-party-pink' : 'bg-white/10'} disabled:opacity-30`} disabled={!r.audio} onClick={(e) => { e.stopPropagation(); play(r); }} aria-label="play">{playing === r.id ? '⏹' : '▶️'}</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-extrabold">{sel ? `${sel.avatar} ${sel.name}'s mimic` : 'Mimic'}</h3>
              <span className="text-xs text-white/50">yellow = sound · pink = voice</span>
            </div>
            <PitchGraph reference={reference} contour={sel?.contour || []} height={110} />
            <div className="text-sm font-bold text-white/70 mt-3 mb-2">Play it back as…</div>
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {EFFECTS.map((e) => (
                <button key={e.id} onClick={() => { setEffect(e.id); if (sel) play(sel); }} className={`pill whitespace-nowrap !py-2 ${effect === e.id ? 'bg-party-pink' : 'bg-white/10'}`}>{e.emoji} {e.name}</button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="font-extrabold mb-2">📊 Standings</h3>
            <ul className="flex flex-col gap-1">
              {room.standings.map((s: any, i: number) => (
                <li key={s.id} className="flex items-center gap-2 text-sm"><span className="w-5 text-white/50">{i + 1}.</span><span>{s.avatar}</span><span className="flex-1 font-bold">{s.name}</span><span className="font-extrabold tabular-nums">{s.total}</span></li>
              ))}
            </ul>
          </div>

          {isHost ? (
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={() => net.emit('round:start')}>{isLast ? '🏆 Final results' : '➡️ Next round'}</button>
              {!isLast && <button className="btn-ghost" onClick={() => net.emit('game:end')}>End</button>}
            </div>
          ) : <p className="text-center text-white/60">Waiting for the host… ⏳</p>}
        </>
      )}
    </div>
  );
}
