import { useEffect, useRef } from 'react';

/**
 * Draws the reference pitch contour (yellow) and a performance contour (pink) in semitones.
 * Both arrays share the same time axis (one point per step). Nulls are gaps (silence).
 */
export default function PitchGraph({ reference, contour, live = false, height = 140 }: { reference: (number | null)[]; contour: (number | null)[]; live?: boolean; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = height;
    c.width = W * dpr; c.height = H * dpr;
    const x = c.getContext('2d')!; x.scale(dpr, dpr);
    x.clearRect(0, 0, W, H);

    const vals = [...reference, ...contour].filter((v): v is number => v != null);
    const lo = Math.min(-6, ...vals) - 2, hi = Math.max(6, ...vals) + 2;
    const n = Math.max(reference.length, contour.length, 2);
    const px = (i: number) => (i / (n - 1)) * (W - 8) + 4;
    const py = (v: number) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12);

    // grid
    x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 1;
    for (let v = Math.ceil(lo / 3) * 3; v <= hi; v += 3) { x.beginPath(); x.moveTo(0, py(v)); x.lineTo(W, py(v)); x.stroke(); }

    const draw = (arr: (number | null)[], color: string, width: number, glow = false) => {
      x.strokeStyle = color; x.lineWidth = width; x.lineCap = 'round'; x.lineJoin = 'round';
      if (glow) { x.shadowColor = color; x.shadowBlur = 10; } else x.shadowBlur = 0;
      let pen = false;
      x.beginPath();
      arr.forEach((v, i) => { if (v == null) { pen = false; return; } if (!pen) { x.moveTo(px(i), py(v)); pen = true; } else x.lineTo(px(i), py(v)); });
      x.stroke(); x.shadowBlur = 0;
    };
    draw(reference, 'rgba(255,210,63,.9)', 4);
    draw(contour, live ? '#ff4fa3' : 'rgba(255,79,163,.95)', 3, live);
    if (live) {
      const last = [...contour].reverse().find((v) => v != null);
      const idx = contour.length - 1;
      x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(px(Math.min(idx, n - 1)), 0, 2, H);
      if (last != null) { x.fillStyle = '#fff'; x.beginPath(); x.arc(px(idx), py(last), 5, 0, Math.PI * 2); x.fill(); }
    }
  }, [reference, contour, live, height]);

  return <canvas ref={ref} className="w-full rounded-2xl bg-black/30" style={{ height }} />;
}
