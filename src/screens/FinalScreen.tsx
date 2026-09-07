import { useEffect } from 'react';
import type { Ctx } from '../App';
import { blip } from '../audio/synth';

export default function FinalScreen({ ctx }: { ctx: Ctx }) {
  const { net, room, myId, isHost } = ctx;
  const s = room.standings;
  const podium = [s[1], s[0], s[2]].filter(Boolean);
  const heights = ['h-24', 'h-36', 'h-16'];

  useEffect(() => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 180, 'triangle', 0.3), i * 140)); }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center animate-pop">
        <div className="text-7xl">🏆</div>
        <h1 className="text-4xl font-extrabold">{s[0] ? `${s[0].name} wins!` : 'Game over'}</h1>
        <p className="text-white/70">{s[0]?.id === myId ? 'Golden throat confirmed. 🎤' : 'Better luck next round of noises.'}</p>
      </div>

      <div className="card">
        <div className="flex items-end justify-center gap-3">
          {podium.map((p: any, i: number) => (
            <div key={p.id} className="flex flex-col items-center w-24">
              <div className="text-4xl">{p.avatar}</div>
              <div className="font-bold text-sm truncate max-w-full">{p.name}</div>
              <div className={`w-full ${heights[i]} rounded-t-2xl mt-1 grid place-items-center text-2xl font-extrabold ${i === 1 ? 'bg-party-yellow text-party-ink' : i === 0 ? 'bg-white/30' : 'bg-orange-400/70'}`}>{p.total}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="font-extrabold mb-2">Full standings</h3>
        <ul className="flex flex-col gap-1">
          {s.map((p: any, i: number) => (
            <li key={p.id} className={`flex items-center gap-2 rounded-xl px-2 py-1 ${p.id === myId ? 'bg-white/10' : ''}`}>
              <span className="w-5 text-white/50">{i + 1}.</span><span>{p.avatar}</span><span className="flex-1 font-bold">{p.name}</span>
              <span className="text-xs text-white/50">{(p.rounds || []).join(' · ')}</span><span className="font-extrabold tabular-nums">{p.total}</span>
            </li>
          ))}
        </ul>
      </div>

      {isHost ? <button className="btn-primary w-full" onClick={() => net.emit('game:reset')}>🔁 Play again</button> : <p className="text-center text-white/60">The host can start a new game.</p>}
    </div>
  );
}
