/* ==========================================================================
   Particle System — havuzlu, GC dostu
   Tipler: dust, spark, ember, blood(gold), smoke, ring, star, leaf, shard
   ========================================================================== */

const MAX = 700;

export class Particles {
  constructor() {
    this.pool = new Array(MAX);
    for (let i = 0; i < MAX; i++) {
      this.pool[i] = {
        active: false, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 3, gravity: 0,
        color: '#fff', type: 'dot', rot: 0, vrot: 0,
        drag: 1, fade: true, glow: 0
      };
    }
    this.cursor = 0;
  }

  _get() {
    for (let i = 0; i < MAX; i++) {
      const idx = (this.cursor + i) % MAX;
      if (!this.pool[idx].active) {
        this.cursor = (idx + 1) % MAX;
        return this.pool[idx];
      }
    }
    // hepsi doluysa en eskisini geri dönüştür
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    return p;
  }

  spawn(opts) {
    const p = this._get();
    p.active = true;
    p.x = opts.x; p.y = opts.y;
    p.vx = opts.vx || 0; p.vy = opts.vy || 0;
    p.maxLife = p.life = opts.life || 0.6;
    p.size = opts.size || 3;
    p.gravity = opts.gravity ?? 0;
    p.color = opts.color || '#d4a853';
    p.type = opts.type || 'dot';
    p.rot = opts.rot || 0;
    p.vrot = opts.vrot || 0;
    p.drag = opts.drag ?? 0.98;
    p.fade = opts.fade !== false;
    p.glow = opts.glow || 0;
    return p;
  }

  /* ---------- Hazır efektler ---------- */

  landDust(x, y, power = 1) {
    const n = Math.round(6 + power * 8);
    for (let i = 0; i < n; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      this.spawn({
        x: x + (Math.random() - 0.5) * 18, y,
        vx: dir * (30 + Math.random() * 110 * power),
        vy: -(20 + Math.random() * 60) * power,
        life: 0.35 + Math.random() * 0.3,
        size: 2 + Math.random() * 3.5 * power,
        gravity: 320, drag: 0.9,
        color: 'rgba(190,190,210,0.55)', type: 'dot'
      });
    }
  }

