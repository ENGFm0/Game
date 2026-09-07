import { useEffect, useRef, useState } from 'react';
import type { Ctx } from '../App';
import { soundById, referenceContour } from '../../shared/sounds.js';
import { EFFECTS, EffectId, playWithEffect, Playback } from '../audio/effects';
import { playSound, SoundDef, blip } from '../audio/synth';
import { hzToSemitone } from '../audio/pitch';
import PitchGraph from '../components/PitchGraph';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function ResultsScreen({ ctx }: { ctx: Ctx }) {
  const { net, room, myId, isHost, roundResults } = ctx;
  const round = room.round!;
  const sound = soundById(round.soundId) as SoundDef;
  const results: any[] = roundResults?.results || round.results || [];
  const [effect, setEffect] = useState<EffectId>('chipmunk');
  const [playing, setPlaying] = useState<string | null>(null);
  const current = useRef<Playback | null>(null);
  const [selected, setSelected] = useState<string>(() => myId);
  const reference = referenceContour(sound, 40).map((p: any) => (p.f == null ? null : hzToSemitone(p.f)));
  const isLast = round.n >= round.of;

  useEffect(() => { blip(784, 120); setTimeout(() => blip(1046, 160), 130); return () => current.current?.stop(); }, []);

  const play = async (r: any) => {
    current.current?.stop();
    if (!r.audio) return;
    setPlaying(r.id);
    try { const pb = await playWithEffect(r.audio, effect); current.current = pb; await pb.done; } catch { /* decode failed */ }
    setPlaying(null);
  };
  const sel = results.find((r) => r.id === selected) || results[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-white/70 text-sm font-bold">
        <span>Round {round.n} / {round.of} — results</span>
        <button className="pill bg-white/10" onClick={() => playSound(sound)}>{sound.emoji} replay sound</button>
      </div>

      <div className="card">
        <h2 className="text-2xl font-extrabold mb-3">🏁 Who nailed it?</h2>
        <ul className="flex flex-col gap-2">
          {results.map((r, i) => (
            <li key={r.id} onClick={() => setSelected(r.id)} className={`rounded-2xl px-3 py-2 cursor-pointer transition ${r.id === myId ? 'bg-party-yellow/20 border border-party-yellow/50' : 'bg-white/5'} ${sel?.id === r.id ? 'ring-2 ring-party-pink' : ''}`}>
              <div className="flex items-center gap-3">
                <span className="text-xl w-7 text-center">{MEDALS[i] || `#${i + 1}`}</span>
                <span className="text-2xl">{r.avatar}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{r.name}{r.id === myId && ' (you)'}</div>
                  <div className="text-xs text-white/60">{r.title}{r.missing ? ' · no recording' : ` · pitch ${r.pitch} · rhythm ${r.rhythm}`}</div>
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
        <PitchGraph reference={reference} contour={sel?.contour || []} height={120} />
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
    </div>
  );
}
