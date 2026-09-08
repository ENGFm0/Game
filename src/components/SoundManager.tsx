import { useEffect, useRef, useState } from 'react';
import type { Ctx } from '../App';
import { analyzeClip } from '../audio/analyze';
import { playSound, SoundDef } from '../audio/synth';
import { CUSTOM_LIMITS, SOUNDS } from '../../shared/sounds.js';

/** Host-only lobby panel: add your own sounds by recording (≤ 4 s) or uploading, toggle the built-in set. */
export default function SoundManager({ ctx }: { ctx: Ctx }) {
  const { net, room, recorder, micReady, toast } = ctx;
  const [busy, setBusy] = useState<'' | 'recording' | 'analyzing'>('');
  const [countdown, setCountdown] = useState(0);
  const [draft, setDraft] = useState<(SoundDef & { voicedRatio: number }) | null>(null);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const localCache = useRef(new Map<string, SoundDef>());   // host keeps the audio to preview
  const sounds = room.sounds || { builtIn: true, custom: [] };

  useEffect(() => () => { /* nothing to clean */ }, []);

  const finish = async (blob: Blob) => {
    setBusy('analyzing');
    try {
      const a = await analyzeClip(blob);
      setDraft({ id: 'draft', name: '', emoji: '🎵', hint: '', custom: true, ...a });
      setName('');
    } catch (e: any) { toast(e.message, 5000); }
    finally { setBusy(''); }
  };

  const record = async () => {
    if (!micReady || !recorder.ready) return toast('Enable your microphone first');
    setBusy('recording');
    recorder.start();
    let left = 4; setCountdown(left);
    const t = setInterval(() => { left -= 1; setCountdown(left); if (left <= 0) clearInterval(t); }, 1000);
    await new Promise((r) => setTimeout(r, 4200));
    const rec = await recorder.stop();
    await finish(rec.blob);
  };

  const upload = async (file: File | undefined) => { if (!file) return; if (file.size > 12e6) return toast('File too big (max 12 MB)'); await finish(file); };

  const add = () => {
    if (!draft) return;
    const payload = { name: name.trim() || 'My sound', audio: draft.audio, durationMs: draft.durationMs, contour: draft.contour, onsets: draft.onsets };
    net.emit('room:addSound', payload, (r: any) => {
      if (r?.ok) { localCache.current.set(r.id, { ...draft, id: r.id, name: payload.name }); setDraft(null); toast(`Added "${payload.name}" 🎵`); }
      else if (r?.error) toast(r.error, 5000);
    });
  };

  const preview = (id: string) => { const s = localCache.current.get(id); if (s) playSound(s); else toast('Preview is only available on the phone that added it'); };

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-extrabold text-lg">🎵 Sounds</h2>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="accent-party-yellow w-4 h-4" checked={sounds.builtIn} disabled={!sounds.custom.length} onChange={(e) => net.emit('room:builtIn', { enabled: e.target.checked })} />
          built-in ({SOUNDS.length})
        </label>
      </div>

      {sounds.custom.length > 0 && (
        <ul className="flex flex-col gap-1">
          {sounds.custom.map((s: any) => (
            <li key={s.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
              <span>🎵</span><span className="font-bold flex-1 truncate">{s.name}</span><span className="text-white/50">{(s.durationMs / 1000).toFixed(1)} s</span>
              <button className="px-2" onClick={() => preview(s.id)}>▶️</button>
              <button className="px-2 text-white/50" onClick={() => net.emit('room:removeSound', { id: s.id })}>✕</button>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div className="rounded-2xl bg-white/10 p-3 flex flex-col gap-2">
          <div className="text-sm text-white/80">Clip: {(draft.durationMs! / 1000).toFixed(1)} s · pitch found in {Math.round(draft.voicedRatio * 100)}% of it</div>
          <div className="flex gap-2">
            <input className="input !py-2" placeholder="Name it (e.g. Grandpa's sneeze)" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-ghost !py-2 !px-3" onClick={() => playSound(draft)}>▶️</button>
          </div>
          <div className="flex gap-2">
            <button className="btn-mint flex-1 !py-2" onClick={add}>✅ Add to the party</button>
            <button className="btn-ghost !py-2" onClick={() => setDraft(null)}>Discard</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button className="btn-pink flex-1 !py-3 !text-base" disabled={busy !== '' || sounds.custom.length >= CUSTOM_LIMITS.maxSounds} onClick={record}>
            {busy === 'recording' ? `🔴 Recording… ${countdown}` : busy === 'analyzing' ? '🧠 Analysing…' : '🎙️ Record a sound'}
          </button>
          <button className="btn-ghost !py-3 !text-base" disabled={busy !== '' || sounds.custom.length >= CUSTOM_LIMITS.maxSounds} onClick={() => fileRef.current?.click()}>📁 Upload</button>
          <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </div>
      )}
      <p className="text-xs text-white/50">Record up to 4 seconds of anything with a tune — a meow, a doorbell, a sneeze. Everyone gets it automatically. Noise without pitch (clapping, hissing) can't be scored.</p>
    </div>
  );
}
