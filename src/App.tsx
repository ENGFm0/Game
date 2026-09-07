import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNet, Net } from './net/transport';
import { MimicRecorder } from './audio/recorder';
import JoinScreen from './screens/JoinScreen';
import LobbyScreen from './screens/LobbyScreen';
import RoundScreen from './screens/RoundScreen';
import ResultsScreen from './screens/ResultsScreen';
import FinalScreen from './screens/FinalScreen';

export interface Player { id: string; name: string; avatar: string; ready: boolean; total: number; submitted: boolean; lastScore: number | null }
export interface RoundInfo { n: number; of: number; soundId: string; listenAt: number; recordAt: number; recordEndAt: number; submitDeadline: number; results: any[] | null }
export interface Room { code: string; hostId: string; phase: 'lobby' | 'listen' | 'record' | 'results' | 'final'; settings: { rounds: number; countdownMs: number }; serverNow: number; players: Player[]; round: RoundInfo | null; standings: any[] }

export interface Ctx {
  net: Net; room: Room; myId: string; isHost: boolean; hostNow: () => number;
  recorder: MimicRecorder; micReady: boolean; setMicReady: (v: boolean) => void;
  roundResults: any | null; toast: (m: string, ms?: number) => void;
}

const recorder = new MimicRecorder();

export default function App() {
  const [net, setNet] = useState<Net | null>(null);
  const [netError, setNetError] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [myId, setMyId] = useState('');
  const [micReady, setMicReady] = useState(false);
  const [roundResults, setRoundResults] = useState<any | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const offsetRef = useRef(0);
  const toastTimer = useRef(0);

  const toast = useCallback((m: string, ms = 2800) => { setToastMsg(m); clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToastMsg(''), ms); }, []);
  const hostNow = useCallback(() => Date.now() + offsetRef.current, []);

  useEffect(() => {
    let alive = true;
    createNet().then((n) => {
      if (!alive) return;
      n.on('room:joined', async ({ id }: any) => {
        setMyId(id);
        offsetRef.current = await n.syncClock();
        setInterval(async () => { offsetRef.current = await n.syncClock(); }, 20000);
      });
      n.on('room:state', (r: Room) => { setRoom(r); });
      n.on('round:start', () => setRoundResults(null));
      n.on('round:results', (res: any) => setRoundResults(res));
      n.on('error:msg', ({ message }: any) => toast(message, 4000));
      n.on('room:closed', ({ message }: any) => { toast(message, 5000); setRoom(null); });
      n.on('disconnect', () => toast('Connection lost — reconnecting…'));
      setNet(n);
    }).catch((e) => setNetError(e.message || 'Could not connect'));
    return () => { alive = false; };
  }, [toast]);

  const ctx = useMemo<Ctx | null>(() => (net && room && myId ? { net, room, myId, isHost: room.hostId === myId, hostNow, recorder, micReady, setMicReady, roundResults, toast } : null), [net, room, myId, hostNow, micReady, roundResults, toast]);

  let screen: JSX.Element;
  if (netError) screen = <Center><div className="card text-center">😵 {netError}</div></Center>;
  else if (!net) screen = <Center><div className="text-2xl animate-pulse">Connecting… 🎤</div></Center>;
  else if (!ctx) screen = <JoinScreen net={net} toast={toast} />;
  else if (ctx.room.phase === 'lobby') screen = <LobbyScreen ctx={ctx} />;
  else if (ctx.room.phase === 'listen' || ctx.room.phase === 'record') screen = <RoundScreen ctx={ctx} />;
  else if (ctx.room.phase === 'results') screen = <ResultsScreen ctx={ctx} />;
  else screen = <FinalScreen ctx={ctx} />;

  return (
    <div className="min-h-full flex flex-col max-w-md mx-auto px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
      {screen}
      <div className={`fixed left-1/2 -translate-x-1/2 bottom-6 z-50 rounded-full bg-white text-party-ink px-5 py-3 font-bold shadow-2xl transition ${toastMsg ? 'opacity-100' : 'opacity-0 translate-y-3 pointer-events-none'}`} role="status">{toastMsg}</div>
    </div>
  );
}

export function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 grid place-items-center min-h-[80vh]">{children}</div>;
}
