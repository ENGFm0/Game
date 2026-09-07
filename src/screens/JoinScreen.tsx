import { useEffect, useState } from 'react';
import type { Net } from '../net/transport';

const AVATARS = ['🦁', '🐸', '🐙', '🦄', '🐧', '🐯', '🦊', '🐼', '🐨', '🐵', '🦖', '🐷'];

export default function JoinScreen({ net, toast }: { net: Net; toast: (m: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem('mimic.name') || '');
  const [avatar, setAvatar] = useState(() => localStorage.getItem('mimic.avatar') || AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  const [code, setCode] = useState(() => (new URLSearchParams(location.search).get('room') || '').toUpperCase());
  const [busy, setBusy] = useState(false);

  useEffect(() => { localStorage.setItem('mimic.name', name); localStorage.setItem('mimic.avatar', avatar); }, [name, avatar]);

  const ok = () => { if (name.trim().length < 1) { toast('Type your name first'); return false; } return true; };
  const create = () => { if (!ok()) return; setBusy(true); net.emit('room:create', { name: name.trim(), avatar }); setTimeout(() => setBusy(false), 4000); };
  const join = () => { if (!ok()) return; if (code.trim().length !== 4) return toast('Room codes have 4 characters'); setBusy(true); net.emit('room:join', { code: code.trim().toUpperCase(), name: name.trim(), avatar }); setTimeout(() => setBusy(false), 4000); };

  return (
    <div className="flex-1 flex flex-col gap-5 justify-center">
      <div className="text-center animate-pop">
        <div className="text-7xl animate-wiggle inline-block">🎤</div>
        <h1 className="text-5xl font-extrabold mt-2 tracking-tight">Mimic <span className="text-party-yellow">Party</span></h1>
        <p className="text-white/70 mt-1">Hear a sound. Everyone mimics it at once. Get judged. 😈</p>
      </div>

      <div className="card flex flex-col gap-4">
        <label className="text-sm font-bold text-white/70">Your name
          <input className="input mt-1" value={name} maxLength={16} placeholder="e.g. Fahad" onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </label>
        <div>
          <div className="text-sm font-bold text-white/70 mb-2">Pick your face</div>
          <div className="grid grid-cols-6 gap-2">
            {AVATARS.map((a) => (
              <button key={a} onClick={() => setAvatar(a)} className={`text-3xl rounded-2xl py-2 transition ${avatar === a ? 'bg-party-yellow scale-110 shadow-lg' : 'bg-white/10'}`}>{a}</button>
            ))}
          </div>
        </div>
        <button className="btn-primary w-full" onClick={create} disabled={busy}>🎉 Create a room</button>
        <div className="flex items-center gap-3 text-white/50 text-sm"><span className="flex-1 h-px bg-white/15" />or join with a code<span className="flex-1 h-px bg-white/15" /></div>
        <div className="flex gap-2">
          <input className="input uppercase tracking-[.4em] text-center font-extrabold" value={code} maxLength={4} placeholder="CODE" onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" />
          <button className="btn-mint" onClick={join} disabled={busy}>Join</button>
        </div>
      </div>

      <p className="text-center text-xs text-white/50">
        {net.mode === 'peer' ? 'Serverless mode: the room lives on the host phone — the host keeps the page open.' : 'Connected to the game server.'} Needs a microphone: Safari on iPhone, Chrome on Android.
      </p>
    </div>
  );
}
