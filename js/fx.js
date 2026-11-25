/* ══════════════════════════════════════════════════════════════
   ENP BACCARAT — Atmosphere FX (canvas particles)
   Sakura petals, snow crystals, speed streaks.
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const PETAL_COLORS = ['#FFC9DA', '#FFB1C9', '#FF9EBE', '#FFE3EC', '#FFD0DE'];

  let canvas = null;
  let ctx = null;
  let mode = 'sakura';
  let parts = [];
  let bursts = [];
  let w = 0, h = 0, dpr = 1;
  let raf = 0;
  let lastT = 0;
  let active = false;

  function size() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, global.devicePixelRatio || 1);
    w = Math.max(1, r.width);
    h = Math.max(1, r.height);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function makePetal(y) {
    return {
      x: rnd(-20, w + 20),
      y: y == null ? rnd(-h * 0.4, -8) : y,
      vy: rnd(14, 34),
      vx: rnd(-12, 18),
      size: rnd(4.5, 9),
      rot: rnd(0, Math.PI * 2),
      vr: rnd(-1.2, 1.2),
      sway: rnd(0.5, 1.6),
      phase: rnd(0, Math.PI * 2),
      alpha: rnd(0.35, 0.8),
      color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)]
    };
  }

  function makeFlake(y) {
    return {
      x: rnd(-10, w + 10),
      y: y == null ? rnd(-h * 0.4, -6) : y,
      vy: rnd(10, 26),
      vx: rnd(-8, 8),
      size: rnd(1.1, 2.9),
      crystal: Math.random() < 0.28,
      rot: rnd(0, Math.PI * 2),
      vr: rnd(-0.6, 0.6),
      phase: rnd(0, Math.PI * 2),
      alpha: rnd(0.3, 0.85),
      twinkle: rnd(0.5, 1.8)
    };
  }

  function makeStreak(y) {
    return {
      x: rnd(-w * 0.3, w),
      y: y == null ? rnd(0, h) : y,
      len: rnd(18, 60),
      vy: rnd(90, 200),
      vx: rnd(40, 90),
      alpha: rnd(0.05, 0.22),
      width: rnd(0.6, 1.4)
    };
  }

  function populate() {
    parts = [];
    if (!w || !h) return;
    if (mode === 'sakura') {
      const n = Math.min(34, Math.round((w * h) / 12000));
      for (let i = 0; i < n; i++) parts.push(makePetal(rnd(-h, h)));
    } else if (mode === 'snow') {
      const n = Math.min(46, Math.round((w * h) / 9000));
      for (let i = 0; i < n; i++) parts.push(makeFlake(rnd(-h, h)));
    } else if (mode === 'speed') {
      const n = Math.min(16, Math.round((w * h) / 30000));
      for (let i = 0; i < n; i++) parts.push(makeStreak());
    }
  }

  function drawPetal(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    const s = p.size;
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.9, -s * 0.8, s * 0.75, s * 0.55, 0, s);
    ctx.bezierCurveTo(-s * 0.75, s * 0.55, -s * 0.9, -s * 0.8, 0, -s);
    ctx.fill();
    ctx.globalAlpha = p.alpha * 0.5;
    ctx.strokeStyle = '#FFF0F5';
    ctx.lineWidth = 0.4;
    ctx.stroke();
    ctx.restore();
  }

  function drawFlake(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.alpha;
    if (p.crystal) {
      ctx.strokeStyle = '#DFF6FF';
      ctx.lineWidth = 1;
      ctx.shadowColor = '#9FE3FF';
      ctx.shadowBlur = 6;
      const s = p.size * 2.6;
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI / 3) * i;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(a) * s, -Math.sin(a) * s);
        ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#EAF9FF';
      ctx.shadowColor = '#9FE3FF';
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStreak(p) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    const grad = ctx.createLinearGradient(p.x, p.y, p.x - p.len * 0.7, p.y - p.len);
    grad.addColorStop(0, 'rgba(34,211,238,.8)');
    grad.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = p.width;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.len * 0.7, p.y - p.len);
    ctx.stroke();
    ctx.restore();
  }

  function step(t) {
    if (!active) return;
    const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016);
    lastT = t;
    ctx.clearRect(0, 0, w, h);

    for (const p of parts) {
      if (mode === 'sakura') {
        p.phase += dt * p.sway;
        p.x += (p.vx + Math.sin(p.phase) * 22) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y > h + 14 || p.x < -40 || p.x > w + 40) Object.assign(p, makePetal());
        drawPetal(p);
      } else if (mode === 'snow') {
        p.phase += dt;
        p.x += (p.vx + Math.sin(p.phase * 0.7) * 10) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.alpha = Math.max(0.18, Math.min(0.9, p.alpha + Math.sin(p.phase * p.twinkle) * 0.004));
        if (p.y > h + 10 || p.x < -20 || p.x > w + 20) Object.assign(p, makeFlake());
        drawFlake(p);
      } else if (mode === 'speed') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > h + 65 || p.x > w + 90) Object.assign(p, makeStreak(-60));
        drawStreak(p);
      }
    }

    // bursts
    bursts = bursts.filter((b) => b.life > 0);
    for (const b of bursts) {
      b.life -= dt;
      for (const s of b.items) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += (mode === 'snow' ? 30 : 18) * dt;
        s.rot += s.vr * dt;
        s.alpha = Math.max(0, b.life / b.max);
        if (mode === 'snow') {
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate(s.rot);
          ctx.globalAlpha = s.alpha;
          ctx.fillStyle = '#EAF9FF';
          ctx.shadowColor = '#9FE3FF';
          ctx.shadowBlur = 5;
          ctx.beginPath(); ctx.arc(0, 0, s.size, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        } else {
          drawPetal(s);
        }
      }
    }

    raf = global.requestAnimationFrame(step);
  }

  function start() {
    if (!canvas || active) return;
    active = true;
    lastT = 0;
    raf = global.requestAnimationFrame(step);
  }

  function stop() {
    active = false;
    cancelAnimationFrame(raf);
    if (ctx) ctx.clearRect(0, 0, w, h);
  }

  const FX = {
    init(el) {
      if (!el) return;
      canvas = el;
      ctx = canvas.getContext('2d');
      size();
      if (global.ResizeObserver) {
        new ResizeObserver(() => { size(); populate(); }).observe(canvas);
      } else {
        global.addEventListener('resize', () => { size(); populate(); });
      }
    },

    setMode(m) {
      mode = m;
      size();
      populate();
      bursts = [];
      if (m === 'sakura' || m === 'snow' || m === 'speed') start();
      else stop();
    },

    burst() {
      if (!canvas) return;
      size();
      const cx = w * 0.5;
      const cy = h * 0.42;
      const items = [];
      const isSnow = mode === 'snow';
      const n = isSnow ? 30 : 26;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rnd(60, 240);
        items.push(isSnow ? {
          x: cx + rnd(-30, 30), y: cy + rnd(-20, 20),
          vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp * 0.6 - 40,
          size: rnd(1, 3), rot: rnd(0, 6.28), vr: rnd(-3, 3), alpha: 1
        } : {
          x: cx + rnd(-24, 24), y: cy + rnd(-16, 24),
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70,
          size: rnd(4, 9), rot: rnd(0, 6.28), vr: rnd(-4, 4), alpha: 1,
          color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)]
        });
      }
      bursts.push({ items, life: 1.25, max: 1.25 });
      start();
    },

    refresh() { size(); populate(); }
  };

  global.FX = FX;
})(window);
