import React from 'react';

export type PixiUnderlayHandle = {
  emitTransmit: (fromId: string, toId: string, size?: number) => void;
  pulseNode: (nodeId: string) => void;
  setViewport: (vp: { x: number; y: number; zoom: number }) => void;
  setSize: (w: number, h: number) => void;
};

type NodeLike = { id: string; position: { x: number; y: number } };

type Props = {
  nodes: NodeLike[];
  viewport: { x: number; y: number; zoom: number };
  width: number;
  height: number;
  throughput?: number;
  className?: string;
};

// 2D particle/ribbon/halo state
type P2 = {
  x0: number; y0: number; x1: number; y1: number;
  t: number; speed: number; life: number; r: number; color: number;
};
type R2 = {
  x0: number; y0: number; x1: number; y1: number;
  t: number; speed: number; life: number; len: number; w: number; color: number;
};
type H2 = { x: number; y: number; t: number; life: number };

function hslToHexNumber(h: number, s: number, l: number): number {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(255 * f(0));
  const g = Math.round(255 * f(8));
  const b = Math.round(255 * f(4));
  return (r & 255) << 16 | (g & 255) << 8 | (b & 255);
}
function hexToRgb(n: number) {
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function roleColorForId(id: string): number | null {
  const s = (id || '').toLowerCase();
  if (/perception|sense|vision|input/.test(s)) return hslToHexNumber(190, 85, 55);
  if (/memory|store|recall/.test(s)) return hslToHexNumber(260, 70, 62);
  if (/planning|plan|reason|think/.test(s)) return hslToHexNumber(45, 90, 55);
  if (/ego|core|self|execut/.test(s)) return hslToHexNumber(290, 70, 65);
  if (/actuator|action|output|motor/.test(s)) return hslToHexNumber(130, 70, 55);
  return null;
}

const CanvasUnderlay = React.forwardRef(function CanvasUnderlay(
  { nodes, viewport, width, height, throughput = 0, className }: Props,
  ref: React.Ref<PixiUnderlayHandle>
) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);

  const idToPos = React.useRef(new Map<string, { x: number; y: number }>());
  const particles = React.useRef<P2[]>([]);
  const ribbons = React.useRef<R2[]>([]);
  const halos = React.useRef<H2[]>([]);

  const budgetsRef = React.useRef({ maxParticles: 300, maxRibbons: 140, fpsAvg: 60 });
  const camRef = React.useRef({ x: 0, y: 0, zoom: 1 });
  const animRef = React.useRef<number | null>(null);
  const lastTsRef = React.useRef<number>(performance.now());

  React.useEffect(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of nodes) m.set(n.id, { x: n.position.x, y: n.position.y });
    idToPos.current = m;
  }, [nodes]);

  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = Math.max(1, width);
    c.height = Math.max(1, height);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctxRef.current = ctx;

    const tick = (ts: number) => {
      const ctx2 = ctxRef.current;
      if (!ctx2) return;
      const dtMs = ts - lastTsRef.current;
      lastTsRef.current = ts;

      // FPS smoothing for budgets
      const d = Math.max(1, dtMs);
      const instFps = 1000 / d;
      budgetsRef.current.fpsAvg = budgetsRef.current.fpsAvg * 0.9 + instFps * 0.1;
      const fps = budgetsRef.current.fpsAvg;
      if (fps < 45) {
        budgetsRef.current.maxParticles = Math.max(120, budgetsRef.current.maxParticles - 4);
        budgetsRef.current.maxRibbons = Math.max(60, budgetsRef.current.maxRibbons - 2);
      } else if (fps > 55) {
        budgetsRef.current.maxParticles = Math.min(360, budgetsRef.current.maxParticles + 2);
        budgetsRef.current.maxRibbons = Math.min(180, budgetsRef.current.maxRibbons + 1);
      }

      // Background "subconscious waves" via radial gradients and parallax
      // Background "subconscious waves" via radial gradients and parallax
      const cam = camRef.current;
      // Deep Space Theme Colors
      const base1 = hslToHexNumber(240, 20, 10); // Very dark blue
      const base2 = hslToHexNumber(260, 30, 15); // Dark purple
      const { r: r1, g: g1, b: b1 } = hexToRgb(base1);
      const { r: r2, g: g2, b: b2 } = hexToRgb(base2);
      const breath = 0.85 + 0.15 * Math.sin(ts * 0.0015);
      ctx2.clearRect(0, 0, c.width, c.height);

      // Deep layer
      const grad1 = ctx2.createRadialGradient(
        c.width * 0.5 - cam.x * 0.04, c.height * 0.5 - cam.y * 0.04, 0,
        c.width * 0.5 - cam.x * 0.04, c.height * 0.5 - cam.y * 0.04, Math.max(c.width, c.height) * (0.6 * breath)
      );
      grad1.addColorStop(0, `rgba(${r1},${g1},${b1},0.4)`);
      grad1.addColorStop(1, 'rgba(5,5,10,0.0)');
      ctx2.fillStyle = grad1;
      ctx2.fillRect(0, 0, c.width, c.height);

      // Surface layer
      const grad2 = ctx2.createRadialGradient(
        c.width * 0.5 - cam.x * 0.075, c.height * 0.5 - cam.y * 0.075, 0,
        c.width * 0.5 - cam.x * 0.075, c.height * 0.5 - cam.y * 0.075, Math.max(c.width, c.height) * (0.7 + 0.05 * Math.sin(ts * 0.001))
      );
      grad2.addColorStop(0, `rgba(${r2},${g2},${b2},0.3)`);
      grad2.addColorStop(1, 'rgba(8,8,12,0.0)');
      ctx2.fillStyle = grad2;
      ctx2.fillRect(0, 0, c.width, c.height);

      // Additive draw for particles/ribbons/halos
      const oldComp = ctx2.globalCompositeOperation;
      ctx2.globalCompositeOperation = 'lighter';

      // Particles
      for (let i = particles.current.length - 1; i >= 0; i--) {
        const p = particles.current[i];
        p.t += (p.speed * d) / 1000;
        p.life -= d;
        const tt = Math.min(1, p.t);
        const x = p.x0 + (p.x1 - p.x0) * tt;
        const y = p.y0 + (p.y1 - p.y0) * tt;
        const fade = Math.max(0, 1 - Math.pow(tt, 1.5));
        const rgb = hexToRgb(p.color);
        ctx2.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${0.9 * fade})`;
        ctx2.beginPath();
        ctx2.arc(x, y, p.r * (1 + 0.5 * (1 - fade)), 0, Math.PI * 2);
        ctx2.fill();
        if (p.t >= 1 || p.life <= 0) particles.current.splice(i, 1);
      }

      // Ribbons
      for (let i = ribbons.current.length - 1; i >= 0; i--) {
        const r = ribbons.current[i];
        r.t += (r.speed * d) / 1000;
        r.life -= d;
        const tt = Math.min(1, r.t);
        const vx = r.x1 - r.x0, vy = r.y1 - r.y0;
        const x = r.x0 + vx * tt, y = r.y0 + vy * tt;
        const angle = Math.atan2(vy, vx);
        const rgb = hexToRgb(r.color);
        const alpha = Math.max(0, 0.85 * (1 - tt) * Math.min(1, r.life / 300));
        ctx2.save();
        ctx2.translate(x, y);
        ctx2.rotate(angle);
        ctx2.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
        const w2 = r.w * 0.5;
        ctx2.beginPath();
        ctx2.moveTo(-r.len * 0.5, -w2);
        ctx2.lineTo(r.len * 0.5, -w2);
        ctx2.lineTo(r.len * 0.5, w2);
        ctx2.lineTo(-r.len * 0.5, w2);
        ctx2.closePath();
        ctx2.fill();
        ctx2.restore();
        if (r.t >= 1 || r.life <= 0) ribbons.current.splice(i, 1);
      }

      // Halos
      for (let i = halos.current.length - 1; i >= 0; i--) {
        const h = halos.current[i];
        h.t += d;
        const tt = Math.min(1, h.t / h.life);
        const alpha = Math.max(0, 0.6 * (1 - tt));
        const radius = 14 * (0.8 + 1.6 * tt);
        ctx2.strokeStyle = `rgba(0, 240, 255, ${alpha})`; // Neon Cyan
        ctx2.lineWidth = 2;
        ctx2.beginPath();
        ctx2.arc(h.x, h.y, radius, 0, Math.PI * 2);
        ctx2.stroke();
        ctx2.fillStyle = `rgba(0, 240, 255, ${0.2 * (1 - tt)})`;
        ctx2.beginPath();
        ctx2.arc(h.x, h.y, 14, 0, Math.PI * 2);
        ctx2.fill();
        if (tt >= 1) halos.current.splice(i, 1);
      }

      ctx2.globalCompositeOperation = oldComp;
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = null;
    };
  }, [width, height]);

  React.useEffect(() => {
    camRef.current = { ...viewport };
  }, [viewport.x, viewport.y, viewport.zoom]);

  React.useImperativeHandle(ref, () => ({
    emitTransmit: (fromId: string, toId: string, size = 0) => {
      const from = idToPos.current.get(fromId);
      const to = idToPos.current.get(toId);
      if (!from || !to) return;

      const desired = Math.min(12, Math.max(1, Math.floor(size / 512) || 2));
      const remaining = Math.max(0, budgetsRef.current.maxParticles - particles.current.length);
      const count = Math.min(desired, remaining);
      const speed = 0.8 + Math.min(2.5, (size / 2048) || 0.2);

      for (let i = 0; i < count; i++) {
        const hue = 200 + Math.floor(Math.random() * 80);
        const col = hslToHexNumber(hue, 80, 60);
        particles.current.push({
          x0: from.x, y0: from.y, x1: to.x, y1: to.y,
          t: 0, speed: (speed + Math.random() * 0.6) * 300, life: 1200,
          r: 2.0 + Math.random() * 1.5, color: col,
        });
      }

      const remR = Math.max(0, budgetsRef.current.maxRibbons - ribbons.current.length);
      const rc = Math.min(Math.min(2, Math.max(1, Math.floor((size || 256) / 4096))), remR);
      for (let i = 0; i < rc; i++) {
        const hue = 210 + Math.floor(Math.random() * 60);
        const col = hslToHexNumber(hue, 85, 65);
        ribbons.current.push({
          x0: from.x, y0: from.y, x1: to.x, y1: to.y,
          t: 0, speed: (speed + 0.8) * (1.2 + Math.random() * 0.4) * 300,
          life: 700 + Math.random() * 350,
          len: 28 + Math.random() * 18,
          w: 4 + Math.random() * 2,
          color: col,
        });
      }
    },
    pulseNode: (nodeId: string) => {
      const p = idToPos.current.get(nodeId);
      if (!p) return;
      halos.current.push({ x: p.x, y: p.y, t: 0, life: 600 });
    },
    setViewport: (vp) => { camRef.current = { ...vp }; },
    setSize: (w, h) => {
      const c = canvasRef.current;
      if (!c) return;
      c.width = Math.max(1, w);
      c.height = Math.max(1, h);
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: `${width}px`, height: `${height}px`, display: 'block' }}
    />
  );
});

export default CanvasUnderlay;