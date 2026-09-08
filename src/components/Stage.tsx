import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

/**
 * The party stage: score cards on top, blocky characters on a wooden stage with a mic,
 * a live waveform at the bottom, and an audience that throws apples at low scores.
 */
export interface StagePlayer {
  id: string; name: string; avatar: string; total: number;
  score?: number | null;              // shown on the card when set (e.g. live match or round score)
  mood?: 'idle' | 'sing' | 'speak' | 'hit' | 'cheer' | 'shy';
  level?: number;                     // 0..1 mouth/bounce intensity while singing
  speaker?: boolean;                  // green speaker icon above the head (playback)
}
export interface StageHandle { throwApples: (playerId: string, count?: number) => Promise<void>; cheer: (playerId: string) => void }

const BODY_COLORS = ['#ff4fa3', '#3fa9ff', '#3ddc97', '#ffd23f', '#a78bfa', '#fb923c', '#f472b6', '#22d3ee', '#84cc16', '#f87171', '#facc15', '#c084fc'];

const Stage = forwardRef<StageHandle, {
  players: StagePlayer[]; roundLabel: string; phaseLabel: string; caption?: string;
  wave?: number[] | null; progress?: number | null; children?: React.ReactNode;
}>(function Stage({ players, roundLabel, phaseLabel, caption, wave, progress, children }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const chars = useRef(new Map<string, HTMLDivElement>());
  const [effects, setEffects] = useState<Record<string, 'hit' | 'cheer' | undefined>>({});
  const [splats, setSplats] = useState<{ id: string; key: number; x: number; y: number }[]>([]);

  useImperativeHandle(ref, () => ({
    async throwApples(playerId, count = 4) {
      const target = chars.current.get(playerId), stage = root.current;
      if (!target || !stage) return;
      const sr = stage.getBoundingClientRect(), tr = target.getBoundingClientRect();
      const tx = tr.left - sr.left + tr.width / 2, ty = tr.top - sr.top + tr.height * 0.35;
      const jobs: Promise<void>[] = [];
      for (let i = 0; i < count; i++) {
        jobs.push(new Promise((res) => setTimeout(async () => {
          const apple = document.createElement('div');
          apple.textContent = Math.random() < 0.8 ? '🍎' : '🍅';
          apple.className = 'absolute text-3xl pointer-events-none select-none z-20';
          const fromX = Math.random() < 0.5 ? -20 + Math.random() * 40 : sr.width - 20 + Math.random() * 40;
          const fromY = sr.height - 10;
          apple.style.left = '0px'; apple.style.top = '0px';
          stage.appendChild(apple);
          const midX = (fromX + tx) / 2, midY = Math.min(fromY, ty) - 90 - Math.random() * 60;
          const anim = apple.animate([
            { transform: `translate(${fromX}px, ${fromY}px) rotate(0deg)` },
            { transform: `translate(${midX}px, ${midY}px) rotate(200deg)` },
            { transform: `translate(${tx + (Math.random() - 0.5) * 30}px, ${ty + (Math.random() - 0.5) * 30}px) rotate(400deg)` },
          ], { duration: 520 + Math.random() * 120, easing: 'ease-in' });
          await anim.finished.catch(() => {});
          apple.remove();
          const key = Date.now() + i;
          setSplats((s) => [...s, { id: playerId, key, x: tx - sr.left * 0 + (Math.random() - 0.5) * 30, y: ty + (Math.random() - 0.5) * 30 }]);
          setEffects((e) => ({ ...e, [playerId]: 'hit' }));
          window.dispatchEvent(new CustomEvent('stage:splat'));
          setTimeout(() => setSplats((s) => s.filter((p) => p.key !== key)), 900);
          setTimeout(() => setEffects((e) => (e[playerId] === 'hit' ? { ...e, [playerId]: undefined } : e)), 500);
          res();
        }, i * 260)));
      }
      await Promise.all(jobs);
    },
    cheer(playerId) {
      setEffects((e) => ({ ...e, [playerId]: 'cheer' }));
      setTimeout(() => setEffects((e) => ({ ...e, [playerId]: undefined })), 1800);
    },
  }), []);

  return (
    <div ref={root} className="relative overflow-hidden rounded-3xl border border-white/10 shadow-2xl select-none" style={{ background: 'linear-gradient(#4a2530 0 58%, #c77a2f 58%, #a35e22 100%)', minHeight: 360 }}>
      {/* wall decorations */}
      <div className="absolute left-3 top-10 text-4xl opacity-90">🛋️</div>
      <div className="absolute right-3 top-14 text-3xl opacity-90">🧸</div>
      <div className="absolute left-0 right-0 top-2 flex justify-between px-6 text-xs opacity-70">{Array.from({ length: 9 }, (_, i) => <span key={i} className="text-party-yellow">•</span>)}</div>
      {/* floor planks */}
      <div className="absolute inset-x-0 bottom-0" style={{ top: '58%', backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,.12) 0 2px, transparent 2px 46px)' }} />

      {/* round + phase badge */}
      <div className="absolute left-3 top-3 rounded-2xl bg-black/35 px-3 py-1.5 text-center leading-tight">
        <div className="font-extrabold text-party-pink text-sm tracking-wide">{roundLabel}</div>
        <div className="text-[11px] font-bold tracking-[.2em] text-white/70">{phaseLabel}</div>
      </div>

      {/* score cards */}
      <div className="absolute left-1/2 -translate-x-1/2 top-2 flex -space-x-2">
        {players.map((p, i) => (
          <div key={p.id} className="w-14 rounded-lg bg-white text-party-ink shadow-md px-1 pt-1 pb-1 text-center" style={{ transform: `rotate(${(i - (players.length - 1) / 2) * 5}deg)` }}>
            <div className="text-xl leading-none">{p.avatar}</div>
            <div className="text-[9px] font-extrabold truncate uppercase">{p.name}</div>
            <div className="text-sm font-black text-orange-500 leading-none">{p.score ?? p.total}</div>
          </div>
        ))}
      </div>

      {/* characters */}
      <div className="absolute inset-x-2 flex items-end justify-around" style={{ top: '30%', bottom: wave ? 92 : 40 }}>
        {players.map((p, i) => {
          const fx = effects[p.id] || p.mood || 'idle';
          const lvl = Math.min(1, p.level || 0);
          return (
            <div key={p.id} ref={(el) => { if (el) chars.current.set(p.id, el); }} className={`relative flex flex-col items-center transition-transform ${fx === 'hit' ? 'animate-[shake_.5s_ease-in-out]' : fx === 'cheer' ? 'animate-[hop_.6s_ease-in-out_3]' : fx === 'sing' ? 'animate-pulse2' : ''}`} style={{ width: 84 }}>
              {p.speaker && <div className="text-2xl text-party-mint animate-pulse mb-1">🔊</div>}
              <div className="text-[13px] font-extrabold text-white/90 mb-1 truncate max-w-[84px]">{p.name}</div>
              {/* head */}
              <div className="text-5xl leading-none" style={{ transform: fx === 'sing' ? `scale(${1 + lvl * 0.25})` : fx === 'shy' ? 'rotate(8deg)' : 'none', transition: 'transform .08s' }}>{p.avatar}</div>
              {/* body */}
              <div className="mt-0.5 h-14 w-11 rounded-2xl rounded-b-md shadow-lg relative" style={{ background: BODY_COLORS[i % BODY_COLORS.length] }}>
                <div className="absolute -left-2 top-2 h-8 w-3 rounded-full" style={{ background: BODY_COLORS[i % BODY_COLORS.length], transform: fx === 'cheer' ? 'rotate(-150deg)' : fx === 'sing' ? 'rotate(-25deg)' : 'rotate(10deg)', transformOrigin: 'top', transition: 'transform .3s' }} />
                <div className="absolute -right-2 top-2 h-8 w-3 rounded-full" style={{ background: BODY_COLORS[i % BODY_COLORS.length], transform: fx === 'cheer' ? 'rotate(150deg)' : fx === 'sing' ? 'rotate(25deg)' : 'rotate(-10deg)', transformOrigin: 'top', transition: 'transform .3s' }} />
              </div>
              <div className="flex gap-1"><div className="h-4 w-4 rounded-b-lg bg-slate-800" /><div className="h-4 w-4 rounded-b-lg bg-slate-800" /></div>
              {fx === 'hit' && <div className="absolute -top-2 text-3xl animate-pop">💥</div>}
              {fx === 'cheer' && <div className="absolute -top-3 text-2xl animate-pop">🎉</div>}
            </div>
          );
        })}
        {/* microphone */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 flex flex-col items-center pointer-events-none">
          <div className="text-2xl">🎤</div><div className="h-10 w-0.5 bg-slate-900" /><div className="h-1.5 w-8 rounded-full bg-slate-900" />
        </div>
      </div>

      {/* splats */}
      {splats.map((s) => <div key={s.key} className="absolute text-3xl pointer-events-none z-30" style={{ left: s.x - 16, top: s.y - 16 }}>🍎</div>)}

      {/* caption */}
      {caption && <div className="absolute left-1/2 -translate-x-1/2 top-[27%] rounded-full bg-black/40 px-3 py-1 text-sm font-bold text-white whitespace-nowrap">{caption}</div>}

      {/* waveform bar */}
      {wave && (
        <div className="absolute inset-x-3 bottom-3 h-[76px] rounded-2xl border-2 border-cyan-300 bg-black/70 overflow-hidden">
          <div className="absolute inset-0 flex items-center gap-[2px] px-2">
            {wave.map((v, i) => <div key={i} className="flex-1 rounded-sm bg-cyan-300" style={{ height: `${Math.max(4, Math.min(100, v * 100))}%`, opacity: 0.5 + v * 0.5 }} />)}
          </div>
          {progress != null && <div className="absolute top-0 bottom-0 w-[3px] bg-red-500" style={{ left: `${progress * 100}%` }} />}
        </div>
      )}
      {children}
      <style>{`@keyframes shake{0%,100%{transform:translateX(0) rotate(0)}20%{transform:translateX(-8px) rotate(-6deg)}40%{transform:translateX(8px) rotate(6deg)}60%{transform:translateX(-6px) rotate(-4deg)}80%{transform:translateX(6px) rotate(4deg)}}@keyframes hop{0%,100%{transform:translateY(0)}50%{transform:translateY(-22px)}}`}</style>
    </div>
  );
});
export default Stage;
