/* ==========================================================================
   Atmosfer Efektleri

   Bu dosyadaki hiçbir şey "gerekli" değil — ama sahneyi çizimden görüntüye
   çeviren şey bunlar. Işık huzmesi olmayan bir çayır fotoğraf gibi durur;
   huzme eklendiği an sinema olur.

   Hepsi prosedürel kalmalı: yağlı boya arka planın üstünde hareket eden
   parçacıklar, statik görseli canlı gösteren tek numara.
   ========================================================================== */

import { VW, VH } from '../stage.js';
import { seeded, noise1 } from '../rng.js';

/* --------------------------------------------------------------------------
   Havada süzülen zerreler — polen, toz, ateş böceği
   -------------------------------------------------------------------------- */

export function drawMotes(ctx, p, t, o = {}) {
  const count = o.count ?? 90;
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.001) return;

  const color = o.color || p.mote;
  const spanX = o.spanX ?? VW + 900;
  const spanY = o.spanY ?? VH + 300;
  const rise = o.rise ?? 16;
  const twinkle = o.twinkle ?? true;

  const motes = seeded('motes', o.seed ?? 4, count, (r) => ({
    x: r() * spanX - 450,
    y: r() * spanY - 150,
    r: 0.7 + r() * 2.3,
    sp: 0.35 + r() * 1.0,
    ph: r() * 6.28,
    drift: (r() - 0.5) * 22
  }));

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const m of motes) {
    const y = ((m.y - t * rise * m.sp) % spanY + spanY) % spanY - 150;
    const x = m.x + Math.sin(t * 0.5 * m.sp + m.ph) * m.drift + noise1(t * 0.3 + m.ph) * 12;
    const tw = twinkle ? 0.45 + Math.sin(t * 2.1 * m.sp + m.ph) * 0.45 : 0.75;
    const a = alpha * tw * 0.5;
    if (a <= 0.005) continue;

    const g = ctx.createRadialGradient(x, y, 0, x, y, m.r * 4.2);
    g.addColorStop(0, `rgba(${color}, ${a})`);
    g.addColorStop(0.35, `rgba(${color}, ${a * 0.4})`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, m.r * 4.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* --------------------------------------------------------------------------
   Işık huzmeleri — güneşten yayılan hacimsel ışınlar
   -------------------------------------------------------------------------- */

export function drawLightShafts(ctx, p, t, o = {}) {
  const alpha = o.alpha ?? 0.5;
  if (alpha <= 0.001) return;

  const sx = o.x ?? VW * 0.72;
  const sy = o.y ?? VH * 0.28;
  const count = o.count ?? 7;
  const len = o.len ?? VH * 1.5;
  const color = o.color || p.sunGlow;
  const spread = o.spread ?? 0.85;

  /* Huzmeler güneşten AŞAĞI doğru düşer.
     rotate(0) yerel +y eksenini aşağı bakar bırakır; tilt ile sola/sağa yatırılır.
     (İlk sürümde taban açı π/2 idi ve huzmeler yatay uçuyordu.) */
  const tilt = o.tilt ?? (sx > VW * 0.5 ? 0.42 : -0.42);

  const shafts = seeded('shafts', o.seed ?? 9, count, (r) => ({
    a: (r() - 0.5) * spread + tilt,
    w: 0.015 + r() * 0.045,
    op: 0.35 + r() * 0.65,
    sp: 0.1 + r() * 0.25,
    ph: r() * 6.28
  }));

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of shafts) {
    const ang = s.a + Math.sin(t * s.sp + s.ph) * 0.035;
    const w = s.w + Math.sin(t * s.sp * 1.7 + s.ph) * 0.012;
    const a = alpha * s.op * (0.55 + Math.sin(t * 0.42 + s.ph) * 0.45);
    if (a <= 0.004) continue;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(${color}, 0)`);
    g.addColorStop(0.10, `rgba(${color}, ${a * 0.30})`);
    g.addColorStop(0.42, `rgba(${color}, ${a * 0.11})`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-len * w, len);
    ctx.lineTo(len * w, len);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/* --------------------------------------------------------------------------
   Kor ve kıvılcım — ejderha uyanırken
   -------------------------------------------------------------------------- */

export function drawEmbers(ctx, p, t, o = {}) {
  const count = o.count ?? 70;
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.001) return;

  const originX = o.x ?? VW * 0.5;
  const originY = o.y ?? VH * 0.85;
  const spread = o.spread ?? VW * 0.8;
  const rise = o.rise ?? 90;

  const embers = seeded('embers', o.seed ?? 17, count, (r) => ({
    x: (r() - 0.5) * spread,
    ph: r(),
    sp: 0.5 + r() * 1.1,
    r: 0.9 + r() * 2.1,
    drift: (r() - 0.5) * 60,
    life: 2.2 + r() * 2.6
  }));

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const e of embers) {
    const life = ((t / e.life) + e.ph) % 1;
    const y = originY - life * rise * e.life * e.sp;
    const x = originX + e.x + Math.sin(t * 1.4 * e.sp + e.ph * 6.28) * e.drift * life;
    const a = alpha * Math.sin(life * Math.PI) * 0.85;
    if (a <= 0.005) continue;

    const r0 = e.r * (1.2 - life * 0.5);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r0 * 5);
    g.addColorStop(0, `rgba(255, 220, 150, ${a})`);
    g.addColorStop(0.25, `rgba(255, 120, 40, ${a * 0.6})`);
    g.addColorStop(1, 'rgba(180, 30, 10, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r0 * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* --------------------------------------------------------------------------
   Yer sisi — ufuk çizgisiyle ön plan arasını yumuşatır
   -------------------------------------------------------------------------- */

export function drawGroundMist(ctx, p, t, o = {}) {
  const y = o.y ?? VH * 0.72;
  const alpha = o.alpha ?? 0.4;
  const count = o.count ?? 4;
  const band = o.band ?? 90;      // her şeridin kalınlığı
  if (alpha <= 0.001) return;

  /* Sis SADECE ufuk bandında kalmalı.
     İlk sürümde her şerit ekranın altına kadar doluyordu ve tüm zemini
     bej bir perdeye çeviriyordu. Artık her şerit dikey gradyanla sönüyor. */
  ctx.save();
  for (let i = 0; i < count; i++) {
    const f = i / Math.max(1, count - 1);
    const my = y + f * 96;
    const drift = t * (4 + f * 10);
    const wobble = 16 + f * 26;
    const a = alpha * (1 - f * 0.6) * 0.4;
    if (a <= 0.003) continue;

    const g = ctx.createLinearGradient(0, my - wobble, 0, my + band);
    g.addColorStop(0, `rgba(${p.fog}, 0)`);
    g.addColorStop(0.35, `rgba(${p.fog}, ${a})`);
    g.addColorStop(1, `rgba(${p.fog}, 0)`);

    ctx.beginPath();
    ctx.moveTo(-500, my + band);
    for (let x = -500; x <= VW + 500; x += 30) {
      ctx.lineTo(x, my + noise1((x + drift) * 0.0032 + i * 2.2) * wobble);
    }
    ctx.lineTo(VW + 500, my + band);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();
}

/* --------------------------------------------------------------------------
   Yükselen ışık zerreleri — kabul finalinde "iyi his" efekti
   -------------------------------------------------------------------------- */

export function drawAscendingSparks(ctx, p, t, o = {}) {
  const count = o.count ?? 42;
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.001) return;

  const cx = o.x ?? VW * 0.5;
  const cy = o.y ?? VH * 0.8;
  const spread = o.spread ?? 320;

  const sparks = seeded('ascend', o.seed ?? 23, count, (r) => ({
    x: (r() - 0.5) * spread,
    ph: r(),
    sp: 0.28 + r() * 0.5,
    r: 1.1 + r() * 1.9,
    wob: 14 + r() * 30
  }));

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of sparks) {
    const life = ((t * s.sp * 0.32) + s.ph) % 1;
    const y = cy - life * 380;
    const x = cx + s.x + Math.sin(life * 7 + s.ph * 6.28) * s.wob;
    const a = alpha * Math.sin(life * Math.PI) * 0.7;
    if (a <= 0.005) continue;

    const g = ctx.createRadialGradient(x, y, 0, x, y, s.r * 5);
    g.addColorStop(0, `rgba(255, 244, 214, ${a})`);
    g.addColorStop(0.3, `rgba(${p.rim}, ${a * 0.5})`);
    g.addColorStop(1, `rgba(${p.rim}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, s.r * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* --------------------------------------------------------------------------
   Lens parlaması — güneşe doğrudan bakan kadrajlarda
   -------------------------------------------------------------------------- */

export function drawLensFlare(ctx, p, t, o = {}) {
  const alpha = o.alpha ?? 0.4;
  if (alpha <= 0.001) return;
  const sx = o.x ?? VW * 0.72;
  const sy = o.y ?? VH * 0.3;
  const cx = VW / 2, cy = VH / 2;
  const dx = cx - sx, dy = cy - sy;

  const ghosts = [
    { d: 0.32, r: 26, a: 0.16 },
    { d: 0.58, r: 14, a: 0.11 },
    { d: 0.85, r: 40, a: 0.09 },
    { d: 1.24, r: 20, a: 0.12 },
    { d: 1.66, r: 60, a: 0.07 }
  ];

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.85 + Math.sin(t * 0.8) * 0.15;
  for (const gh of ghosts) {
    const x = sx + dx * gh.d * 2;
    const y = sy + dy * gh.d * 2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, gh.r * 2.4);
    g.addColorStop(0, `rgba(${p.sunGlow}, ${gh.a * alpha * pulse})`);
    g.addColorStop(1, `rgba(${p.sunGlow}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, gh.r * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Yatay anamorfik çizgi */
  const g2 = ctx.createLinearGradient(sx - 420, sy, sx + 420, sy);
  g2.addColorStop(0, `rgba(${p.sunGlow}, 0)`);
  g2.addColorStop(0.5, `rgba(${p.sunGlow}, ${0.14 * alpha * pulse})`);
  g2.addColorStop(1, `rgba(${p.sunGlow}, 0)`);
  ctx.fillStyle = g2;
  ctx.fillRect(sx - 420, sy - 2.5, 840, 5);
  ctx.restore();
}
