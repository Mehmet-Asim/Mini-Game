/* ==========================================================================
   Parallax Arka Plan — her tema için 5-6 katman
   Katmanlar prosedürel üretilir (deterministik hash) — asset gerekmez.
   ========================================================================== */

import { hash, noise1D, lerp, clamp } from '../core/utils.js';

export const THEMES = {
  forest: {
    sky: ['#03060f', '#081426', '#0d2036', '#123044'],
    fogColor: 'rgba(20, 45, 55, ',
    accent: '#3ddc84',
    accentDim: 'rgba(61,220,132,0.25)',
    groundTop: '#16301f',
    groundBody: '#08150e',
    groundLine: '#3ddc84',
    platformFace: '#132a1c',
    platformTop: '#2a5e3c',
    platformEdge: '#4fdc8a',
    ambient: 'rgba(60,180,120,0.05)',
    lightColor: 'rgba(140, 255, 190, 0.10)'
  },
  castle: {
    sky: ['#04060f', '#0a1030', '#141c45', '#222a58'],
    fogColor: 'rgba(40, 46, 90, ',
    accent: '#d4a853',
    accentDim: 'rgba(212,168,83,0.25)',
    groundTop: '#2e2c3e',
    groundBody: '#14131f',
    groundLine: '#d4a853',
    platformFace: '#20203a',
    platformTop: '#3c3c60',
    platformEdge: '#d4a853',
    ambient: 'rgba(212,168,83,0.045)',
    lightColor: 'rgba(255, 220, 150, 0.10)'
  },
  lair: {
    sky: ['#0d0206', '#1c0509', '#310a0d', '#4a1210'],
    fogColor: 'rgba(90, 25, 20, ',
    accent: '#ff5a20',
    accentDim: 'rgba(255,90,32,0.28)',
    groundTop: '#3a1210',
    groundBody: '#170606',
    groundLine: '#ff5a20',
    platformFace: '#26100e',
    platformTop: '#4a1c16',
    platformEdge: '#ff7a3a',
    ambient: 'rgba(255,80,30,0.06)',
    lightColor: 'rgba(255, 140, 70, 0.12)'
  }
};

export class Background {
  constructor(theme) {
    this.setTheme(theme);
    this.time = 0;
    this.embers = [];
    this.leaves = [];
    this.rain = [];
    this._initAtmos();
  }

  setTheme(name) {
    this.themeName = name;
    this.theme = THEMES[name] || THEMES.forest;
  }

  _initAtmos() {
    for (let i = 0; i < 70; i++) {
      this.embers.push({
        x: Math.random(), y: Math.random(),
        s: 0.2 + Math.random() * 0.8,
        r: 0.6 + Math.random() * 1.8,
        p: Math.random() * 6.28
      });
    }
    for (let i = 0; i < 34; i++) {
      this.leaves.push({
        x: Math.random(), y: Math.random(),
        s: 0.15 + Math.random() * 0.5,
        size: 2 + Math.random() * 3,
        p: Math.random() * 6.28,
        rot: Math.random() * 6.28
      });
    }
  }

  update(dt) { this.time += dt; }

  render(ctx, cam, w, h) {
    const t = this.theme;
    const cx = cam.offsetX;
    const cy = cam.offsetY;

    /* ---- Gökyüzü ---- */
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, t.sky[0]);
    sky.addColorStop(0.38, t.sky[1]);
    sky.addColorStop(0.72, t.sky[2]);
    sky.addColorStop(1, t.sky[3]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    switch (this.themeName) {
      case 'forest': this._forest(ctx, cx, cy, w, h); break;
      case 'castle': this._castle(ctx, cx, cy, w, h); break;
      case 'lair': this._lair(ctx, cx, cy, w, h); break;
    }
  }

