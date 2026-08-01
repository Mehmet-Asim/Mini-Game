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
    /* Piksel-blok filtresi (renderer.js → _renderPixelBackground) sahneyi
       indirgeyip büyüttüğü için SEYREK bir arka plan çok boş görünüyordu —
       tek ay + iki silik tepe bloklandığında "hiçbir şey yok" hissi
       veriyordu. Bu parçacıklar sahneyi "orada olma" hissi için dolduruyor;
       konumları sabit tohumla üretiliyor ki her kare aynı yerlerden
       geçsinler (titreşim olmasın). */
    this.fireflies = [];
    for (let i = 0; i < 16; i++) {
      this.fireflies.push({
        x: Math.random(), baseY: 0.55 + Math.random() * 0.32,
        amp: 10 + Math.random() * 22, speed: 0.3 + Math.random() * 0.5,
        p: Math.random() * 6.28, blinkP: Math.random() * 6.28,
        hue: Math.random() > 0.7 ? '150,255,200' : '220,255,140'
      });
    }
    this.birds = [];
    for (let i = 0; i < 3; i++) {
      this.birds.push({ x: Math.random(), y: 0.08 + Math.random() * 0.18, s: 0.6 + Math.random() * 0.5, p: Math.random() * 6.28 });
    }
    this.clouds = [];
    for (let i = 0; i < 5; i++) {
      this.clouds.push({ x: Math.random(), y: 0.05 + Math.random() * 0.28, w: 90 + Math.random() * 140, seed: Math.random() * 99 });
    }
    /* Ejderha ini için — kanatları çırpan yarasalar (kuşların karanlık,
       çarpık kuzeni). Kendi kalıcı yolları var ki her kare aynı rotada
       süzülsünler. */
    this.bats = [];
    for (let i = 0; i < 4; i++) {
      this.bats.push({
        x: Math.random(), y: 0.14 + Math.random() * 0.3,
        s: 0.7 + Math.random() * 0.6, p: Math.random() * 6.28, amp: 10 + Math.random() * 14
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

    // Uzak bulutlar (parallax 0.04) — ay ışığında silik gri-mavi lekeler
    this._clouds(ctx, cx * 0.04, w, h);

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

    // Süzülen kuşlar (parallax 0.1)
    this._birds(ctx, cx * 0.1, w, h);

    /* Vadiyi saran dağ silüetleri — en uzakta, puslu (0.025) ve biraz daha
       yakında, koyu (0.045). Zirveler ufkun epey üstüne çıkıyor ki oyuncu
       ormanda değil bir VADİDE yürüyormuş hissi versin. `_hills` (aşağıda)
       bu dağların önünde yumuşak eteklikler olarak kalıyor. */
    this._mountains(ctx, cx * 0.025, horizon - 30, w, h,
      'rgba(22, 36, 56, 0.88)', 'rgba(160, 195, 230, 0.14)', 200, 85, 4.1);
    this._mountains(ctx, cx * 0.045, horizon - 5, w, h,
      'rgba(9, 18, 30, 0.96)', 'rgba(130, 165, 205, 0.1)', 150, 65, 21.6);

    // Uzak sisli tepeler (0.08)
    this._hills(ctx, cx * 0.08, horizon + 30, w, h, 'rgba(14, 32, 42, 0.9)', 120, 0.0016, 11);
    // Orta tepeler (0.16)
    this._hills(ctx, cx * 0.16, horizon + 55, w, h, 'rgba(9, 24, 30, 0.95)', 90, 0.0026, 27);

    // Katman 3 — uzak ağaçlar (0.28)
    this._treeRow(ctx, cx * 0.28, horizon + 40, w, 190, 0.5, 'rgba(6, 20, 18, 0.85)', 3.7);
    // Katman 4 — orta ağaçlar (0.45)
    this._treeRow(ctx, cx * 0.45, horizon + 70, w, 250, 0.72, 'rgba(4, 15, 13, 0.92)', 8.3);
    // Katman 5 — YAKIN ağaçlar (0.58) — üçüncü sıra, sahneye derinlik/yoğunluk katıyor
    this._treeRow(ctx, cx * 0.58, horizon + 95, w, 300, 0.94, 'rgba(3, 11, 10, 0.97)', 15.9);

    // Ateş böcekleri (orta zemin, ağaçların önünde) — büyülü orman hissi
    this._fireflies(ctx, cx, cy, w, h, horizon);

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

    // Ön plan çalılık + parlayan mantarlar (parallax 0.7, en yakın katman)
    this._bushRow(ctx, cx * 0.7, horizon, w, 'rgba(2, 8, 7, 0.98)', '#0c1f16', true);
  }

  /* Silik bulut lekeleri — yavaş kayan, hafif saydam yumru gruplar */
  _clouds(ctx, off, w, h) {
    ctx.save();
    for (const c of this.clouds) {
      const cx0 = ((c.x * (w + c.w * 2) - off) % (w + c.w * 2)) - c.w;
      const cy0 = c.y * h * 0.6;
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = '#c9d6e8';
      for (let k = 0; k < 4; k++) {
        const bx = cx0 + k * c.w * 0.3 + noise1D(c.seed + k) * 14;
        const by = cy0 + Math.sin(k * 1.7 + c.seed) * 8;
        const r = c.w * (0.22 + noise1D(c.seed * 2 + k) * 0.12);
        ctx.beginPath(); ctx.ellipse(bx, by, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  /* Uzakta süzülen kuş V'leri — kanat çırpışı için sinüs açı animasyonu */
  _birds(ctx, off, w, h) {
    ctx.save();
    ctx.strokeStyle = 'rgba(10, 14, 22, 0.55)';
    ctx.lineWidth = 1.4;
    for (const b of this.birds) {
      const bx = ((b.x * (w + 200) - off * b.s) % (w + 200)) - 100;
      const by = b.y * h + Math.sin(this.time * 0.4 + b.p) * 10;
      const flap = 4 + Math.sin(this.time * 7 + b.p * 3) * 3;
      ctx.beginPath();
      ctx.moveTo(bx - 8, by - flap);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + 8, by - flap);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* Ateş böcekleri — yavaş dolaşan, yanıp sönen ışık noktaları */
  _fireflies(ctx, cx, cy, w, h, horizon) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.fireflies) {
      const fx = ((f.x * (w + 80) - cx * 0.5) % (w + 80)) - 40 + Math.sin(this.time * f.speed + f.p) * f.amp;
      const fy = f.baseY * horizon + Math.cos(this.time * f.speed * 0.8 + f.p) * f.amp * 0.6;
      if (fy < 0 || fy > horizon + 10) continue;
      const blink = 0.3 + Math.max(0, Math.sin(this.time * 1.8 + f.blinkP)) * 0.7;
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, 7);
      g.addColorStop(0, `rgba(${f.hue}, ${0.55 * blink})`);
      g.addColorStop(1, `rgba(${f.hue}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(fx, fy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(${f.hue}, ${0.9 * blink})`;
      ctx.fillRect(fx - 0.8, fy - 0.8, 1.6, 1.6);
    }
    ctx.restore();
  }

  /* En yakın katman: çalı/ot kümeleri + isteğe bağlı parlayan mantarlar.
     Ufuk çizgisine oturuyor, sahneyi kameraya en yakın noktada dolduruyor —
     piksel-blok filtresinden geçtiğinde net, okunaklı bir doku bırakır. */
  _bushRow(ctx, off, horizon, w, color, glowColor, mushrooms) {
    const spacing = 46;
    const start = Math.floor(off / spacing) - 1;
    const count = Math.ceil(w / spacing) + 3;
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const idx = start + i;
      const sx = idx * spacing - off;
      const r = hash(idx * 4.3);
      const bw = 30 + r * 22;
      const bh = 14 + r * 16;
      ctx.beginPath();
      ctx.ellipse(sx, horizon - bh * 0.3, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2);
      ctx.ellipse(sx - bw * 0.3, horizon - bh * 0.15, bw * 0.32, bh * 0.38, 0, 0, Math.PI * 2);
      ctx.ellipse(sx + bw * 0.32, horizon - bh * 0.18, bw * 0.3, bh * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();

      if (mushrooms && hash(idx * 9.1) > 0.72) {
        const gx = sx + (hash(idx * 6.6) - 0.5) * bw;
        const gy = horizon - 3;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 10);
        g.addColorStop(0, `${glowColor}55`);
        g.addColorStop(1, `${glowColor}00`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(gx, gy, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = glowColor;
        ctx.fillRect(gx - 1, gy - 1, 2, 2);
        ctx.restore();
        ctx.fillStyle = color;
      }
    }
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

    // Kanat çırpan yarasalar — mağaranın derinliklerinde süzülüyorlar
    this._bats(ctx, cx * 0.15, w, h);

    /* Vadiyi saran SİVRİ volkanik zirveler — ormandakiyle aynı `_mountains`
       fonksiyonu, ama kızıl/lav renginde. Zirve hattı ay ışığı yerine
       için için yanan lav parıltısıyla vurgulanıyor. */
    this._mountains(ctx, cx * 0.03, horizon - 20, w, h,
      'rgba(48, 16, 14, 0.85)', 'rgba(255, 130, 60, 0.16)', 210, 90, 6.4);
    this._mountains(ctx, cx * 0.05, horizon, w, h,
      'rgba(26, 8, 8, 0.95)', 'rgba(255, 100, 40, 0.12)', 155, 68, 33.2);
    // Zirvelerde için için yanan lav damarları
    this._lavaVeins(ctx, cx * 0.03, horizon - 20, w, 210, 90, 6.4);

    // Sarkıtlar (tavandan) — 0.12
    this._stalactites(ctx, cx * 0.12, w, h * 0.0, 'rgba(20, 6, 8, 0.9)', 0.6, 7);
    // Yakın sarkıtlar — 0.3
    this._stalactites(ctx, cx * 0.3, w, 0, 'rgba(12, 4, 5, 0.96)', 1.0, 23);

    // Uzak volkanik tepeler (yumuşak eteklikler, dağların önünde)
    this._hills(ctx, cx * 0.09, horizon + 30, w, h, 'rgba(38, 10, 10, 0.9)', 150, 0.0018, 61);
    this._hills(ctx, cx * 0.2, horizon + 60, w, h, 'rgba(22, 6, 6, 0.95)', 100, 0.003, 83);

    // Zeminde için için yanan çatlaklar
    this._fissures(ctx, cx * 0.4, horizon + 55, w);

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

    // Ön plan kayalık + için için yanan kristal/köz aksanları (en yakın katman)
    this._rockRow(ctx, cx * 0.65, horizon, w, 'rgba(10, 3, 3, 0.98)', '#ff6a28');
  }

  /* Yarasalar — kuşların karanlık kuzeni, çırpıntılı/düzensiz uçuş için
     çift-V kanat şekli ve daha hızlı flap frekansı kullanıyor. */
  _bats(ctx, off, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 3, 4, 0.7)';
    for (const b of this.bats) {
      const bx = ((b.x * (w + 160) - off * b.s) % (w + 160)) - 80;
      const by = b.y * h + Math.sin(this.time * 0.7 + b.p) * b.amp;
      const flap = Math.sin(this.time * 10 + b.p * 4);
      const wingY = 5 + flap * 4;
      ctx.beginPath();
      ctx.moveTo(bx - 9, by - wingY);
      ctx.lineTo(bx - 3, by);
      ctx.lineTo(bx, by - 2);
      ctx.lineTo(bx + 3, by);
      ctx.lineTo(bx + 9, by - wingY);
      ctx.lineTo(bx, by + 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* Dağ zirvelerinde için için yanan lav damarları — `_mountains`teki
     zirve formülüyle aynı tohumu kullanmıyor (kasıtlı: tam hizalanmayan
     birkaç parıltı gerçek magma çatlağı gibi rastgele duruyor). */
  _lavaVeins(ctx, off, baseY, w, peakH, step, seed) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let x = -step; x <= w + step; x += step) {
      const wx = x + off;
      const idx = Math.floor(wx / step);
      if (hash(idx * 7.7 + seed) < 0.62) continue;
      const y = baseY - hash(idx * 3.11 + seed) * peakH * (0.55 + hash(idx * 1.9) * 0.3);
      const pulse = 0.4 + Math.max(0, Math.sin(this.time * 1.4 + idx)) * 0.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
      g.addColorStop(0, `rgba(255, 140, 50, ${0.5 * pulse})`);
      g.addColorStop(1, 'rgba(255, 90, 30, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* Zeminde için için yanan çatlaklar — sığ, çatallı çizgiler, yanıp
     sönen köz rengiyle. */
  _fissures(ctx, off, groundY, w) {
    const spacing = 130;
    const start = Math.floor(off / spacing) - 1;
    ctx.save();
    for (let i = 0; i < Math.ceil(w / spacing) + 3; i++) {
      const idx = start + i;
      if (hash(idx * 5.3) < 0.55) continue;
      const sx = idx * spacing - off;
      const pulse = 0.3 + Math.max(0, Math.sin(this.time * 1.1 + idx * 2)) * 0.5;
      ctx.strokeStyle = `rgba(255, 110, 40, ${pulse})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, groundY);
      ctx.lineTo(sx + 10, groundY + 5);
      ctx.lineTo(sx + 5, groundY + 12);
      ctx.lineTo(sx + 16, groundY + 16);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* En yakın katman: sivri kaya kümeleri + için için yanan kristal/köz
     aksanları. `_bushRow`in taş versiyonu — yuvarlak yumrular yerine
     köşeli çokgenler. */
  _rockRow(ctx, off, horizon, w, color, glowColor) {
    const spacing = 52;
    const start = Math.floor(off / spacing) - 1;
    const count = Math.ceil(w / spacing) + 3;
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const idx = start + i;
      const sx = idx * spacing - off;
      const r = hash(idx * 4.7);
      const rw = 26 + r * 24;
      const rh = 16 + r * 22;
      ctx.beginPath();
      ctx.moveTo(sx - rw * 0.5, horizon);
      ctx.lineTo(sx - rw * 0.28, horizon - rh * 0.7);
      ctx.lineTo(sx - rw * 0.05, horizon - rh);
      ctx.lineTo(sx + rw * 0.2, horizon - rh * 0.55);
      ctx.lineTo(sx + rw * 0.5, horizon);
      ctx.closePath();
      ctx.fill();

      if (hash(idx * 8.4) > 0.68) {
        const gx = sx + (hash(idx * 6.1) - 0.5) * rw * 0.6;
        const gy = horizon - rh * 0.5;
        const pulse = 0.5 + Math.max(0, Math.sin(this.time * 2.2 + idx)) * 0.5;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 9);
        g.addColorStop(0, `${glowColor}${Math.round(pulse * 130).toString(16).padStart(2, '0')}`);
        g.addColorStop(1, `${glowColor}00`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(gx, gy, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = glowColor;
        ctx.fillRect(gx - 1, gy - 1, 2, 2);
        ctx.restore();
        ctx.fillStyle = color;
      }
    }
  }

  /* ======================================================================
     Yardımcı çizim fonksiyonları
     ====================================================================== */

  /* Sivri dağ silueti — `_hills`in yumuşak dalgalı hattından farklı olarak
     düz çizgi segmentleriyle KESKİN zirveler oluşturuyor (klasik uzak dağ
     silüeti). `rimColor` verilirse zirve hattı ince, soluk bir ay ışığı
     çizgisiyle vurgulanır — vadinin iki yanını saran dağlar hissini
     güçlendiriyor. */
  _mountains(ctx, off, baseY, w, h, color, rimColor, peakH, step, seed) {
    const pts = [];
    for (let x = -step; x <= w + step; x += step) {
      const wx = x + off;
      const idx = Math.floor(wx / step);
      const y = baseY - hash(idx * 3.11 + seed) * peakH;
      pts.push([x, y]);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-step, h + 10);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(w + step, h + 10);
    ctx.closePath();
    ctx.fill();

    if (rimColor) {
      ctx.strokeStyle = rimColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.stroke();
    }
  }

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
