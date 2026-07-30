/* ==========================================================================
   Ejderha — tek gövde, iki hayat

   Aynı çizim fonksiyonu hem "ölü ejderha" hem "uyanan ejderha" için kullanılıyor.
   Fark sadece parametrelerde:

     rise  0 → başı yerde, ölü        1 → boyun dimdik, uyanık
     eye   0 → sönük                  1 → cehennem gibi parlıyor
     maw   0 → çene kapalı            1 → ağız sonuna kadar açık

   Böylece "ret" finalinde ejderhayı diriltmek için yeni bir varlık çizmiyoruz —
   timeline'da bu üç sayıyı 0'dan 1'e sürüklüyoruz. Sahne kendi kendine oluyor.
   ========================================================================== */

import { seeded, noise1 } from '../rng.js';

export function drawDragon(ctx, p, t, o = {}) {
  const x = o.x ?? 0;
  const y = o.y ?? 0;
  const s = o.scale ?? 1;
  const facing = o.facing ?? 1;
  const rise = o.rise ?? 0;
  const eye = o.eye ?? 0;
  const maw = o.maw ?? 0;
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.01) return;

  const skin = o.skin || '#0e0c14';
  const skinLo = o.skinLo || '#08070c';
  const membrane = o.membrane || '#1a0f18';
  const rim = `rgba(${p.rim}, ${o.rimStrength ?? 0.55})`;

  /* Ölüyken hafif göğüs hareketi bile yok; uyanınca nefes alır */
  const breath = rise > 0.05 ? Math.sin(t * 2.4) * 2.6 * rise : 0;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(facing * s, s);

  /* ---------- Zemin gölgesi ---------- */
  ctx.save();
  ctx.globalAlpha = alpha * 0.42;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(-20, 4, 250, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  /* ---------- Kuyruk ---------- */
  const tailWag = rise * Math.sin(t * 1.6) * 14;
  ctx.strokeStyle = skin;
  ctx.lineCap = 'round';
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.moveTo(120, -34);
  ctx.quadraticCurveTo(250, -18 + tailWag * 0.4, 330, -46 - tailWag);
  ctx.stroke();
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(320, -44 - tailWag * 0.9);
  ctx.quadraticCurveTo(378, -52 - tailWag * 1.3, 408, -20 - tailWag * 1.6);
  ctx.stroke();
  /* Kuyruk ucu bıçağı */
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(404, -24 - tailWag * 1.6);
  ctx.lineTo(438, -34 - tailWag * 1.9);
  ctx.lineTo(410, -6 - tailWag * 1.4);
  ctx.closePath();
  ctx.fill();

  /* ---------- Arka bacak ---------- */
  ctx.fillStyle = skinLo;
  ctx.beginPath();
  ctx.ellipse(96, -34, 48, 34, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = skinLo;
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(104, -22);
  ctx.quadraticCurveTo(126, -6, 116, 0);
  ctx.stroke();

  /* ---------- Gövde ---------- */
  const bodyG = ctx.createLinearGradient(0, -110 - breath, 0, 0);
  bodyG.addColorStop(0, skin);
  bodyG.addColorStop(1, skinLo);
  ctx.fillStyle = bodyG;
  ctx.beginPath();
  ctx.moveTo(-96, 0);
  ctx.quadraticCurveTo(-120, -62 - breath, -60, -92 - breath);
  ctx.quadraticCurveTo(20, -122 - breath * 1.4, 108, -74);
  ctx.quadraticCurveTo(140, -46, 120, 0);
  ctx.closePath();
  ctx.fill();

  /* ---------- Sırt dikenleri ----------
     Dikenler gövdenin ÜST EĞRİSİ üzerinde oturmalı. Sabit bir y'ye dizilince
     (ilk sürümde öyleydi) sırttan kopup tepedeki çam ağaçlarına benziyorlardı.
     Bu yüzden gövdeyi çizen quadratic eğriyi burada tekrar örnekliyoruz. */
  const backCurve = (u) => {
    const p0 = { x: -60, y: -92 - breath };
    const p1 = { x: 20, y: -122 - breath * 1.4 };
    const p2 = { x: 108, y: -74 };
    const m = 1 - u;
    return {
      x: m * m * p0.x + 2 * m * u * p1.x + u * u * p2.x,
      y: m * m * p0.y + 2 * m * u * p1.y + u * u * p2.y,
      /* Teğet → dikenler yüzeye dik çıksın */
      tx: 2 * m * (p1.x - p0.x) + 2 * u * (p2.x - p1.x),
      ty: 2 * m * (p1.y - p0.y) + 2 * u * (p2.y - p1.y)
    };
  };

  ctx.fillStyle = skin;
  const SPIKES = 9;
  for (let i = 0; i < SPIKES; i++) {
    const u = 0.06 + (i / (SPIKES - 1)) * 0.88;
    const pt = backCurve(u);
    const len = Math.hypot(pt.tx, pt.ty) || 1;
    /* Yüzey normali (teğetin dikeyi), yukarı bakacak şekilde */
    let nx = pt.ty / len, ny = -pt.tx / len;
    if (ny > 0) { nx = -nx; ny = -ny; }

    const sh = (5 + Math.sin(u * Math.PI) * 13);   // orta sırt en uzun
    const bw = 4.5 + Math.sin(u * Math.PI) * 3.5;  // taban genişliği
    /* Tabanı gövdenin biraz İÇİNE göm — böylece kaynamış görünür */
    const bx = pt.x - nx * 3;
    const by = pt.y - ny * 3;

    ctx.beginPath();
    ctx.moveTo(bx - bw, by);
    ctx.lineTo(bx + nx * sh + bw * 0.15, by + ny * sh);
    ctx.lineTo(bx + bw, by);
    ctx.closePath();
    ctx.fill();
  }

  /* ---------- Kanat ---------- */
  drawWing(ctx, p, t, { rise, membrane, skin, rim, breath });

  /* ---------- Ön bacak / pençe ---------- */
  ctx.fillStyle = skinLo;
  ctx.beginPath();
  ctx.ellipse(-72, -40, 40, 30, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = skinLo;
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(-82, -28);
  ctx.quadraticCurveTo(-104, -10, -118, 0);
  ctx.stroke();
  /* Pençeler */
  ctx.strokeStyle = '#2a2430';
  ctx.lineWidth = 4;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(-118, -2);
    ctx.lineTo(-134 + i * 5, 2 + Math.abs(i) * 2);
    ctx.stroke();
  }

  /* ---------- Boyun + baş ---------- */
  drawNeckAndHead(ctx, p, t, { rise, eye, maw, skin, skinLo, rim, breath });

  ctx.restore();

  /* ---------- Ağız ışıması (dünya uzayında, lighter ile) ---------- */
  if (eye > 0.02 || maw > 0.02) {
    const hp = headPos(rise);
    const hx = x + facing * hp.x * s;
    const hy = y + hp.y * s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = Math.max(eye * 0.55, maw);
    const r = (60 + glow * 190) * s;
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
    g.addColorStop(0, `rgba(255, 120, 50, ${0.42 * glow * alpha})`);
    g.addColorStop(0.35, `rgba(220, 50, 30, ${0.16 * glow * alpha})`);
    g.addColorStop(1, 'rgba(160, 20, 10, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* Başın gövdeye göre konumu — rise ile yükselir */
function headPos(rise) {
  return {
    x: -190 + rise * 34,
    y: -14 - rise * 168
  };
}

function drawNeckAndHead(ctx, p, t, o) {
  const { rise, eye, maw, skin, skinLo, rim, breath } = o;
  const hp = headPos(rise);
  const sway = rise * Math.sin(t * 1.3) * 6;

  /* Boyun — yerdeyken kıvrık, kalkınca S şeklinde */
  ctx.strokeStyle = skin;
  ctx.lineCap = 'round';
  ctx.lineWidth = 30 - rise * 6;
  ctx.beginPath();
  ctx.moveTo(-78, -62 - breath);
  ctx.quadraticCurveTo(
    -140 + rise * 26, -40 - rise * 96,
    hp.x + 24, hp.y + 22 + sway
  );
  ctx.stroke();

  ctx.save();
  ctx.translate(hp.x, hp.y + sway);
  ctx.rotate((rise - 1) * 0.42 + Math.sin(t * 1.1) * 0.02 * rise);

  /* Kafatası */
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(34, 4);
  ctx.quadraticCurveTo(16, -22, -18, -18);
  ctx.quadraticCurveTo(-46, -14, -52, 2);
  ctx.quadraticCurveTo(-30, 12, 34, 4);
  ctx.closePath();
  ctx.fill();

  /* Alt çene — maw ile açılır */
  ctx.save();
  ctx.translate(6, 6);
  ctx.rotate(maw * 0.62);
  ctx.fillStyle = skinLo;
  ctx.beginPath();
  ctx.moveTo(-2, -2);
  ctx.quadraticCurveTo(-30, 6, -54, 2);
  ctx.quadraticCurveTo(-32, 20, 0, 12);
  ctx.closePath();
  ctx.fill();
  /* Alt dişler */
  ctx.fillStyle = '#e8dfc8';
  for (let i = 0; i < 5; i++) {
    const tx = -8 - i * 9;
    ctx.beginPath();
    ctx.moveTo(tx, 2);
    ctx.lineTo(tx - 2.5, -6 - (i % 2) * 3);
    ctx.lineTo(tx + 3, 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  /* Üst dişler */
  ctx.fillStyle = '#e8dfc8';
  for (let i = 0; i < 5; i++) {
    const tx = -8 - i * 9;
    ctx.beginPath();
    ctx.moveTo(tx, 2);
    ctx.lineTo(tx - 2.5, 10 + (i % 2) * 3);
    ctx.lineTo(tx + 3, 2);
    ctx.closePath();
    ctx.fill();
  }

  /* Boynuzlar */
  ctx.strokeStyle = '#3a3140';
  ctx.lineCap = 'round';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(20, -12);
  ctx.quadraticCurveTo(46, -26, 58, -8);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(12, -16);
  ctx.quadraticCurveTo(34, -36, 42, -24);
  ctx.stroke();

  /* Göz */
  if (eye > 0.01) {
    const flick = 0.78 + noise1(t * 7.3) * 0.22;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(-4, -6, 0, -4, -6, 26 * eye);
    g.addColorStop(0, `rgba(255, 190, 90, ${0.95 * eye * flick})`);
    g.addColorStop(0.3, `rgba(255, 90, 30, ${0.5 * eye * flick})`);
    g.addColorStop(1, 'rgba(255, 40, 10, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(-4, -6, 26 * eye, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.fillStyle = `rgba(255, 236, 190, ${eye})`;
    ctx.beginPath();
    ctx.ellipse(-4, -6, 4.6 * eye, 2.6 * eye, -0.2, 0, Math.PI * 2);
    ctx.fill();
    /* Dikey gözbebeği */
    ctx.fillStyle = `rgba(30, 6, 4, ${eye})`;
    ctx.beginPath();
    ctx.ellipse(-4, -6, 1.1 * eye, 2.4 * eye, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Kenar ışığı */
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(34, 4);
  ctx.quadraticCurveTo(16, -22, -18, -18);
  ctx.quadraticCurveTo(-46, -14, -52, 2);
  ctx.stroke();

  ctx.restore();
}

function drawWing(ctx, p, t, o) {
  const { rise, membrane, skin, rim, breath } = o;

  /* Ölüyken kanat gövdenin üstüne serilir; uyanınca yarı açılır */
  const open = rise;
  const flap = open * Math.sin(t * 1.9) * 10;

  ctx.save();
  ctx.translate(6, -84 - breath);
  ctx.rotate(-open * 0.5 - 0.08);

  const tipX = 60 + open * 70;
  const tipY = 40 - open * 210 + flap;

  /* Zar */
  const g = ctx.createLinearGradient(0, 0, tipX, tipY);
  g.addColorStop(0, membrane);
  g.addColorStop(1, 'rgba(10, 6, 12, 0.86)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-40 - open * 30, 18 - open * 90, -78 - open * 44, 44 - open * 130);
  ctx.quadraticCurveTo(-20, 60 - open * 96, tipX, tipY);
  ctx.quadraticCurveTo(40, 44 - open * 40, 0, 0);
  ctx.closePath();
  ctx.fill();

  /* Parmak kemikleri */
  ctx.strokeStyle = skin;
  ctx.lineCap = 'round';
  ctx.lineWidth = 5;
  const fingers = [
    [-78 - open * 44, 44 - open * 130],
    [-30 - open * 26, 56 - open * 122],
    [16 - open * 4, 58 - open * 96],
    [tipX, tipY]
  ];
  for (const f of fingers) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(f[0] * 0.45, f[1] * 0.35, f[0], f[1]);
    ctx.stroke();
  }

  /* Kanat üst kenarında ışık */
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-40 - open * 30, 18 - open * 90, -78 - open * 44, 44 - open * 130);
  ctx.stroke();

  ctx.restore();
}

/* --------------------------------------------------------------------------
   Yardımcılar — leşten yükselen duman, kırık mızrak, kalkan
   -------------------------------------------------------------------------- */

/** Ölü ejderhadan yükselen ince duman şeritleri */
export function drawCarcassSmoke(ctx, p, t, o = {}) {
  const x = o.x ?? 0;
  const y = o.y ?? 0;
  const s = o.scale ?? 1;
  const alpha = o.alpha ?? 1;
  const count = o.count ?? 5;
  if (alpha <= 0.01) return;

  const wisps = seeded('carcassSmoke', o.seed ?? 5, count, (r) => ({
    ox: (r() - 0.5) * 380,
    sp: 12 + r() * 16,
    ph: r() * 6.28,
    w: 14 + r() * 26,
    h: 130 + r() * 150
  }));

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const w of wisps) {
    const life = ((t * w.sp * 0.01) + w.ph) % 1;
    const wy = y - life * w.h * s;
    const wx = x + (w.ox + noise1(t * 0.6 + w.ph) * 26) * s;
    const a = alpha * Math.sin(life * Math.PI) * 0.13;
    if (a <= 0) continue;
    const r0 = (w.w * (0.4 + life * 1.5)) * s;
    const g = ctx.createRadialGradient(wx, wy, 0, wx, wy, r0);
    g.addColorStop(0, `rgba(${p.fog}, ${a})`);
    g.addColorStop(1, `rgba(${p.fog}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(wx, wy, r0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Leşe saplanmış kırık mızrak ve yerdeki kalkan — savaşın izi */
export function drawBattleDebris(ctx, p, o = {}) {
  const x = o.x ?? 0;
  const y = o.y ?? 0;
  const s = o.scale ?? 1;
  const dark = '#131019';
  const rim = `rgba(${p.rim}, 0.5)`;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  /* Saplı mızrak */
  ctx.strokeStyle = dark;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6, 4);
  ctx.lineTo(28, -104);
  ctx.stroke();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(28, -104);
  ctx.lineTo(35, -126);
  ctx.lineTo(21, -118);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-4, 2);
  ctx.lineTo(30, -104);
  ctx.stroke();

  /* Yere düşmüş kalkan */
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(-72, -4, 30, 11, -0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(-72, -5, 30, 11, -0.22, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();

  ctx.restore();
}
