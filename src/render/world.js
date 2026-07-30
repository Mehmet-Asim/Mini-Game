/* ==========================================================================
   Dünya Çizimi — zemin, platformlar, dikenler, toplanabilirler, geçit
   ========================================================================== */

import { hash, clamp } from '../core/utils.js';
import { THEMES } from './background.js';

/* ---------- Zemin ve platformlar ---------- */
export function drawSolids(ctx, level, cam, theme, time) {
  const t = THEMES[theme] || THEMES.forest;
  /* Kırpma penceresi kameranın ZOOM'a göre görünen alanı. Sabit ekran
     genişliğiyle kırpmak co-op uzaklaşmasında kenarlardaki zemini yok
     ediyordu — oyuncular boşlukta yürüyor gibi görünüyordu. */
  const left = cam.screenLeft - 80;
  const right = cam.screenRight + 80;
  const h = cam.viewH;

  for (const s of level.solids) {
    const sx = s.x - cam.offsetX;
    const sy = s.y - cam.offsetY;
    if (sx + s.w < left || sx > right) continue;

    const isGround = s.kind === 'ground';
    drawBlock(ctx, sx, sy, s.w, Math.min(s.h, h + 200), t, isGround, time, s.x);
  }

  for (const s of level.oneWays) {
    const sx = s.x - cam.offsetX;
    const sy = s.y - cam.offsetY;
    if (sx + s.w < left || sx > right) continue;
    drawOneWay(ctx, sx, sy, s.w, t, time);
  }
}

function drawBlock(ctx, x, y, w, h, t, isGround, time, worldX) {
  // Gövde
  const grad = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 180));
  grad.addColorStop(0, isGround ? t.groundTop : t.platformTop);
  grad.addColorStop(0.16, isGround ? t.groundBody : t.platformFace);
  grad.addColorStop(1, isGround ? '#04070a' : '#06080c');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // Doku — taş blokları
  ctx.save();
  ctx.globalAlpha = 0.28;
  const bw = 40, bh = 20;
  const rows = Math.min(9, Math.ceil(h / bh));
  const cols = Math.ceil(w / bw) + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const stag = r % 2 ? bw / 2 : 0;
      const bx = x + c * bw - stag;
      const by = y + r * bh;
      if (bx + bw < x || bx > x + w) continue;
      const sh = hash((worldX + c * bw) * 0.13 + r * 3.7);
      ctx.fillStyle = `rgba(255,255,255,${0.012 + sh * 0.03})`;
      ctx.fillRect(
        Math.max(bx, x) + 1, by + 1,
        Math.min(bw, x + w - Math.max(bx, x)) - 2, bh - 2
      );
    }
  }
  ctx.restore();

  // Üst kenar çizgisi + ışıma
  ctx.save();
  ctx.shadowColor = isGround ? t.groundLine : t.platformEdge;
  ctx.shadowBlur = 12;
  ctx.strokeStyle = isGround ? t.groundLine : t.platformEdge;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(x, y + 1);
  ctx.lineTo(x + w, y + 1);
  ctx.stroke();
  ctx.restore();

  // Üst yüzey vurgusu
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(x, y + 2, w, 3);

  // Kenar aşınma detayı
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = isGround ? t.groundTop : t.platformTop;
  for (let i = 0; i < Math.floor(w / 22); i++) {
    const dx = x + i * 22 + hash(worldX + i) * 12;
    const dh = 3 + hash(worldX * 1.7 + i) * 5;
    ctx.fillRect(dx, y + 5, 10, dh);
  }
  ctx.restore();

  // Sarkan yosun/kök (dekoratif)
  if (!isGround && w > 60) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = t.platformEdge;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const dx = x + 12 + hash(worldX * 2.3 + i) * (w - 24);
      const len = 8 + hash(worldX + i * 3) * 18;
      const sway = Math.sin(time * 1.2 + i + worldX * 0.01) * 3;
      ctx.beginPath();
      ctx.moveTo(dx, y + 18);
      ctx.quadraticCurveTo(dx + sway, y + 18 + len * 0.6, dx + sway * 1.6, y + 18 + len);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawOneWay(ctx, x, y, w, t, time) {
  ctx.save();
  // Ahşap platform
  const grad = ctx.createLinearGradient(0, y, 0, y + 14);
  grad.addColorStop(0, '#6b4a2a');
  grad.addColorStop(1, '#2e1e10');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, 14);

  // Tahta çizgileri
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  for (let i = 1; i < Math.floor(w / 26); i++) {
    ctx.beginPath(); ctx.moveTo(x + i * 26, y); ctx.lineTo(x + i * 26, y + 14); ctx.stroke();
  }

  ctx.shadowColor = t.platformEdge;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = t.platformEdge;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x + w, y + 1); ctx.stroke();
  ctx.restore();

  // "Alttan geçilebilir" ipucu — noktalı alt kenar
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = t.platformEdge;
  ctx.setLineDash([4, 5]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y + 15); ctx.lineTo(x + w, y + 15); ctx.stroke();
  ctx.restore();
}