  jumpPuff(x, y) {
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (Math.random() - 0.5) * 1.6;
      this.spawn({
        x: x + (Math.random() - 0.5) * 12, y,
        vx: Math.cos(a) * (20 + Math.random() * 60),
        vy: Math.abs(Math.sin(a)) * (10 + Math.random() * 40),
        life: 0.3, size: 2 + Math.random() * 3,
        gravity: 120, color: 'rgba(200,200,225,0.4)'
      });
    }
  }

  runDust(x, y, facing) {
    this.spawn({
      x, y,
      vx: -facing * (20 + Math.random() * 45),
      vy: -(5 + Math.random() * 25),
      life: 0.28, size: 1.5 + Math.random() * 2.5,
      gravity: 180, color: 'rgba(180,180,200,0.35)'
    });
  }

  coinBurst(x, y, color = '#f0d490') {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 70 + Math.random() * 130;
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: 0.5 + Math.random() * 0.3,
        size: 1.5 + Math.random() * 2.5,
        gravity: 180, drag: 0.93, color, glow: 8, type: 'star'
      });
    }
    this.spawn({ x, y, life: 0.35, size: 8, color, type: 'ring', glow: 12, gravity: 0, drag: 1 });
  }

  hitSpark(x, y, color = '#ff6b35', n = 18) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 240;
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.25 + Math.random() * 0.3,
        size: 1 + Math.random() * 3,
        gravity: 260, drag: 0.9, color, glow: 10, type: 'spark',
        rot: a, vrot: 0
      });
    }
    this.spawn({ x, y, life: 0.3, size: 10, color, type: 'ring', glow: 16, drag: 1 });
  }

  enemyDeath(x, y, color = '#8a3050') {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 200;
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80,
        life: 0.5 + Math.random() * 0.5,
        size: 2 + Math.random() * 4,
        gravity: 420, drag: 0.92, color, type: 'shard',
        rot: Math.random() * 6.28, vrot: (Math.random() - 0.5) * 14
      });
    }
    this.spawn({ x, y, life: 0.4, size: 14, color: '#ffffff', type: 'ring', glow: 20, drag: 1 });
  }

  ember(x, y, color = 'rgba(255,120,50,0.8)') {
    this.spawn({
      x, y, vx: (Math.random() - 0.5) * 25, vy: -(15 + Math.random() * 45),
      life: 1.2 + Math.random() * 1.4, size: 1 + Math.random() * 2,
      gravity: -8, drag: 0.995, color, glow: 6
    });
  }

  heartFloat(x, y) {
    for (let i = 0; i < 8; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 20, y,
        vx: (Math.random() - 0.5) * 40, vy: -(40 + Math.random() * 70),
        life: 0.8, size: 3 + Math.random() * 3,
        gravity: -20, drag: 0.96,
        color: '#ff5c78', glow: 10, type: 'heart'
      });
    }
  }

  fireTrail(x, y) {
    this.spawn({
      x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30 - 20,
      life: 0.35, size: 3 + Math.random() * 4,
      gravity: -30, drag: 0.9,
      color: Math.random() < 0.5 ? 'rgba(255,140,40,0.85)' : 'rgba(255,80,30,0.75)',
      glow: 12
    });
  }

  portalSwirl(x, y, r) {
    const a = Math.random() * Math.PI * 2;
    this.spawn({
      x: x + Math.cos(a) * r, y: y + Math.sin(a) * r,
      vx: -Math.cos(a) * 40, vy: -Math.sin(a) * 40,
      life: 0.6, size: 1.5 + Math.random() * 2,
      color: 'rgba(160,110,255,0.9)', glow: 10, drag: 0.97
    });
  }

  update(dt) {
    const pool = this.pool;
    for (let i = 0; i < MAX; i++) {
      const p = pool[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.vy += p.gravity * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
    }
  }

  /**
   * @param cam  Kamera (zoom'a duyarlı kırpma penceresi için). Verilmezse
   *             tuvalin tamamı görünür kabul edilir.
   */
  render(ctx, camX, camY, cam = null) {
    const pool = this.pool;
    const left = cam ? cam.screenLeft - 60 : -60;
    const right = cam ? cam.screenRight + 60 : (ctx.canvas.width + 60);
    const top = cam ? cam.screenTop - 60 : -60;
    const bottom = cam ? cam.screenBottom + 60 : (ctx.canvas.height + 60);
    ctx.save();
    for (let i = 0; i < MAX; i++) {
      const p = pool[i];
      if (!p.active) continue;
      const sx = p.x - camX;
      const sy = p.y - camY;
      if (sx < left || sx > right || sy < top || sy > bottom) continue;

      const t = p.life / p.maxLife;
      const alpha = p.fade ? Math.max(0, Math.min(1, t)) : 1;
      ctx.globalAlpha = alpha;
      if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = p.glow; }
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;

      switch (p.type) {
        case 'ring': {
          const r = p.size * (1 + (1 - t) * 3.2);
          ctx.lineWidth = Math.max(0.5, 2.5 * t);
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'spark': {
          const len = p.size * 3;
          ctx.lineWidth = Math.max(0.6, p.size * 0.55);
          ctx.lineCap = 'round';
          const ang = Math.atan2(p.vy, p.vx);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - Math.cos(ang) * len, sy - Math.sin(ang) * len);
          ctx.stroke();
          break;
        }
        case 'shard': {
          ctx.save();
          ctx.translate(sx, sy); ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
          ctx.restore();
          break;
        }
        case 'star': {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.beginPath();
          ctx.moveTo(0, -p.size * 1.7);
          ctx.lineTo(p.size * 0.5, -p.size * 0.5);
          ctx.lineTo(p.size * 1.7, 0);
          ctx.lineTo(p.size * 0.5, p.size * 0.5);
          ctx.lineTo(0, p.size * 1.7);
          ctx.lineTo(-p.size * 0.5, p.size * 0.5);
          ctx.lineTo(-p.size * 1.7, 0);
          ctx.lineTo(-p.size * 0.5, -p.size * 0.5);
          ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        }
        case 'heart': {
          const s = p.size * 0.5;
          ctx.save();
          ctx.translate(sx, sy); ctx.scale(s, s);
          ctx.beginPath();
          ctx.moveTo(0, 1.4);
          ctx.bezierCurveTo(-2.2, -0.4, -1.2, -2.2, 0, -1.1);
          ctx.bezierCurveTo(1.2, -2.2, 2.2, -0.4, 0, 1.4);
          ctx.fill();
          ctx.restore();
          break;
        }
        default:
          ctx.beginPath(); ctx.arc(sx, sy, p.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  clear() {
    for (let i = 0; i < MAX; i++) this.pool[i].active = false;
  }
}
