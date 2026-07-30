/* ==========================================================================
   Gökyüzü — gradyan, güneş, bulutlar, yıldızlar

   En arkadaki katman. Parallax'ı çok düşük (0.03-0.08), yani kamera
   kaydığında neredeyse yerinde durur — derinlik hissi buradan doğar.

   Yağlı boya görselle değiştirmeye EN uygun katman bu.
   ========================================================================== */

import { VW, VH } from '../stage.js';
import { rgba } from './palette.js';
import { seeded, noise1 } from '../rng.js';

/* Parallax nedeniyle kadrajın dışına taşabiliriz — geniş çiz */
const PAD = 700;

export function drawSky(ctx, p, t, opts = {}) {
  const horizon = opts.horizon ?? VH * 0.62;

  const g = ctx.createLinearGradient(0, -PAD * 0.4, 0, horizon + 60);
  g.addColorStop(0, p.skyTop);
  g.addColorStop(0.42, p.skyMid);
  g.addColorStop(0.82, p.skyLow);
  g.addColorStop(1, p.skyHaze);
  ctx.fillStyle = g;
  ctx.fillRect(-PAD, -PAD, VW + PAD * 2, horizon + PAD + 60);
}

/** Yıldızlar — sadece koyu paletlerde görünür */
export function drawStars(ctx, t, opts = {}) {
  const count = opts.count ?? 90;
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0.001) return;

  const stars = seeded('stars', opts.seed ?? 7, count, (r) => ({
    x: r() * (VW + PAD * 2) - PAD,
    y: r() * VH * 0.55 - 100,
    r: r() * 1.3 + 0.35,
    tw: r() * 6.28,
    sp: r() * 1.6 + 0.5
  }));

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of stars) {
    const a = alpha * (0.32 + Math.sin(t * s.sp + s.tw) * 0.28);
    if (a <= 0) continue;
    ctx.fillStyle = `rgba(226, 232, 255, ${Math.max(0, a)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Güneş / batan güneş — diskle birlikte geniş atmosferik parıltı */
export function drawSun(ctx, p, t, opts = {}) {
  const x = opts.x ?? VW * 0.72;
  const y = opts.y ?? VH * 0.30;
  const r = opts.r ?? 46;
  const glow = opts.glow ?? 1;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  /* Geniş atmosfer parıltısı.
     Dolgu dikdörtgeni gradyan yarıçapından BÜYÜK olmalı; aksi halde parıltı
     kenarda aniden kesilir ve gökyüzünde dikey bir çizgi belirir. */
  const haloR = r * 11 * glow;
  const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, haloR);
  halo.addColorStop(0, `rgba(${p.sunGlow}, ${0.42 * glow})`);
  halo.addColorStop(0.25, `rgba(${p.sunGlow}, ${0.14 * glow})`);
  halo.addColorStop(1, `rgba(${p.sunGlow}, 0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(x - haloR - 4, y - haloR - 4, haloR * 2 + 8, haloR * 2 + 8);

  /* Disk */
  const pulse = 1 + Math.sin(t * 0.7) * 0.02;
  const core = ctx.createRadialGradient(x, y, 0, x, y, r * pulse);
  core.addColorStop(0, rgba(p.sun, 0.98));
  core.addColorStop(0.7, rgba(p.sun, 0.8));
  core.addColorStop(1, `rgba(${p.sunGlow}, 0.1)`);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Bulutlar — üst üste binen yumuşak elipsler.
 * Rüzgarla yavaşça sürüklenir; noise1 ile kenarları dalgalanır.
 */
export function drawClouds(ctx, p, t, opts = {}) {
  const count = opts.count ?? 7;
  const drift = opts.drift ?? 9;
  const yBase = opts.y ?? VH * 0.20;
  const alpha = opts.alpha ?? 0.5;
  const tintHi = opts.tintHi || p.skyHaze;
  const tintLo = opts.tintLo || p.skyMid;

  const clouds = seeded('clouds', opts.seed ?? 21, count, (r) => ({
    x: r() * (VW + PAD * 2) - PAD,
    y: yBase + (r() - 0.5) * VH * 0.26,
    w: 150 + r() * 300,
    h: 26 + r() * 40,
    sp: 0.4 + r() * 1.1,
    blobs: 4 + Math.floor(r() * 4),
    ph: r() * 6.28,
    op: 0.45 + r() * 0.55
  }));

  ctx.save();
  for (const c of clouds) {
    const x = ((c.x + t * drift * c.sp) % (VW + PAD * 3)) - PAD * 1.5;
    const y = c.y + Math.sin(t * 0.25 + c.ph) * 5;
    const a = alpha * c.op;

    /* Tek gövde, tek dolgu.
       Her yumruyu ayrı gradyanla çizmek "boncuk dizisi" görünümü veriyordu;
       eş merkezli üç geçiş ise halka konturları çıkarıyordu. Doğrusu iki geçiş:
       gövde + tepede daha küçük bir ışık yaması. Kontur oluşmuyor çünkü
       ikinci geçiş birincinin merkezinde değil, YUKARISINDA duruyor. */
    /* TEK path, TEK dolgu, dikey gradyan.
       İki geçiş üst üste binince kenarlarında halka konturu oluşuyordu.
       Hacim hissi artık üst üste bindirmeden değil, gradyandan geliyor:
       tepesi ışık alıyor, tabanı gölgede. */
    let top = y, bottom = y;
    ctx.beginPath();
    for (let i = 0; i < c.blobs; i++) {
      const f = i / Math.max(1, c.blobs - 1);
      const bx = x + (f - 0.5) * c.w;
      const wobble = noise1(t * 0.35 + c.ph + i) * 5;
      const lift = Math.sin(f * Math.PI);
      const by = y - lift * c.h * 0.30 + wobble;
      const br = c.h * (0.60 + lift * 0.80);
      ctx.ellipse(bx, by, br * 1.7, br, 0, 0, Math.PI * 2);
      top = Math.min(top, by - br);
      bottom = Math.max(bottom, by + br);
    }
    /* Yassı taban — bulutlar altta düz oturur */
    ctx.ellipse(x, y + c.h * 0.14, c.w * 0.52, c.h * 0.32, 0, 0, Math.PI * 2);

    const cg = ctx.createLinearGradient(0, top, 0, bottom);
    cg.addColorStop(0, rgba(tintHi, a * 0.52));
    cg.addColorStop(0.45, rgba(tintHi, a * 0.34));
    cg.addColorStop(1, rgba(tintLo, a * 0.30));
    ctx.fillStyle = cg;
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Ufuk pusu — gökyüzü ile arazi arasındaki geçişi yumuşatır.
 * Bu tek şerit, sahnenin "derin" görünmesinin yarısını sağlar.
 */
export function drawHaze(ctx, p, opts = {}) {
  const horizon = opts.horizon ?? VH * 0.62;
  const height = opts.height ?? 190;
  const strength = opts.strength ?? 0.55;

  const g = ctx.createLinearGradient(0, horizon - height, 0, horizon + 40);
  g.addColorStop(0, `rgba(${p.fog}, 0)`);
  g.addColorStop(0.65, `rgba(${p.fog}, ${strength * 0.5})`);
  g.addColorStop(1, `rgba(${p.fog}, ${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(-PAD, horizon - height, VW + PAD * 2, height + 60);
}

/** Uçan kuş sürüsü — "V" dizilimi, kanat çırpma */
export function drawBirds(ctx, t, opts = {}) {
  const count = opts.count ?? 9;
  const x0 = opts.x ?? VW * 1.15;
  const y0 = opts.y ?? VH * 0.22;
  const speed = opts.speed ?? 46;
  const alpha = opts.alpha ?? 0.7;
  const color = opts.color || '20, 18, 26';
  if (alpha <= 0.001) return;

  const flock = seeded('birds', opts.seed ?? 33, count, (r, i) => ({
    ox: (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (16 + r() * 8),
    oy: Math.ceil(i / 2) * (9 + r() * 5),
    ph: r() * 6.28,
    sp: 5.5 + r() * 2.4,
    sc: 0.7 + r() * 0.5
  }));

  const headX = x0 - t * speed;
  const headY = y0 + Math.sin(t * 0.5) * 16;

  ctx.save();
  ctx.strokeStyle = `rgba(${color}, ${alpha})`;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  for (const b of flock) {
    const bx = headX + b.ox;
    const by = headY + b.oy + Math.sin(t * 0.6 + b.ph) * 4;
    const flap = Math.sin(t * b.sp + b.ph);
    const s = 5 * b.sc;
    ctx.beginPath();
    ctx.moveTo(bx - s, by - flap * s * 0.55);
    ctx.quadraticCurveTo(bx - s * 0.35, by + s * 0.28, bx, by);
    ctx.quadraticCurveTo(bx + s * 0.35, by + s * 0.28, bx + s, by - flap * s * 0.55);
    ctx.stroke();
  }
  ctx.restore();
}
