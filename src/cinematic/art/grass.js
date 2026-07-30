/* ==========================================================================
   Ot Tarlası — sahnenin kalbi

   "Uçsuz bucaksız yeşil otlar" istenen şey buydu. Üç katmandan oluşuyor:

     1. drawMeadowGround  — zemin gradyanı + rüzgar dalgaları (uzak)
     2. drawGrassTufts    — orta mesafede ot öbekleri, derinliğe göre küçülür
     3. drawForegroundGrass — kadrajın altındaki iri yapraklar, güçlü salınım

   ÖNEMLİ: 1 ve 2 yağlı boya görselle değiştirilebilir. 3 DEĞİŞMEMELİ —
   statik bir görselin üstünde hareket eden ön plan otları, tüm sahneyi
   canlandıran şey. Yağlı boyaya geçince bile bu katman kodda kalsın.
   ========================================================================== */

import { VW, VH } from '../stage.js';
import { rgba } from './palette.js';
import { seeded, noise1 } from '../rng.js';

const PAD = 700;

/** Rüzgar alanı: konum + zamana göre salınım miktarı (-1..1) */
export function wind(x, y, t, strength = 1) {
  return (
    noise1(x * 0.0032 + t * 1.15) * 0.55 +
    noise1(x * 0.011 - y * 0.004 + t * 2.1) * 0.30 +
    Math.sin(x * 0.02 + t * 3.4) * 0.15
  ) * strength;
}

/* --------------------------------------------------------------------------
   1. Zemin — ufuktan kadraj altına uzanan çayır
   -------------------------------------------------------------------------- */

