import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { unlockAudio, blip } from '../audio/synth';
import { SOUNDS } from '../../shared/sounds.js';
import SoundManager from '../components/SoundManager';

export default function LobbyScreen({ ctx }: { ctx: Ctx }) {
  const { net, room, myId, isHost, recorder, micReady, setMicReady, toast } = ctx;
  const me = room.players.find((p) => p.id === myId)!;
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const allReady = room.players.every((p) => p.ready);

  useEffect(() => {
    if (!micReady) return;
    const t = setInterval(() => setLevel(recorder.level()), 60);
    return () => clearInterval(t);
  }, [micReady, recorder]);

  const enableMic = async () => {
    setBusy(true);
    try { await unlockAudio(); await recorder.init(); setMicReady(true); blip(880, 80); toast('Mic ready — make some noise to test it!'); }
    catch (e: any) { toast(e.message, 5000); }
    finally { setBusy(false); }
  };
  const toggleReady = () => { blip(me.ready ? 440 : 1320, 70); net.emit('player:ready', { ready: !me.ready }); };
  const start = () => net.emit('round:start', {}, (r: any) => { if (r && r.ok) blip(1046, 120); });
  const share = async () => {
    const url = `${location.origin}${location.pathname}?room=${room.code}`;
    try { if (navigator.share) await navigator.share({ title: 'Mimic Party', text: `Join my Mimic Party room ${room.code}`, url }); else { await navigator.clipboard.writeText(url); toast('Link copied'); } } catch { /* cancelled */ }
  };
  const leave = () => { net.emit('room:leave'); location.href = location.pathname; };

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-white/60">Room code</div>
          <div className="text-4xl font-extrabold tracking-[.3em]">{room.code}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost !py-2 !px-3 !text-sm" onClick={share}>Share</button>
          <button className="btn-ghost !py-2 !px-3 !text-sm" onClick={leave}>Leave</button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-extrabold text-lg">Players <span className="text-white/50">({room.players.length})</span></h2>
          {isHost && <span className="pill bg-party-grape/60">👑 you're the host</span>}
        </div>
        <ul className="flex flex-col gap-2">
          {room.players.map((p) => (
            <li key={p.id} className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${p.id === myId ? 'bg-white/15' : 'bg-white/5'}`}>
              <span className="text-2xl">{p.avatar}</span>
              <span className="font-bold flex-1">{p.name}{p.id === room.hostId && ' 👑'}</span>
              <span className={`pill ${p.ready ? 'bg-party-mint text-party-ink' : 'bg-white/10 text-white/60'}`}>{p.ready ? '✓ ready' : 'not ready'}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card flex flex-col gap-3">
        {!micReady ? (
          <>
            <p className="text-white/80">Step 1 — turn on your microphone. We only listen while recording.</p>
            <button className="btn-pink w-full" onClick={enableMic} disabled={busy}>🎙️ Enable microphone</button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎙️</span>
              <div className="flex-1 h-3 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-party-mint via-party-yellow to-party-pink transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} /></div>
            </div>
            <button className={`${me.ready ? 'btn-ghost' : 'btn-mint'} w-full`} onClick={toggleReady}>{me.ready ? 'Not ready yet…' : "✅ I'm ready!"}</button>
          </>
        )}
      </div>

      {isHost && <SoundManager ctx={ctx} />}

      {isHost ? (
        <div className="card flex flex-col gap-3">
          <label className="flex items-center justify-between font-bold">Rounds
            <select className="input !w-28 !py-2" value={room.settings.rounds} onChange={(e) => net.emit('room:settings', { rounds: Number(e.target.value) })}>
              {[1, 2, 3, 5, 7, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn-primary w-full text-xl" onClick={start} disabled={!allReady}>{allReady ? '🚀 Start the party' : 'Waiting for everyone to be ready…'}</button>
          <p className="text-xs text-white/50 text-center">{SOUNDS.length} built-in sounds{room.sounds?.custom.length ? ` + ${room.sounds.custom.length} of yours` : ''}. Playing alone? Just tap Start.</p>
        </div>
      ) : (
        <p className="text-center text-white/60">Waiting for the host to start… ⏳</p>
      )}
    </div>
  );
}
