// Lightweight self-contained confetti burst — no dependency.

const COLORS = ["#ff4d8b", "#1a3a3a", "#b8a4ed", "#ffb084", "#e8b94a", "#ff6b5a", "#a4d4c5"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  life: number;
}

/**
 * Fire a confetti burst from the top-center of the viewport. Creates a transient
 * fixed-position canvas, animates ~`count` particles under gravity, then removes
 * itself. Safe to call repeatedly.
 */
export function fireConfetti(count = 160): void {
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const W = window.innerWidth;
  const originX = W / 2;
  const originY = window.innerHeight * 0.28;
  const particles: Particle[] = Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = 6 + Math.random() * 9;
    return {
      x: originX + (Math.random() - 0.5) * 60,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      size: 6 + Math.random() * 7,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      life: 1,
    };
  });

  let raf = 0;
  let ticks = 0;
  const maxTicks = 200;

  const step = () => {
    ctx.clearRect(0, 0, W, window.innerHeight);
    let alive = false;
    for (const p of particles) {
      p.vy += 0.28; // gravity
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (ticks > maxTicks * 0.6) p.life -= 0.02;
      if (p.life > 0 && p.y < window.innerHeight + 40) {
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
    }
    ticks++;
    if (alive && ticks < maxTicks) {
      raf = requestAnimationFrame(step);
    } else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  };
  raf = requestAnimationFrame(step);
}