export function drawMeadowGround(ctx, p, t, opts = {}) {
  const horizon = opts.horizon ?? VH * 0.62;
  const windAmt = opts.wind ?? 1;

  /* Ana gradyan: ufukta puslu ve açık, önde koyu ve doygun */
  const g = ctx.createLinearGradient(0, horizon - 10, 0, VH + 240);
  g.addColorStop(0, p.grassTip);
  g.addColorStop(0.10, p.grassHi);
  g.addColorStop(0.42, p.grassMid);
  g.addColorStop(1, p.grassLow);
  ctx.fillStyle = g;
  ctx.fillRect(-PAD, horizon - 12, VW + PAD * 2, VH - horizon + 260);

  /* Rüzgar dalgaları — tarlanın üstünden geçen açık/koyu bantlar.
     Bu efekt sahneye "nefes" veriyor; tek başına çok iş görüyor. */
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  const bands = 14;
  for (let i = 0; i < bands; i++) {
    const f = i / bands;
    const y = horizon + Math.pow(f, 1.7) * (VH - horizon + 200);
    const h = 14 + f * 46;
    const phase = t * (0.5 + f * 1.5) + i * 1.7;
    const a = (0.07 + f * 0.16) * windAmt;

    ctx.beginPath();
    ctx.moveTo(-PAD, y);
    for (let x = -PAD; x <= VW + PAD; x += 26) {
      ctx.lineTo(x, y + noise1(x * 0.0026 + phase) * h * 0.55);
    }
    ctx.lineTo(VW + PAD, y + h);
    for (let x = VW + PAD; x >= -PAD; x -= 26) {
      ctx.lineTo(x, y + h + noise1(x * 0.0026 + phase + 0.8) * h * 0.55);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(255, 245, 200, ${a})`;
    ctx.fill();
  }
  ctx.restore();

  /* Ufuk çizgisinde sıcak ışık sızıntısı */
  const lip = ctx.createLinearGradient(0, horizon - 26, 0, horizon + 46);
  lip.addColorStop(0, `rgba(${p.fog}, 0.55)`);
  lip.addColorStop(1, `rgba(${p.fog}, 0)`);
  ctx.fillStyle = lip;
  ctx.fillRect(-PAD, horizon - 26, VW + PAD * 2, 72);
}

/* --------------------------------------------------------------------------
   2. Ot öbekleri — orta mesafe
   -------------------------------------------------------------------------- */

export function drawGrassTufts(ctx, p, t, opts = {}) {
  const horizon = opts.horizon ?? VH * 0.62;
  const count = opts.count ?? 260;
  const seed = opts.seed ?? 11;
  const windAmt = opts.wind ?? 1;
  const spanX = opts.spanX ?? VW + 900;
  const bottom = opts.bottom ?? VH + 160;

  /* Derinlik dağılımı düz olmalı: pow(r,1.5) kullanınca öbeklerin çoğu ufka
     yığılıyor, orta plan boş kalıyordu. Şimdi hafifçe ÖNE ağırlıklı. */
  const tufts = seeded('tufts', seed, count, (r) => ({
    x: r() * spanX - 450,
    d: Math.pow(r(), 0.82),         // 0 = ufuk, 1 = ön plan
    blades: 3 + Math.floor(r() * 5),
    lean: (r() - 0.5) * 0.6,
    hv: 0.7 + r() * 0.6,
    ph: r() * 6.28
  }));

  /* Uzaktakiler önce çizilsin */
  tufts.sort((a, b) => a.d - b.d);

  /* --- TOPLU ÇİZİM ---
     Her yaprağı ayrı ayrı stroke() etmek kare maliyetinin yarısını yiyordu
     (~5000 çağrı/kare). Çizgi kalınlığı ve rengi kovalara yuvarlanıp aynı
     kovadaki tüm yapraklar TEK path'te toplanıyor: ~5000 çağrı → ~15.
     Görsel fark gözle ayırt edilemiyor, maliyet 5 kat düşüyor. */
  const buckets = new Map();
  const bucketFor = (color, width) => {
    /* Kalınlığı 0.6px adımlara yuvarla — insan gözü bu farkı görmez */
    const w = Math.max(0.9, Math.round(width / 0.6) * 0.6);
    const key = `${color}|${w}`;
    let b = buckets.get(key);
    /* Path2D yerine düz sayı dizisi: aynı hız, hiçbir tarayıcı/çalışma
       ortamı bağımlılığı yok (başsız testler de çalışsın diye). */
    if (!b) { b = { color, w, seg: [] }; buckets.set(key, b); }
    return b;
  };

  /* Görünmeyen öbekleri hiç işleme — kamera hangi aralığı görüyorsa onu çiz.
     viewX verilmezse her şey çizilir (geriye dönük uyumluluk). */
  const viewX = opts.viewX;
  const cullPad = opts.cullPad ?? 260;

  for (const tf of tufts) {
    if (viewX !== undefined && (tf.x < viewX - cullPad || tf.x > viewX + VW + cullPad)) continue;

    /* Perspektif: derinlik arttıkça öbek hem aşağı iner hem HIZLA büyür.
       Önceki eğri (y için d^1.7, boy için doğrusal) her şeyi ufka yığıp
       aynı boyda bırakıyordu — tarla "çıkartma" gibi görünüyordu. */
    const y = horizon + Math.pow(tf.d, 1.22) * (bottom - horizon);
    const depth = 0.14 + Math.pow(tf.d, 1.5) * 0.86;
    const h = (5 + depth * 84) * tf.hv;
    const w = Math.max(0.9, depth * 4.4);
    const sway = wind(tf.x, y, t + tf.ph * 0.1, windAmt) * (5 + depth * 26);

    /* Derinliğe göre renk: uzak = puslu ve açık, yakın = koyu.
       Opaklık da kovalanıyor, yoksa kova sayısı patlar. */
    const col = tf.d < 0.45 ? p.grassHi : p.grassMid;
    const alphaStep = Math.round((0.35 + depth * 0.5) * 8) / 8;
    const body = bucketFor(rgba(col, alphaStep), w);

    for (let i = 0; i < tf.blades; i++) {
      const off = (i - tf.blades / 2) * w * 1.5;
      const bx = tf.x + off;
      const bl = h * (0.65 + (i % 3) * 0.2);
      const tipX = bx + sway * (0.8 + (i % 2) * 0.4) + tf.lean * bl;
      body.seg.push(bx, y, bx + sway * 0.28, y - bl * 0.6, tipX, y - bl);
    }

    /* Uç ışığı — yakın öbeklerde altın kenar */
    if (tf.d > 0.5) {
      const rimA = Math.round((tf.d - 0.5) * 0.34 * 16) / 16;
      if (rimA > 0.01) {
        const tip = bucketFor(`rgba(${p.rim}, ${rimA})`, Math.max(0.7, w * 0.45));
        const bl = h;
        tip.seg.push(
          tf.x, y - bl * 0.42,
          tf.x + sway * 0.5, y - bl * 0.78,
          tf.x + sway + tf.lean * bl, y - bl
        );
      }
    }
  }

  ctx.save();
  ctx.lineCap = 'round';
  for (const b of buckets.values()) {
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.w;
    ctx.beginPath();
    for (let i = 0; i < b.seg.length; i += 6) {
      ctx.moveTo(b.seg[i], b.seg[i + 1]);
      ctx.quadraticCurveTo(b.seg[i + 2], b.seg[i + 3], b.seg[i + 4], b.seg[i + 5]);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Çayır çiçekleri — beyaz/sarı noktalar, sahneye sıcaklık katar */
export function drawWildflowers(ctx, p, t, opts = {}) {
  const horizon = opts.horizon ?? VH * 0.62;
  const count = opts.count ?? 70;
  const seed = opts.seed ?? 55;
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0.001) return;

  const flowers = seeded('flowers', seed, count, (r) => ({
    x: r() * (VW + PAD * 2) - PAD,
    d: 0.25 + Math.pow(r(), 1.4) * 0.75,
    kind: r(),
    ph: r() * 6.28
  }));

  ctx.save();
  for (const f of flowers) {
    const y = horizon + Math.pow(f.d, 1.7) * (VH + 140 - horizon);
    const depth = 0.2 + f.d * 0.8;
    const r0 = 1.1 + depth * 2.6;
    const sway = wind(f.x, y, t + f.ph * 0.1, 1) * depth * 14;
    const col = f.kind > 0.62 ? '255, 246, 214' : (f.kind > 0.3 ? '250, 210, 120' : '226, 200, 240');
    ctx.fillStyle = `rgba(${col}, ${(0.3 + depth * 0.5) * alpha})`;
    ctx.beginPath();
    ctx.arc(f.x + sway, y - depth * 16, r0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* --------------------------------------------------------------------------
   3. Ön plan otları — BU KATMAN HER ZAMAN PROSEDÜREL KALSIN
   -------------------------------------------------------------------------- */

export function drawForegroundGrass(ctx, p, t, opts = {}) {
  const count = opts.count ?? 46;
  const seed = opts.seed ?? 99;
  const baseY = opts.baseY ?? VH + 90;
  const windAmt = opts.wind ?? 1.25;
  const alpha = opts.alpha ?? 1;
  const color = opts.color || p.grassLow;

  /* Ön plan bir KÜTLE olmalı, dağınık dikenler değil.
     Bu yüzden hem sayı yüksek hem de boy dağılımı geniş: kısa olanlar
     alt kenarda kapalı bir bant kurar, uzun olanlar kadraja girer. */
  const blades = seeded('fgGrass', seed, count, (r) => {
    const tall = r();
    return {
      x: r() * (VW + 420) - 210,
      h: 60 + Math.pow(tall, 1.6) * 280,
      w: 4 + r() * 10 + tall * 6,
      lean: (r() - 0.5) * 0.85,
      ph: r() * 6.28,
      sp: 0.75 + r() * 0.6,
      curl: 0.3 + r() * 0.7
    };
  });

  ctx.save();
  ctx.globalAlpha = alpha;
  for (const b of blades) {
    const sway = wind(b.x, baseY, t * b.sp + b.ph, windAmt) * (16 + b.h * 0.16);
    const tipX = b.x + sway + b.lean * b.h * 0.5;
    const tipY = baseY - b.h;
    const midX = b.x + sway * 0.32 + b.lean * b.h * 0.16;
    const midY = baseY - b.h * 0.55;

    /* Yaprak gövdesi — tabanda geniş, uçta sivri */
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(b.x - b.w / 2, baseY);
    ctx.quadraticCurveTo(midX - b.w * 0.3, midY, tipX, tipY);
    ctx.quadraticCurveTo(midX + b.w * 0.34, midY + b.h * 0.06, b.x + b.w / 2, baseY);
    ctx.closePath();
    ctx.fill();

    /* Rüzgara bakan kenarda ince ışık — silueti ölü olmaktan kurtarır */
    ctx.strokeStyle = `rgba(${p.rim}, 0.13)`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(b.x + b.w * 0.3, baseY - b.h * 0.05);
    ctx.quadraticCurveTo(midX + b.w * 0.2, midY, tipX, tipY);
    ctx.stroke();
  }
  ctx.restore();
}

/** Karakterin ot arasından geçerken açtığı iz — ayak hizasında ezilen otlar */
export function drawTrampledGrass(ctx, p, t, actor, opts = {}) {
  if (!actor || actor.alpha <= 0.01) return;
  const spread = opts.spread ?? 54;
  const count = opts.count ?? 10;
  const s = actor.scale ?? 1;

  ctx.save();
  ctx.strokeStyle = rgba(p.grassLow, 0.55 * (actor.alpha ?? 1));
  ctx.lineWidth = 2.2 * s;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1) - 0.5;
    const bx = actor.x + f * spread * s;
    const by = actor.y;
    const push = -Math.sign(actor.speed || 1) * (14 - Math.abs(f) * 16) * s;
    const h = (10 + Math.abs(f) * 14) * s;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + push * 0.4, by - h * 0.6, bx + push, by - h * 0.35);
    ctx.stroke();
  }
  ctx.restore();
}