/* ---------- Hareketli platform ---------- */
/* ==========================================================================
   CO-OP MEKANİZMALARI

   Görsel dil kuralı: bu üç nesne oyunun geri kalanından AYRIŞMALI. Oyuncu
   "burada yoldaşım gerekiyor" mesajını anında almalı, yoksa kapının önünde
   ne yapacağını bilmeden bekliyor. Bu yüzden hepsinde ortak bir işaret var:
   ikili halka sembolü ve turkuaz-altın çift renk.
   ========================================================================== */

/** İki kişilik olduğunu anlatan ikili halka nişanı */
function coopSigil(ctx, x, y, r, alpha, active) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = active ? '#3ddc84' : '#7fd8e8';
  ctx.beginPath(); ctx.arc(x - r * 0.45, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = active ? '#3ddc84' : '#d4a853';
  ctx.beginPath(); ctx.arc(x + r * 0.45, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

export function drawPlate(ctx, pl, cam, time) {
  const x = pl.x - cam.offsetX;
  const y = pl.y - cam.offsetY;
  const press = pl.amount * 5;

  /* Taban yuvası */
  ctx.fillStyle = '#14121c';
  ctx.beginPath();
  ctx.roundRect(x - 4, y + 2, pl.w + 8, pl.h + 6, 3);
  ctx.fill();

  /* Basılan levha */
  const g = ctx.createLinearGradient(0, y + press, 0, y + press + pl.h);
  g.addColorStop(0, pl.active ? '#3ddc84' : '#5c6478');
  g.addColorStop(1, pl.active ? '#1c7a4a' : '#2e3444');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, y + press, pl.w, pl.h, 3);
  ctx.fill();

  /* Aktifken ışıma */
  if (pl.amount > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(x + pl.w / 2, y, 2, x + pl.w / 2, y, 70 * pl.amount);
    gl.addColorStop(0, `rgba(61,220,132,${0.3 * pl.amount})`);
    gl.addColorStop(1, 'rgba(61,220,132,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(x - 70, y - 70, pl.w + 140, 140);
    ctx.restore();
  }

  /* Kilitli plaka (tek yönlü şalter) farklı işaretlenir */
  if (pl.locked) {
    ctx.strokeStyle = '#d4a853';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(x, y + press, pl.w, pl.h, 3);
    ctx.stroke();
  }

  coopSigil(ctx, x + pl.w / 2, y - 14, 4.5, 0.55 + pl.amount * 0.45, pl.active);
}

export function drawGate(ctx, g, cam, time) {
  const b = g.collisionBox;
  const x = b.x - cam.offsetX;
  const yTop = g.baseY - cam.offsetY;
  const h = b.h;
  const y = b.y - cam.offsetY;

  /* Kapının çekildiği kovuk */
  ctx.fillStyle = 'rgba(6,8,14,0.55)';
  ctx.fillRect(x - 3, yTop - 10, g.w + 6, 12);

  if (h > 1) {
    /* Gövde */
    const grad = ctx.createLinearGradient(x, 0, x + g.w, 0);
    grad.addColorStop(0, '#3a3346');
    grad.addColorStop(0.45, '#5a5168');
    grad.addColorStop(1, '#2b2634');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, g.w, h);

    /* Yatay kuşaklar */
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    for (let yy = y + 14; yy < y + h - 4; yy += 22) {
      ctx.beginPath();
      ctx.moveTo(x + 1, yy); ctx.lineTo(x + g.w - 1, yy);
      ctx.stroke();
    }

    /* Kenar ışığı */
    ctx.strokeStyle = g.open > 0.05 ? 'rgba(127,216,232,0.5)' : 'rgba(212,168,83,0.28)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x + 0.5, y + 0.5, g.w - 1, h - 1);
  }

  /* Kapının açılma göstergesi — üstünde ilerleme çubuğu */
  const barW = 34;
  const bx = x + g.w / 2 - barW / 2;
  const by = yTop - 24;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(bx, by, barW, 4);
  ctx.fillStyle = g.open >= 0.99 ? '#3ddc84' : '#7fd8e8';
  ctx.fillRect(bx, by, barW * g.open, 4);

  coopSigil(ctx, x + g.w / 2, by - 12, 4.5, 0.7, g.open > 0.5);
}

export function drawCoopLift(ctx, lift, cam, theme, needed) {
  const t = THEMES[theme] || THEMES.forest;
  const x = lift.x - cam.offsetX;
  const y = lift.y - cam.offsetY;
  const ready = lift.riders >= needed;

  /* Kılavuz rayları — asansörün nereye gideceğini gösterir */
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = ready ? '#3ddc84' : '#6a6a80';
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 2;
  for (const off of [12, lift.w - 12]) {
    ctx.beginPath();
    ctx.moveTo(x + off, y);
    ctx.lineTo(x + off, lift.topY - cam.offsetY);
    ctx.stroke();
  }
  ctx.restore();

  const grad = ctx.createLinearGradient(0, y, 0, y + lift.h);
  grad.addColorStop(0, ready ? '#48d18a' : t.platformTop);
  grad.addColorStop(1, ready ? '#1d6b47' : t.platformFace);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, lift.w, lift.h, 4);
  ctx.fill();

  ctx.strokeStyle = ready ? '#3ddc84' : t.platformEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, lift.w - 1, lift.h - 1, 4);
  ctx.stroke();

  /* Kaç kişi bindi göstergesi — "1/2" */
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = ready ? '#3ddc84' : '#cfd6e6';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${lift.riders}/${needed}`, x + lift.w / 2, y - 8);
  ctx.restore();

  coopSigil(ctx, x + lift.w / 2, y - 24, 4.5, 0.6, ready);
}

export function drawMovingPlatform(ctx, mp, cam, theme, time) {
  const t = THEMES[theme] || THEMES.forest;
  const x = mp.x - cam.offsetX;
  const y = mp.y - cam.offsetY;

  // Zincirler
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#6a6a80';
  ctx.lineWidth = 2;
  for (const cxo of [14, mp.w - 14]) {
    ctx.beginPath();
    ctx.moveTo(x + cxo, y);
    ctx.lineTo(x + cxo, y - 260);
    ctx.stroke();
  }
  ctx.restore();

  const grad = ctx.createLinearGradient(0, y, 0, y + mp.h);
  grad.addColorStop(0, t.platformTop);
  grad.addColorStop(1, t.platformFace);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, mp.w, mp.h, 4);
  ctx.fill();

  ctx.save();
  ctx.shadowColor = t.platformEdge;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = t.platformEdge;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + 2, y + 1); ctx.lineTo(x + mp.w - 2, y + 1); ctx.stroke();
  ctx.restore();

  // Rün işaretleri
  ctx.save();
  ctx.globalAlpha = 0.5 + Math.sin(time * 3) * 0.2;
  ctx.fillStyle = t.platformEdge;
  for (let i = 0; i < 3; i++) {
    const rx = x + mp.w * (0.25 + i * 0.25);
    ctx.beginPath();
    ctx.arc(rx, y + mp.h / 2 + 1, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- Çöken platform ---------- */
export function drawCrumble(ctx, cp, cam, theme, time) {
  if (cp.opacity <= 0) return;
  const t = THEMES[theme] || THEMES.forest;
  const x = cp.x - cam.offsetX + (cp.shakeOff || 0);
  const y = cp.y - cam.offsetY;

  ctx.save();
  ctx.globalAlpha = cp.opacity;
  if (cp.phase === 'fall') ctx.rotate(0);

  const grad = ctx.createLinearGradient(0, y, 0, y + cp.h);
  grad.addColorStop(0, '#54494a');
  grad.addColorStop(1, '#241d1e');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, cp.w, cp.h);

  // Çatlaklar
  ctx.strokeStyle = cp.phase === 'shake' ? 'rgba(255,120,80,0.9)' : 'rgba(0,0,0,0.55)';
  ctx.lineWidth = cp.phase === 'shake' ? 1.8 : 1.2;
  for (let i = 0; i < 4; i++) {
    const cx0 = x + 8 + hash(cp.x + i) * (cp.w - 16);
    ctx.beginPath();
    ctx.moveTo(cx0, y);
    ctx.lineTo(cx0 + (hash(i * 3.1) - 0.5) * 14, y + cp.h);
    ctx.stroke();
  }

  ctx.strokeStyle = cp.phase === 'shake' ? '#ff8a4a' : t.platformEdge;
  ctx.globalAlpha = cp.opacity * (cp.phase === 'shake' ? 0.6 + Math.sin(time * 30) * 0.4 : 0.6);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x + cp.w, y + 1); ctx.stroke();
  ctx.restore();
}

/* ---------- Dikenler ---------- */
export function drawSpikes(ctx, sp, cam, theme) {
  const t = THEMES[theme] || THEMES.forest;
  const x = sp.x - cam.offsetX;
  const y = sp.y - cam.offsetY;
  const spikeW = sp.w / sp.count;

  ctx.save();
  for (let i = 0; i < sp.count; i++) {
    const bx = x + i * spikeW;
    const grad = ctx.createLinearGradient(0, y, 0, y + sp.h);
    grad.addColorStop(0, '#e8e4ee');
    grad.addColorStop(0.5, '#9a94aa');
    grad.addColorStop(1, '#3a3444');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(bx, y + sp.h);
    ctx.lineTo(bx + spikeW / 2, y);
    ctx.lineTo(bx + spikeW, y + sp.h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,80,80,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + spikeW / 2, y + 2);
    ctx.lineTo(bx + spikeW / 2, y + sp.h);
    ctx.stroke();
  }
  // Taban
  ctx.fillStyle = '#2a2430';
  ctx.fillRect(x - 2, y + sp.h - 4, sp.w + 4, 6);
  ctx.restore();
}

/* ---------- Kalp ---------- */
export function drawHeart(ctx, hrt, cam, time) {
  if (hrt.collected) return;
  const x = hrt.cx - cam.offsetX;
  const y = hrt.cy - cam.offsetY + hrt.bob;
  const s = hrt.big ? 1.7 : 1;
  const pulse = 1 + Math.sin(time * 4 + hrt.x * 0.01) * 0.08;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * pulse, s * pulse);

  // Hale
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, 1, 0, 0, hrt.big ? 34 : 22);
  g.addColorStop(0, hrt.big ? 'rgba(255, 210, 120, 0.45)' : 'rgba(255, 100, 130, 0.34)');
  g.addColorStop(1, 'rgba(255, 60, 100, 0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, hrt.big ? 34 : 22, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.rotate(Math.sin(time * 2 + hrt.x * 0.02) * 0.12);

  const hg = ctx.createLinearGradient(0, -10, 0, 10);
  if (hrt.big) {
    hg.addColorStop(0, '#ffe89a');
    hg.addColorStop(0.5, '#ffb84a');
    hg.addColorStop(1, '#e8622a');
  } else {
    hg.addColorStop(0, '#ff8fa8');
    hg.addColorStop(0.5, '#ff4d6d');
    hg.addColorStop(1, '#c41e3a');
  }
  ctx.fillStyle = hg;
  ctx.shadowColor = hrt.big ? '#ffb84a' : '#ff4d6d';
  ctx.shadowBlur = 12;

  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.bezierCurveTo(-13, -2, -7.5, -12, 0, -5.5);
  ctx.bezierCurveTo(7.5, -12, 13, -2, 0, 8);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Parlama
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(-4, -3.5, 2.6, 1.6, -0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Hikaye kalbi işareti
  if (hrt.big) {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(time * 5) * 0.3;
    ctx.strokeStyle = '#ffd76b';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -time * 20;
    ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

/* ---------- Can küresi ---------- */
export function drawLifeOrb(ctx, orb, cam, time) {
  if (orb.collected) return;
  const x = orb.cx - cam.offsetX;
  const y = orb.cy - cam.offsetY + orb.bob;

  ctx.save();
  ctx.translate(x, y);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 32);
  g.addColorStop(0, 'rgba(80, 255, 170, 0.4)');
  g.addColorStop(1, 'rgba(40, 220, 140, 0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.rotate(time * 0.8);
  const og = ctx.createRadialGradient(-3, -3, 1, 0, 0, 12);
  og.addColorStop(0, '#c8ffe4');
  og.addColorStop(0.6, '#3ddc84');
  og.addColorStop(1, '#12703f');
  ctx.fillStyle = og;
  ctx.shadowColor = '#3ddc84'; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  // Yörünge halkası
  ctx.strokeStyle = 'rgba(200,255,225,0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(0, 0, 17, 6, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // İçindeki kalp simgesi
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.bezierCurveTo(-6, -1, -3.5, -6, 0, -2.6);
  ctx.bezierCurveTo(3.5, -6, 6, -1, 0, 4);
  ctx.fill();
  ctx.restore();
}

/* ---------- Checkpoint meşalesi ---------- */
export function drawCheckpoint(ctx, cp, cam, time) {
  const x = cp.cx - cam.offsetX;
  const yTop = cp.y - cam.offsetY;
  const yBot = cp.y + cp.h - cam.offsetY;

  ctx.save();
  // Direk
  const pg = ctx.createLinearGradient(x - 4, 0, x + 4, 0);
  pg.addColorStop(0, '#3a3040');
  pg.addColorStop(0.5, '#6a5a50');
  pg.addColorStop(1, '#2a2028');
  ctx.fillStyle = pg;
  ctx.fillRect(x - 3.5, yTop + 14, 7, cp.h - 14);

  // Sepet
  ctx.fillStyle = '#4a4048';
  ctx.beginPath();
  ctx.moveTo(x - 11, yTop + 20);
  ctx.lineTo(x + 11, yTop + 20);
  ctx.lineTo(x + 7, yTop + 4);
  ctx.lineTo(x - 7, yTop + 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8a7a60'; ctx.lineWidth = 1.2; ctx.stroke();

  if (cp.activated) {
    const flick = 0.75 + Math.sin(time * 11 + cp.x) * 0.25;
    const fh = 26 * flick;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, yTop, 2, x, yTop, 90 * flick);
    g.addColorStop(0, 'rgba(255, 200, 110, 0.35)');
    g.addColorStop(0.4, 'rgba(255, 150, 60, 0.14)');
    g.addColorStop(1, 'rgba(255, 120, 40, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, yTop, 90 * flick, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Alev
    const fg = ctx.createLinearGradient(0, yTop - fh, 0, yTop + 8);
    fg.addColorStop(0, 'rgba(255,240,170,0.95)');
    fg.addColorStop(0.45, 'rgba(255,170,60,0.9)');
    fg.addColorStop(1, 'rgba(220,70,20,0.5)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(x - 8, yTop + 6);
    ctx.quadraticCurveTo(x - 9, yTop - fh * 0.4, x + Math.sin(time * 7) * 3, yTop - fh);
    ctx.quadraticCurveTo(x + 9, yTop - fh * 0.4, x + 8, yTop + 6);
    ctx.closePath();
    ctx.fill();

    // Bayrak
    ctx.fillStyle = '#d4a853';
    const sway = Math.sin(time * 2.4) * 3;
    ctx.beginPath();
    ctx.moveTo(x + 3, yTop + 24);
    ctx.lineTo(x + 26 + sway, yTop + 30);
    ctx.lineTo(x + 3, yTop + 38);
    ctx.closePath();
    ctx.fill();
  } else {
    // Sönük
    ctx.fillStyle = 'rgba(80,70,80,0.6)';
    ctx.beginPath(); ctx.arc(x, yTop + 8, 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/* ---------- Geçit (portal) ---------- */
export function drawPortal(ctx, portal, cam, time, particles) {
  const x = portal.cx - cam.offsetX;
  const yBase = portal.y + portal.h - cam.offsetY;
  const open = portal.openAmount;

  ctx.save();

  // Taş kemer
  ctx.strokeStyle = '#4a4258';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 30, yBase);
  ctx.lineTo(x - 30, yBase - 48);
  ctx.arc(x, yBase - 48, 30, Math.PI, 0);
  ctx.lineTo(x + 30, yBase);
  ctx.stroke();

  ctx.strokeStyle = '#d4a853';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 30, yBase);
  ctx.lineTo(x - 30, yBase - 48);
  ctx.arc(x, yBase - 48, 30, Math.PI, 0);
  ctx.lineTo(x + 30, yBase);
  ctx.stroke();

  if (open > 0.02) {
    // Girdap
    ctx.save();
    ctx.globalAlpha = open;
    ctx.beginPath();
    ctx.moveTo(x - 26, yBase);
    ctx.lineTo(x - 26, yBase - 48);
    ctx.arc(x, yBase - 48, 26, Math.PI, 0);
    ctx.lineTo(x + 26, yBase);
    ctx.closePath();
    ctx.clip();

    const vg = ctx.createRadialGradient(x, yBase - 40, 2, x, yBase - 40, 60);
    vg.addColorStop(0, 'rgba(230, 210, 255, 0.95)');
    vg.addColorStop(0.35, 'rgba(150, 90, 255, 0.7)');
    vg.addColorStop(1, 'rgba(60, 20, 120, 0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(x - 30, yBase - 84, 60, 90);

    // Dönen spiraller
    ctx.strokeStyle = 'rgba(230,210,255,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      for (let a = 0; a < 6.28 * 2.2; a += 0.15) {
        const r = a * 4.5;
        const ang = a + time * 2.2 + i * 2.1;
        const px = x + Math.cos(ang) * r;
        const py = yBase - 40 + Math.sin(ang) * r * 0.75;
        a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Dış ışıma
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = open;
    const og = ctx.createRadialGradient(x, yBase - 44, 5, x, yBase - 44, 110);
    og.addColorStop(0, 'rgba(150, 100, 255, 0.28)');
    og.addColorStop(1, 'rgba(120, 60, 255, 0)');
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(x, yBase - 44, 110, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (particles && Math.random() < 0.5) {
      particles.portalSwirl(portal.cx, portal.y + portal.h - 44, 40);
    }

    // Yazı
    ctx.globalAlpha = open * (0.7 + Math.sin(time * 3) * 0.3);
    ctx.font = '700 12px Cinzel, serif';
    ctx.fillStyle = '#e8d4ff';
    ctx.textAlign = 'center';
    ctx.fillText('GEÇİT', x, yBase - 96);
  } else {
    // Kapalı — mühür
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#2a2438';
    ctx.beginPath();
    ctx.moveTo(x - 26, yBase);
    ctx.lineTo(x - 26, yBase - 48);
    ctx.arc(x, yBase - 48, 26, Math.PI, 0);
    ctx.lineTo(x + 26, yBase);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.5 + Math.sin(time * 2) * 0.2;
    ctx.strokeStyle = '#c41e3a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 18, yBase - 56); ctx.lineTo(x + 18, yBase - 32);
    ctx.moveTo(x + 18, yBase - 56); ctx.lineTo(x - 18, yBase - 32);
    ctx.stroke();
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ---------- Mermi ---------- */
export function drawProjectile(ctx, pr, cam, time) {
  const x = pr.cx - cam.offsetX;
  const y = pr.cy - cam.offsetY;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 1, x, y, pr.size * 3.2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, pr.color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, pr.size * 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = pr.color;
  ctx.shadowColor = pr.color;
  ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.arc(x, y, pr.size * 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x, y, pr.size * 0.38, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Sektirilmişse halka
  if (pr.deflected) {
    ctx.save();
    ctx.strokeStyle = '#ffd76b';
    ctx.globalAlpha = 0.6 + Math.sin(time * 14) * 0.3;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, pr.size * 1.7, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

/* ---------- Ejderha Kalkanı (yerde duran eşya) ---------- */
export function drawShieldPickup(ctx, sp, cam, time) {
  const x = sp.cx - cam.offsetX;
  const y = sp.cy - cam.offsetY + sp.bob;
  const gy = sp.groundY - cam.offsetY;

  // Yerdeki ışık havuzu
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pool = ctx.createRadialGradient(x, gy, 2, x, gy, 62);
  pool.addColorStop(0, 'rgba(140,200,255,0.42)');
  pool.addColorStop(1, 'rgba(140,200,255,0)');
  ctx.fillStyle = pool;
  ctx.beginPath(); ctx.ellipse(x, gy, 62, 18, 0, 0, Math.PI * 2); ctx.fill();

  // Hale
  const pulse = 0.6 + Math.sin(time * 2.4) * 0.4;
  const halo = ctx.createRadialGradient(x, y, 4, x, y, 52);
  halo.addColorStop(0, `rgba(190,225,255,${0.3 * pulse})`);
  halo.addColorStop(1, 'rgba(190,225,255,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(x, y, 52, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Yükselen kıvılcımlar
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const t = (time * 0.5 + i * 0.2) % 1;
    const sxp = x + Math.sin(time * 1.4 + i * 2.1) * 18;
    const syp = gy - t * 70;
    ctx.globalAlpha = (1 - t) * 0.7;
    ctx.fillStyle = '#bfe0ff';
    ctx.beginPath(); ctx.arc(sxp, syp, 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Kalkanın kendisi
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sp.spin);
  drawShieldShape(ctx, 1.35, time);
  ctx.restore();
}

/**
 * Kalkan şekli — hem yerdeki eşya hem şövalyenin elindeki için ortak.
 * (0,0) kalkanın merkezi.
 */
export function drawShieldShape(ctx, scale = 1, time = 0) {
  ctx.save();
  ctx.scale(scale, scale);

  const W = 13, TOP = -17, BOT = 19;

  // Gövde
  const g = ctx.createLinearGradient(-W, TOP, W, BOT);
  g.addColorStop(0, '#5b86c4');
  g.addColorStop(0.45, '#2f4f86');
  g.addColorStop(1, '#16233f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-W, TOP + 3);
  ctx.quadraticCurveTo(0, TOP - 3, W, TOP + 3);
  ctx.lineTo(W, 4);
  ctx.quadraticCurveTo(W - 1, 14, 0, BOT);
  ctx.quadraticCurveTo(-W + 1, 14, -W, 4);
  ctx.closePath();
  ctx.fill();

  // Altın kenar
  ctx.strokeStyle = '#d4a853';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Ejderha pençesi arması
  ctx.fillStyle = '#d4a853';
  ctx.beginPath();
  ctx.moveTo(0, TOP + 7);
  ctx.lineTo(5, TOP + 13);
  ctx.lineTo(2.4, TOP + 13);
  ctx.lineTo(4, BOT - 9);
  ctx.lineTo(0, BOT - 5);
  ctx.lineTo(-4, BOT - 9);
  ctx.lineTo(-2.4, TOP + 13);
  ctx.lineTo(-5, TOP + 13);
  ctx.closePath();
  ctx.fill();

  // Parlama bandı
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35 + Math.sin(time * 3) * 0.2;
  ctx.fillStyle = 'rgba(200,230,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(-W + 2, TOP + 5); ctx.lineTo(-3, TOP + 5);
  ctx.lineTo(-7, BOT - 7); ctx.lineTo(-W + 2, 2);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.restore();
}

/* ---------- Ok ---------- */
export function drawArrow(ctx, ar, cam) {
  const x = ar.cx - cam.offsetX;
  const y = ar.cy - cam.offsetY;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ar.angle);

  // Saplanınca hafifçe sönümlenerek kaybol
  if (ar.stuck) {
    ctx.globalAlpha = Math.max(0, 1 - ar.stuckTimer / 0.9);
  } else {
    // Uçuş izi
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const tg = ctx.createLinearGradient(-30, 0, 2, 0);
    tg.addColorStop(0, 'rgba(255,200,110,0)');
    tg.addColorStop(1, 'rgba(255,225,160,0.5)');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.moveTo(-30, -1.6); ctx.lineTo(2, -2.4); ctx.lineTo(2, 2.4); ctx.lineTo(-30, 1.6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Gövde (ahşap)
  ctx.strokeStyle = '#7a5230';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(6, 0); ctx.stroke();

  // Uç (çelik)
  ctx.fillStyle = '#e2e6f2';
  ctx.shadowColor = '#ffe2a0';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(11, 0); ctx.lineTo(5, -3.4); ctx.lineTo(5, 3.4);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;

  // Tüyler
  ctx.fillStyle = '#c41e3a';
  ctx.beginPath();
  ctx.moveTo(-9, 0); ctx.lineTo(-4, -3.6); ctx.lineTo(-6, 0); ctx.lineTo(-4, 3.6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8c88a';
  ctx.beginPath();
  ctx.moveTo(-11, 0); ctx.lineTo(-7, -2.6); ctx.lineTo(-8.5, 0); ctx.lineTo(-7, 2.6);
  ctx.closePath(); ctx.fill();

  ctx.restore();
}

/* ---------- İpucu levhası ---------- */
export function drawTip(ctx, tip, cam, alpha) {
  if (alpha <= 0.01) return;
  const x = tip.x - cam.offsetX;
  const y = tip.y - cam.offsetY;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '600 13px Outfit, sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(tip.text).width + 28;

  ctx.fillStyle = 'rgba(8, 10, 22, 0.82)';
  ctx.strokeStyle = 'rgba(212,168,83,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 16, w, 30, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#e8d4a8';
  ctx.fillText(tip.text, x, y + 4);
  ctx.restore();
  ctx.globalAlpha = 1;
}