  /* ======================================================================
     ORMAN
     ====================================================================== */
  _forest(ctx, cx, cy, w, h) {
    const horizon = h * 0.78;

    // Yıldızlar (parallax 0.02)
    ctx.save();
    for (let i = 0; i < 90; i++) {
      const bx = (hash(i * 3.1) * 3000 - cx * 0.03) % (w + 100);
      const sx = bx < 0 ? bx + w + 100 : bx;
      const sy = hash(i * 7.7) * h * 0.55 - cy * 0.02;
      if (sy < 0 || sy > h) continue;
      const tw = 0.35 + Math.sin(this.time * 1.6 + i) * 0.28;
      ctx.globalAlpha = clamp(tw, 0.08, 0.75);
      ctx.fillStyle = i % 9 === 0 ? '#9fe0ff' : '#ffffff';
      ctx.fillRect(sx, sy, hash(i) > 0.86 ? 2 : 1.2, hash(i) > 0.86 ? 2 : 1.2);
    }
    ctx.restore();

    // Ay + halesi
    const mx = w * 0.76 - cx * 0.015;
    const my = h * 0.16 - cy * 0.01;
    const halo = ctx.createRadialGradient(mx, my, 6, mx, my, 150);
    halo.addColorStop(0, 'rgba(200, 235, 255, 0.20)');
    halo.addColorStop(0.35, 'rgba(140, 200, 255, 0.07)');
    halo.addColorStop(1, 'rgba(120, 180, 255, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(mx, my, 150, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(226, 240, 255, 0.9)';
    ctx.beginPath(); ctx.arc(mx, my, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(180, 205, 235, 0.5)';
    ctx.beginPath(); ctx.arc(mx - 9, my - 7, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 11, my + 6, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 3, my + 15, 3, 0, Math.PI * 2); ctx.fill();

    // Uzak sisli tepeler (0.08)
    this._hills(ctx, cx * 0.08, horizon + 30, w, h, 'rgba(14, 32, 42, 0.9)', 120, 0.0016, 11);
    // Orta tepeler (0.16)
    this._hills(ctx, cx * 0.16, horizon + 55, w, h, 'rgba(9, 24, 30, 0.95)', 90, 0.0026, 27);

    // Katman 3 — uzak ağaçlar (0.28)
    this._treeRow(ctx, cx * 0.28, horizon + 40, w, 190, 0.5, 'rgba(6, 20, 18, 0.85)', 3.7);
    // Katman 4 — orta ağaçlar (0.45)
    this._treeRow(ctx, cx * 0.45, horizon + 70, w, 250, 0.72, 'rgba(4, 15, 13, 0.92)', 8.3);

    // Ay ışığı huzmeleri
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const bx = ((i * 380 - cx * 0.3) % (w + 500)) - 100;
      const gr = ctx.createLinearGradient(bx, 0, bx + 90, h);
      gr.addColorStop(0, 'rgba(150, 220, 255, 0.055)');
      gr.addColorStop(1, 'rgba(150, 220, 255, 0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(bx, 0); ctx.lineTo(bx + 60, 0);
      ctx.lineTo(bx + 170, h); ctx.lineTo(bx + 70, h);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // Sis bandı
    this._fogBand(ctx, w, h, horizon - 20, 'rgba(40, 90, 90, ');

    // Uçuşan yapraklar (ön katman)
    ctx.save();
    for (const l of this.leaves) {
      const px = ((l.x * w * 2 + this.time * 22 * l.s - cx * 0.6) % (w + 60)) - 30;
      const py = ((l.y * h + Math.sin(this.time * 0.8 + l.p) * 40 + this.time * 14 * l.s) % (h + 40)) - 20;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(l.rot + this.time * 1.4 * l.s);
      ctx.globalAlpha = 0.16 + l.s * 0.16;
      ctx.fillStyle = '#2e6b46';
      ctx.beginPath();
      ctx.ellipse(0, 0, l.size, l.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ======================================================================
     KALE
     ====================================================================== */
  _castle(ctx, cx, cy, w, h) {
    const horizon = h * 0.8;

    // Yıldızlar
    ctx.save();
    for (let i = 0; i < 70; i++) {
      const bx = (hash(i * 2.3) * 2600 - cx * 0.025) % (w + 100);
      const sx = bx < 0 ? bx + w + 100 : bx;
      const sy = hash(i * 5.1) * h * 0.5 - cy * 0.015;
      if (sy < 0 || sy > h) continue;
      ctx.globalAlpha = clamp(0.3 + Math.sin(this.time * 1.3 + i) * 0.3, 0.06, 0.7);
      ctx.fillStyle = '#e8eeff';
      ctx.fillRect(sx, sy, 1.3, 1.3);
    }
    ctx.restore();

    // Ay
    const mx = w * 0.2 - cx * 0.012;
    const my = h * 0.14;
    const halo = ctx.createRadialGradient(mx, my, 4, mx, my, 130);
    halo.addColorStop(0, 'rgba(255, 230, 180, 0.18)');
    halo.addColorStop(1, 'rgba(255, 210, 140, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(mx, my, 130, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(252, 240, 210, 0.85)';
    ctx.beginPath(); ctx.arc(mx, my, 28, 0, Math.PI * 2); ctx.fill();

    // Uzak dağ silüeti
    this._hills(ctx, cx * 0.06, horizon + 20, w, h, 'rgba(16, 20, 46, 0.9)', 140, 0.0014, 5);

    // Uzak kale kuleleri (0.14)
    this._towers(ctx, cx * 0.14, horizon + 10, w, h, 'rgba(14, 18, 44, 0.95)', 0.62, 13);
    // Orta kuleler + meşaleler (0.3)
    this._towers(ctx, cx * 0.3, horizon + 45, w, h, 'rgba(10, 13, 34, 0.98)', 1.0, 41, true);

    // Sur duvarı (0.55)
    this._wall(ctx, cx * 0.55, horizon + 60, w, h);

    // Sancaklar
    this._banners(ctx, cx * 0.55, horizon + 60, w);

    this._fogBand(ctx, w, h, horizon - 10, 'rgba(50, 55, 110, ');
  }

  /* ======================================================================
     EJDERHA İNİ
     ====================================================================== */
  _lair(ctx, cx, cy, w, h) {
    const horizon = h * 0.82;

    // Gökten sızan kızıl ışık
    const glow = ctx.createRadialGradient(w * 0.5, h * 1.05, 20, w * 0.5, h * 1.05, h * 0.95);
    glow.addColorStop(0, 'rgba(255, 90, 30, 0.28)');
    glow.addColorStop(0.5, 'rgba(200, 40, 20, 0.10)');
    glow.addColorStop(1, 'rgba(120, 20, 10, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Sarkıtlar (tavandan) — 0.12
    this._stalactites(ctx, cx * 0.12, w, h * 0.0, 'rgba(20, 6, 8, 0.9)', 0.6, 7);
    // Yakın sarkıtlar — 0.3
    this._stalactites(ctx, cx * 0.3, w, 0, 'rgba(12, 4, 5, 0.96)', 1.0, 23);

    // Uzak volkanik tepeler
    this._hills(ctx, cx * 0.09, horizon + 30, w, h, 'rgba(38, 10, 10, 0.9)', 150, 0.0018, 61);
    this._hills(ctx, cx * 0.2, horizon + 60, w, h, 'rgba(22, 6, 6, 0.95)', 100, 0.003, 83);

    // Lav gölü çizgisi
    ctx.save();
    const lav = ctx.createLinearGradient(0, horizon + 40, 0, h);
    lav.addColorStop(0, 'rgba(255, 110, 30, 0.30)');
    lav.addColorStop(0.4, 'rgba(220, 50, 20, 0.16)');
    lav.addColorStop(1, 'rgba(120, 20, 10, 0.05)');
    ctx.fillStyle = lav;
    ctx.fillRect(0, horizon + 40, w, h - horizon - 40);
    // dalgalanan lav çizgisi
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255, 160, 60, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = horizon + 44 + Math.sin((x + cx * 0.2) * 0.02 + this.time * 2) * 4
                            + Math.sin((x - cx * 0.2) * 0.007 + this.time * 1.3) * 3;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // Yükselen közler
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.embers) {
      const px = ((e.x * w * 1.6 - cx * 0.35 + Math.sin(this.time * 0.6 + e.p) * 30) % (w + 40));
      const sx = px < 0 ? px + w + 40 : px;
      const py = h - ((e.y * h + this.time * 44 * e.s) % (h + 60));
      ctx.globalAlpha = clamp(0.15 + Math.sin(this.time * 2 + e.p) * 0.35, 0.05, 0.65);
      ctx.fillStyle = e.r > 1.4 ? '#ffb15a' : '#ff6a28';
      ctx.beginPath(); ctx.arc(sx, py, e.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    this._fogBand(ctx, w, h, horizon - 30, 'rgba(110, 35, 20, ');
  }

  /* ======================================================================
     Yardımcı çizim fonksiyonları
     ====================================================================== */

  _hills(ctx, off, baseY, w, h, color, amp, freq, seed) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-10, h + 10);
    for (let x = -10; x <= w + 10; x += 10) {
      const wx = x + off;
      const y = baseY - (noise1D(wx * freq + seed) * amp + noise1D(wx * freq * 3.3 + seed) * amp * 0.32);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w + 10, h + 10);
    ctx.closePath();
    ctx.fill();
  }

  _treeRow(ctx, off, baseY, w, maxH, scale, color, seed) {
    const spacing = 78 * scale;
    const start = Math.floor(off / spacing) - 1;
    const count = Math.ceil(w / spacing) + 3;
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const idx = start + i;
      const wx = idx * spacing;
      const sx = wx - off;
      const r = hash(idx * 1.7 + seed);
      const th = (maxH * 0.5 + r * maxH * 0.5) * scale;
      const tw = 8 * scale + r * 6 * scale;
      const sway = Math.sin(this.time * 0.6 + idx) * 2.5 * scale;

      // Gövde
      ctx.fillRect(sx - tw / 2, baseY - th, tw, th);

      // Konik katmanlar
      const layers = 4;
      for (let l = 0; l < layers; l++) {
        const ly = baseY - th + (th * 0.12) + l * (th * 0.2);
        const lw = (46 - l * 8) * scale * (0.8 + r * 0.5);
        ctx.beginPath();
        ctx.moveTo(sx - lw + sway * (1 - l / layers), ly + 26 * scale);
        ctx.lineTo(sx + sway * (1 - l / layers) * 1.4, ly - 34 * scale);
        ctx.lineTo(sx + lw + sway * (1 - l / layers), ly + 26 * scale);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  _towers(ctx, off, baseY, w, h, color, scale, seed, torches = false) {
    const spacing = 230 * scale;
    const start = Math.floor(off / spacing) - 1;
    const count = Math.ceil(w / spacing) + 3;
    for (let i = 0; i < count; i++) {
      const idx = start + i;
      const sx = idx * spacing - off;
      const r = hash(idx * 2.9 + seed);
      const tw = (48 + r * 26) * scale;
      const th = (150 + r * 130) * scale;
      const ty = baseY - th;

      ctx.fillStyle = color;
      ctx.fillRect(sx, ty, tw, th + 40);

      // Mazgallar
      const merlons = Math.max(3, Math.floor(tw / (13 * scale)));
      for (let m = 0; m < merlons; m++) {
        if (m % 2 === 0) {
          ctx.fillRect(sx + m * (tw / merlons), ty - 12 * scale, (tw / merlons) * 0.9, 12 * scale);
        }
      }

      // Konik çatı (bazı kulelerde)
      if (r > 0.55) {
        ctx.beginPath();
        ctx.moveTo(sx - 6 * scale, ty - 12 * scale);
        ctx.lineTo(sx + tw / 2, ty - (60 + r * 40) * scale);
        ctx.lineTo(sx + tw + 6 * scale, ty - 12 * scale);
        ctx.closePath();
        ctx.fill();
      }

      // Pencereler
      const winRows = Math.floor(th / (52 * scale));
      for (let ry = 0; ry < winRows; ry++) {
        const wy = ty + 26 * scale + ry * 52 * scale;
        const lit = hash(idx * 13.3 + ry * 3.1 + seed) > 0.55;
        ctx.fillStyle = lit
          ? `rgba(255, 190, 90, ${0.14 + Math.sin(this.time * 2.5 + idx + ry) * 0.06})`
          : 'rgba(0,0,0,0.35)';
        ctx.fillRect(sx + tw * 0.35, wy, 9 * scale, 15 * scale);
        if (lit) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const gr = ctx.createRadialGradient(sx + tw * 0.4, wy + 7, 1, sx + tw * 0.4, wy + 7, 34 * scale);
          gr.addColorStop(0, 'rgba(255,180,80,0.12)');
          gr.addColorStop(1, 'rgba(255,180,80,0)');
          ctx.fillStyle = gr;
          ctx.fillRect(sx + tw * 0.4 - 34 * scale, wy + 7 - 34 * scale, 68 * scale, 68 * scale);
          ctx.restore();
        }
        ctx.fillStyle = color;
      }

      // Meşaleler
      if (torches && r > 0.4) {
        const fx = sx + tw + 4 * scale;
        const fy = ty + 60 * scale;
        const flick = 0.7 + Math.sin(this.time * 9 + idx * 3) * 0.3;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const fg = ctx.createRadialGradient(fx, fy, 1, fx, fy, 46 * scale * flick);
        fg.addColorStop(0, 'rgba(255, 170, 70, 0.34)');
        fg.addColorStop(1, 'rgba(255, 120, 40, 0)');
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(fx, fy, 46 * scale * flick, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255, 210, 120, ${0.75 * flick})`;
        ctx.beginPath(); ctx.ellipse(fx, fy, 3 * scale, 6 * scale * flick, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }

  _wall(ctx, off, baseY, w, h) {
    ctx.fillStyle = 'rgba(8, 10, 26, 0.98)';
    ctx.fillRect(0, baseY, w, h - baseY);

    // Taş dokusu
    ctx.save();
    ctx.globalAlpha = 0.5;
    const bw = 62, bh = 26;
    const startCol = Math.floor(off / bw) - 1;
    for (let row = 0; row < Math.ceil((h - baseY) / bh) + 1; row++) {
      for (let col = 0; col < Math.ceil(w / bw) + 2; col++) {
        const idx = startCol + col;
        const stagger = row % 2 === 0 ? 0 : bw / 2;
        const sx = idx * bw - off + stagger;
        const sy = baseY + row * bh;
        const shade = hash(idx * 3.1 + row * 7.7);
        ctx.fillStyle = `rgba(${26 + shade * 16}, ${28 + shade * 16}, ${58 + shade * 20}, 0.5)`;
        ctx.fillRect(sx + 1, sy + 1, bw - 2, bh - 2);
      }
    }
    ctx.restore();

    // Mazgal üst
    const merlonW = 34;
    const startM = Math.floor(off / (merlonW * 2)) - 1;
    ctx.fillStyle = 'rgba(8, 10, 26, 0.98)';
    for (let i = 0; i < Math.ceil(w / (merlonW * 2)) + 2; i++) {
      const sx = (startM + i) * merlonW * 2 - off;
      ctx.fillRect(sx, baseY - 22, merlonW, 22);
    }
  }

  _banners(ctx, off, baseY, w) {
    const spacing = 320;
    const start = Math.floor(off / spacing) - 1;
    for (let i = 0; i < Math.ceil(w / spacing) + 3; i++) {
      const idx = start + i;
      const sx = idx * spacing - off;
      if (sx < -80 || sx > w + 80) continue;
      const r = hash(idx * 5.5);
      const bh = 90 + r * 40;
      const sway = Math.sin(this.time * 1.4 + idx) * 5;

      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = r > 0.5 ? '#5a1020' : '#1a2a5a';
      ctx.beginPath();
      ctx.moveTo(sx, baseY + 6);
      ctx.lineTo(sx + 30, baseY + 6);
      ctx.lineTo(sx + 30 + sway, baseY + 6 + bh);
      ctx.lineTo(sx + 15 + sway, baseY + 6 + bh - 14);
      ctx.lineTo(sx + sway, baseY + 6 + bh);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(212,168,83,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  _stalactites(ctx, off, w, topY, color, scale, seed) {
    const spacing = 62 * scale;
    const start = Math.floor(off / spacing) - 1;
    ctx.fillStyle = color;
    for (let i = 0; i < Math.ceil(w / spacing) + 3; i++) {
      const idx = start + i;
      const sx = idx * spacing - off;
      const r = hash(idx * 4.3 + seed);
      const len = (40 + r * 130) * scale;
      const wd = (16 + r * 18) * scale;
      ctx.beginPath();
      ctx.moveTo(sx - wd / 2, topY);
      ctx.lineTo(sx + wd / 2, topY);
      ctx.lineTo(sx + (r - 0.5) * 8, topY + len);
      ctx.closePath();
      ctx.fill();
    }
  }

  _fogBand(ctx, w, h, y, colorPrefix) {
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const yy = y + i * 26;
      const off = Math.sin(this.time * (0.25 + i * 0.12) + i) * 34;
      const gr = ctx.createLinearGradient(0, yy - 40, 0, yy + 60);
      gr.addColorStop(0, colorPrefix + '0)');
      gr.addColorStop(0.5, colorPrefix + (0.09 - i * 0.02) + ')');
      gr.addColorStop(1, colorPrefix + '0)');
      ctx.fillStyle = gr;
      ctx.fillRect(off - 60, yy - 40, w + 160, 110);
    }
    ctx.restore();
  }
}
