/* ==========================================================================
   Karakter Çizimleri — vektörel, iskelet benzeri animasyon
   Şövalye, Kurt, Yarasa, Büyücü, Ejderha
   ========================================================================== */

import { clamp, lerp } from '../core/utils.js';
import { drawShieldShape } from './world.js';
import { WOLF_RECOVER } from '../game/entities.js';
import { PHYS } from '../game/player.js';

/* ==========================================================================
   ŞÖVALYE
   ========================================================================== */
export function drawKnight(ctx, p, cam, time) {
  const sx = p.x - cam.offsetX + p.w / 2;
  const sy = p.y - cam.offsetY + p.h;

  // Dokunulmazlık yanıp sönmesi
  if (p.invuln > 0 && !p.dead) {
    const blink = Math.sin(p.invuln * 42) > -0.2;
    if (!blink) return;
    ctx.globalAlpha = 0.75;
  }

  /* Co-op: her oyuncunun kendi pelerin rengi — kimin kim olduğu ancak
     böyle anlaşılıyor. Palet yoksa (tek oyuncu) eski kırmızıya düşer. */
  const capeColor = p.palette?.cape || '#8e1730';

  ctx.save();
  ctx.translate(sx, sy);

  if (p.dead) {
    ctx.rotate(clamp(p.deathTimer * 3.4, 0, Math.PI * 0.55));
  } else if (p.downed) {
    /* Yere serilmiş: yana devrilmiş poz */
    ctx.rotate(Math.PI * 0.42 * p.facing);
    ctx.globalAlpha *= 0.85;
  }

  ctx.scale(p.facing * p.squashX, p.squashY);

  const run = p.runCycle;
  const isRun = p.state === 'run';
  const isAir = p.state === 'jump' || p.state === 'fall';
  const isBlock = p.state === 'block' || (p.blockAmount || 0) > 0.55;
  const isHurt = p.state === 'hurt';
  const skid = p.skid || 0;
  const bow = p.bowDraw || 0;        // 0..1 yay gerilmesi
  const shooting = bow > 0.001;
  const atkProg = p.attackProgress; // -1 yokken, 0..1 saldırıda
  const comboUp = (p.comboStep || 0) === 1;
  const legSwing = isRun ? Math.sin(run) * (12 + skid * 4) : (skid > 0.2 ? Math.sin(time * 18) * 3 : 0);
  const armSwing = isRun ? -Math.sin(run) * 9 : 0;
  const bodyBob = isRun ? Math.abs(Math.sin(run)) * 2.8
    : isBlock ? Math.sin(time * 3.2) * 0.6
    : Math.sin(time * 2.2) * 1.2;
  const bodyLean = isHurt ? -8
    : isBlock ? -6
    : skid > 0.25 ? -10 * skid
    : isRun ? 5 + Math.sin(run) * 1.5
    : (isAir ? (p.vy < 0 ? 7 : -4) : Math.sin(time * 1.4) * 1.2);

  /* ---- Zemin gölgesi ---- */
  ctx.save();
  ctx.scale(1 / (p.facing * p.squashX), 1 / p.squashY);
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, 2, 16, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  /* ---- Pelerin (arkada, sallanır) ---- */
  ctx.save();
  const capeFlow = isAir ? clamp(-p.vy * 0.035, -8, 16) : (isRun ? 8 + Math.sin(run) * 4 : Math.sin(time * 1.6) * 2.5);
  ctx.fillStyle = capeColor;
  ctx.beginPath();
  ctx.moveTo(-3, -36 + bodyBob);
  ctx.quadraticCurveTo(-14 - capeFlow, -26, -12 - capeFlow * 1.4, -6);
  ctx.quadraticCurveTo(-6 - capeFlow * 0.5, -3, -1, -12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.moveTo(-3, -36 + bodyBob);
  ctx.quadraticCurveTo(-10 - capeFlow * 0.6, -24, -8 - capeFlow, -10);
  ctx.quadraticCurveTo(-5, -8, -2, -16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  /* ---- Sırttaki yay + sadak (atış yapmıyorken) ---- */
  if (!shooting) {
    ctx.save();
    ctx.translate(-6, -26 + bodyBob);
    ctx.rotate(-0.45);
    // Yay gövdesi
    ctx.strokeStyle = '#7a5230';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, 15, -1.15, 1.15);
    ctx.stroke();
    // Kiriş
    ctx.strokeStyle = 'rgba(230,225,210,0.55)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(Math.cos(-1.15) * 15, Math.sin(-1.15) * 15);
    ctx.lineTo(Math.cos(1.15) * 15, Math.sin(1.15) * 15);
    ctx.stroke();
    // Uç altınları
    ctx.fillStyle = '#d4a853';
    ctx.beginPath(); ctx.arc(Math.cos(-1.15) * 15, Math.sin(-1.15) * 15, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(Math.cos(1.15) * 15, Math.sin(1.15) * 15, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Sadak (ok kılıfı)
    ctx.save();
    ctx.translate(-9, -30 + bodyBob);
    ctx.rotate(0.35);
    ctx.fillStyle = '#54331d';
    ctx.fillRect(-2.5, -2, 5, 13);
    ctx.fillStyle = '#3a2413';
    ctx.fillRect(-2.5, -2, 5, 2.5);
    // Çıkan ok tüyleri
    ctx.fillStyle = '#c41e3a';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 1.6, -2);
      ctx.lineTo(i * 1.6 - 1.2, -7);
      ctx.lineTo(i * 1.6 + 1.2, -7);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  /* ---- Bacaklar ---- */
  ctx.strokeStyle = '#4a4258';
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';

  const legY = -10 + bodyBob;
  if (isAir) {
    // Havada: bacaklar toplanır; yükselişte daha sıkı, düşüşte açılır
    const tuck = p.vy < 0 ? 1 : 0.55;
    ctx.beginPath(); ctx.moveTo(-3, legY); ctx.lineTo(-7 - tuck, legY + 7); ctx.lineTo(-3 - tuck * 2, legY + 11 + tuck * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, legY); ctx.lineTo(9 + tuck, legY + 5); ctx.lineTo(11 + tuck, legY + 10 + tuck); ctx.stroke();
  } else if (isBlock) {
    // Siper: bacaklar geniş açık, ağır duruş
    ctx.beginPath(); ctx.moveTo(-4, legY); ctx.lineTo(-9, legY + 11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, legY); ctx.lineTo(10, legY + 11); ctx.stroke();
    ctx.strokeStyle = '#2a2434'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-9, legY + 10); ctx.lineTo(-6, legY + 11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, legY + 10); ctx.lineTo(13, legY + 11); ctx.stroke();
  } else {
    // Diz eklemi: kalça → diz → ayak — koşuda okunabilir adım
    const kneeBend = isRun ? 3.5 + Math.abs(Math.sin(run)) * 2.5 : 1.5;
    const drawLeg = (hipX, swing, side) => {
      const kneeX = hipX + swing * 0.55;
      const kneeY = legY + 5 + (side > 0 ? kneeBend * 0.35 : kneeBend * 0.15);
      const footX = hipX + swing + (skid > 0.3 ? -side * skid * 4 : 0);
      const footY = legY + 10;
      ctx.beginPath();
      ctx.moveTo(hipX, legY);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(footX, footY);
      ctx.stroke();
      ctx.strokeStyle = '#2a2434';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(footX, footY - 1);
      ctx.lineTo(footX + side * 2.4, footY);
      ctx.stroke();
      ctx.strokeStyle = '#4a4258';
      ctx.lineWidth = 4.5;
    };
    drawLeg(-3, -legSwing, -1);
    drawLeg(4, legSwing, 1);
  }

  /* ---- Gövde (zırh) ---- */
  ctx.save();
  ctx.translate(0, bodyBob);
  ctx.rotate((bodyLean * Math.PI) / 180);

  const armor = ctx.createLinearGradient(-9, -36, 10, -10);
  armor.addColorStop(0, '#4e4a68');
  armor.addColorStop(0.5, '#38344c');
  armor.addColorStop(1, '#23202f');
  ctx.fillStyle = armor;
  ctx.beginPath();
  ctx.moveTo(-8, -34);
  ctx.lineTo(8, -34);
  ctx.quadraticCurveTo(10, -22, 7, -10);
  ctx.lineTo(-7, -10);
  ctx.quadraticCurveTo(-10, -22, -8, -34);
  ctx.closePath();
  ctx.fill();

  // Göğüs plakası parlaması
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.moveTo(-6, -32); ctx.lineTo(-1, -32); ctx.lineTo(-3, -14); ctx.lineTo(-6, -14);
  ctx.closePath(); ctx.fill();

  // Altın kemer + arma
  ctx.fillStyle = '#d4a853';
  ctx.fillRect(-8, -16, 16, 3);
  ctx.beginPath();
  ctx.moveTo(0, -30); ctx.lineTo(4, -26); ctx.lineTo(0, -19); ctx.lineTo(-4, -26);
  ctx.closePath(); ctx.fill();

  // Omuz zırhı
  ctx.fillStyle = '#5a5474';
  ctx.beginPath(); ctx.ellipse(-8, -31, 4.5, 5.5, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(8, -31, 4.5, 5.5, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d4a853'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(-8, -31, 4.5, 5.5, -0.3, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(8, -31, 4.5, 5.5, 0.3, 0, Math.PI * 2); ctx.stroke();

  /* ---- Gerilmiş yay (atış sırasında, öne uzanır) ---- */
  if (shooting) {
    ctx.save();
    ctx.translate(11, -22);

    // Ön kol — yayı tutan
    ctx.strokeStyle = '#4e4a68';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(1, -1); ctx.stroke();

    const tipA = -1.25, tipB = 1.25, R = 17;
    const ax = Math.cos(tipA) * R, ay = Math.sin(tipA) * R;
    const bx = Math.cos(tipB) * R, by = Math.sin(tipB) * R;
    // Kiriş çekilme derinliği
    const pull = -6 - bow * 11;

    // Yay gövdesi (gerilince hafifçe bükülür)
    ctx.strokeStyle = '#8a5c34';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, R, tipA, tipB);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(212,168,83,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, R - 1.6, tipA, tipB);
    ctx.stroke();

    // Kiriş — geri çekilmiş V
    ctx.strokeStyle = 'rgba(240,236,225,0.9)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(pull, 0);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // Nişanlanmış ok (henüz fırlamadıysa)
    if (!p.arrowFired) {
      ctx.strokeStyle = '#7a5230';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pull, 0); ctx.lineTo(pull + 22, 0); ctx.stroke();
      ctx.fillStyle = '#e2e6f2';
      ctx.beginPath();
      ctx.moveTo(pull + 27, 0); ctx.lineTo(pull + 21, -3); ctx.lineTo(pull + 21, 3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c41e3a';
      ctx.beginPath();
      ctx.moveTo(pull, 0); ctx.lineTo(pull + 5, -3); ctx.lineTo(pull + 3, 0); ctx.lineTo(pull + 5, 3);
      ctx.closePath(); ctx.fill();
    }

    // Çekiş kolu (kirişi çeken el)
    ctx.strokeStyle = '#4e4a68';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-9, -2); ctx.lineTo(pull, 0); ctx.stroke();

    // Bırakma anı parlaması
    if (p.arrowFired) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, bow * 2.6);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,225,160,0.8)';
      ctx.beginPath(); ctx.arc(6, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---- Kalkan (sol kol) ----
     block = 0 → normal küçük kalkan yanda
     block = 1 → Ejderha Kalkanı öne kalkmış, siper alınmış         */
  if (!shooting) {
    const block = p.blockAmount || 0;

    if (block > 0.02 && p.hasShield) {
      // Ejderha Kalkanı — öne doğru kayar ve büyür
      ctx.save();
      ctx.translate(-9 + block * 22, -24 - block * 2);
      ctx.rotate((1 - block) * -0.5);
      const sc = 0.72 + block * 0.5;

      // Engelleme anında mavi enerji kalkanı
      if (p.blockFlash > 0) {
        const f = p.blockFlash / 0.22;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = f * 0.85;
        const eg = ctx.createRadialGradient(4, 0, 2, 4, 0, 30);
        eg.addColorStop(0, 'rgba(210,240,255,0.9)');
        eg.addColorStop(0.5, 'rgba(120,190,255,0.5)');
        eg.addColorStop(1, 'rgba(120,190,255,0)');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(4, 0, 30, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(200,235,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(4, 0, 22 + (1 - f) * 10, -1.1, 1.1); ctx.stroke();
        ctx.restore();
      }

      // Siperdeyken sürekli hafif enerji parıltısı
      if (block > 0.6) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (block - 0.6) * 0.9;
        ctx.strokeStyle = 'rgba(150,210,255,0.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(3, 0, 21 + Math.sin(time * 6) * 1.5, -1.25, 1.25);
        ctx.stroke();
        ctx.restore();
      }

      drawShieldShape(ctx, sc, time);
      ctx.restore();
    } else {
      // Normal küçük kalkan
      ctx.save();
      ctx.translate(-9, -24 + armSwing * 0.3);
      ctx.rotate(isAir ? -0.25 : armSwing * 0.02);
      const shg = ctx.createLinearGradient(-6, -9, 4, 9);
      shg.addColorStop(0, '#3a4a6a');
      shg.addColorStop(1, '#1e2740');
      ctx.fillStyle = shg;
      ctx.beginPath();
      ctx.moveTo(-5, -9); ctx.lineTo(4, -9);
      ctx.quadraticCurveTo(5, 3, -0.5, 10);
      ctx.quadraticCurveTo(-6, 3, -5, -9);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#d4a853'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    }
  }

  /* ---- Kılıç (sağ kol) ----
     Combo 0: yukarıdan aşağı (anticipate → slash)
     Combo 1: aşağıdan yukarı riposte — açı ve iz ters yönde */
  const atk = atkProg;
  ctx.save();
  ctx.translate(8, -24);
  if (atk >= 0) {
    const ease = Math.min(1, atk < 0.22 ? atk / 0.22 * 0.35 : 0.35 + (atk - 0.22) / 0.78 * 0.65);
    const ang = comboUp
      ? lerp(1.15, -1.85, ease)   // yukarı savurma
      : lerp(-1.95, 1.35, ease);  // aşağı savurma
    ctx.rotate(ang);
  } else if (shooting) {
    ctx.rotate(-2.6);
  } else if (isBlock) {
    ctx.rotate(-0.35);            // siperde kılıç gövdeye yakın
  } else {
    ctx.rotate(isAir ? -0.5 : -1.35 + armSwing * 0.02);
  }
  // Kabza
  ctx.strokeStyle = '#6b4a28'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, -2); ctx.stroke();
  // Balçak
  ctx.strokeStyle = '#d4a853'; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(5, -2); ctx.stroke();
  // Namlu — ikinci vuruşta biraz daha uzun
  const bladeLen = comboUp && atk >= 0 ? -36 : -32;
  const blade = ctx.createLinearGradient(0, -3, 0, bladeLen);
  blade.addColorStop(0, '#c8ccdc');
  blade.addColorStop(0.5, '#f2f4ff');
  blade.addColorStop(1, '#9aa0b8');
  ctx.fillStyle = blade;
  ctx.beginPath();
  ctx.moveTo(-2.2, -3); ctx.lineTo(2.2, -3);
  ctx.lineTo(1.6, bladeLen + 5); ctx.lineTo(0, bladeLen); ctx.lineTo(-1.6, bladeLen + 5);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  /* ---- Kafa / miğfer ---- */
  ctx.save();
  ctx.translate(1, -41);
  ctx.rotate(isRun ? Math.sin(run) * 0.05 : 0);
  const helm = ctx.createLinearGradient(-8, -8, 8, 8);
  helm.addColorStop(0, '#57526f');
  helm.addColorStop(1, '#2c2a3c');
  ctx.fillStyle = helm;
  ctx.beginPath();
  ctx.moveTo(-7.5, 2);
  ctx.quadraticCurveTo(-8.5, -9, 0, -10);
  ctx.quadraticCurveTo(8.5, -9, 7.5, 2);
  ctx.quadraticCurveTo(4, 6, 0, 6);
  ctx.quadraticCurveTo(-4, 6, -7.5, 2);
  ctx.closePath(); ctx.fill();

  // Vizör yarığı (parlayan gözler)
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(-6, -3, 12, 4);
  ctx.save();
  ctx.shadowColor = '#ffd76b'; ctx.shadowBlur = 9;
  ctx.fillStyle = '#ffd76b';
  ctx.fillRect(-4.5, -2.2, 3.4, 2.2);
  ctx.fillRect(1.2, -2.2, 3.4, 2.2);
  ctx.restore();

  // Miğfer altın hattı
  ctx.strokeStyle = '#d4a853'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, -4); ctx.stroke();

  // Tüy sorgucu
  ctx.fillStyle = '#c41e3a';
  const plume = Math.sin(time * 4 + (isRun ? run : 0)) * 2.5;
  ctx.beginPath();
  ctx.moveTo(-1, -10);
  ctx.quadraticCurveTo(-3 - plume, -20, -9 - plume * 1.6, -22);
  ctx.quadraticCurveTo(-4, -16, 1, -9);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.restore(); // gövde transform
  ctx.restore(); // ana transform
  ctx.globalAlpha = 1;

  /* ---- Kılıç savurma izi ---- */
  if (atkProg >= 0) {
    const t = atkProg;
    const hitOn = t >= PHYS.ATTACK_WINDUP;
    ctx.save();
    ctx.translate(sx, sy - 20 + (comboUp ? -6 : 0));
    ctx.scale(p.facing, 1);
    ctx.globalAlpha = (1 - t) * (hitOn ? 0.9 : 0.35);
    ctx.strokeStyle = comboUp ? '#ffe6a8' : '#ffffff';
    ctx.shadowColor = comboUp ? '#ffd76b' : '#cfe4ff';
    ctx.shadowBlur = 16;
    ctx.lineWidth = hitOn ? 4.5 : 2.5;
    ctx.lineCap = 'round';
    const a0 = comboUp ? (1.0 - t * 2.4) : (-1.5 + t * 0.6);
    const span = comboUp ? -1.55 : 1.5;
    ctx.beginPath();
    ctx.arc(6, -4, comboUp ? 38 : 34, a0, a0 + span);
    ctx.stroke();
    if (hitOn) {
      ctx.globalAlpha = (1 - t) * 0.42;
      ctx.lineWidth = 11;
      ctx.strokeStyle = comboUp ? 'rgba(255,210,120,0.55)' : 'rgba(190,220,255,0.6)';
      ctx.beginPath();
      ctx.arc(6, -4, comboUp ? 38 : 34, a0 + span * 0.1, a0 + span * 0.85);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

/* ==========================================================================
   GÖLGE KURDU (walker)
   ========================================================================== */
export function drawWalker(ctx, e, cam, time) {
  const sx = e.x - cam.offsetX + e.w / 2;
  const sy = e.y - cam.offsetY + e.h;

  ctx.save();
  ctx.translate(sx, sy);

  if (e.dying) {
    const t = e.deathTimer / 0.35;
    ctx.globalAlpha = 1 - t;
    ctx.scale(1 + t * 0.5, 1 - t * 0.6);
    ctx.translate(0, t * 10);
  }

  ctx.scale(e.dir, 1);

  /* ---- Atak evreleri ----
     Çökme (windup) yayı gerer, sıçrama (leap) uzatır, toparlanma (recover)
     bacakları açar. Oyuncunun "şimdi ne olacak"ı gövdenin siluetinden
     okuyabilmesi lazım; renk değişimi tek başına yetmiyor. */
  const wind = e.windup > 0 ? Math.min(1, e.windup) : 0;
  const leap = e.leap > 0 ? Math.min(1, e.leap) : 0;
  const rec = e.recover > 0 ? Math.min(1, e.recover / WOLF_RECOVER) : 0;

  // Gölge — havada küçülüp soluyor
  ctx.save();
  ctx.scale(e.dir, 1);
  const hop = e.hop || 0;
  ctx.globalAlpha *= 0.3 * (1 - hop / 44);
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, 1 + hop, 19 - hop * 0.22, 4 - hop * 0.045, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  /* Çökerken bas, sıçrarken uzat */
  if (wind > 0 || leap > 0) {
    const sx2 = 1 + wind * 0.16 - Math.sin(leap * Math.PI) * 0.14;
    const sy2 = 1 - wind * 0.24 + Math.sin(leap * Math.PI) * 0.18;
    ctx.scale(sx2, sy2);
  }

  const gaitSpeed = rec > 0 ? 0 : 12;
  const gait = Math.sin(e.animTime * gaitSpeed) * 4;
  let bodyY = -14 + Math.abs(Math.sin(e.animTime * gaitSpeed)) * 1.5;
  bodyY += wind * 5;                      // çökerken gövde yere yaklaşır
  bodyY -= Math.sin(leap * Math.PI) * 3;  // sıçrarken toplanır

  // Bacaklar — havada toplanır, toparlanmada açılır
  const legTuck = leap > 0 ? 1 - Math.sin(leap * Math.PI) * 0.65 : 1;
  const legSpread = 1 + rec * 0.45;
  ctx.strokeStyle = '#2a1020'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
  const leg = (hx, swing) => {
    ctx.beginPath();
    ctx.moveTo(hx, bodyY + 6);
    ctx.lineTo((hx + swing) * legSpread, (bodyY + 6) + (0 - bodyY - 6) * legTuck);
    ctx.stroke();
  };
  leg(-9, -gait); leg(9, gait); leg(-5, gait); leg(5, -gait);

  // Gövde
  const bg = ctx.createLinearGradient(0, bodyY - 8, 0, bodyY + 8);
  bg.addColorStop(0, e.hurtFlash > 0 ? '#ffffff' : '#5a2440');
  bg.addColorStop(1, e.hurtFlash > 0 ? '#ffdddd' : '#2a1020');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(0, bodyY, 17, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sırt dikenleri — çökerken tamamen kalkar (kedinin tüyü kabarır gibi)
  ctx.fillStyle = e.hurtFlash > 0 ? '#fff' : '#7a3050';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 7 - 3, bodyY - 8);
    ctx.lineTo(i * 7, bodyY - 15 - (e.aggro * 3) - wind * 7);
    ctx.lineTo(i * 7 + 3, bodyY - 8);
    ctx.closePath(); ctx.fill();
  }

  // Kuyruk
  ctx.strokeStyle = e.hurtFlash > 0 ? '#fff' : '#3a1628';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-15, bodyY - 2);
  ctx.quadraticCurveTo(-24, bodyY - 8 + Math.sin(e.animTime * 8) * 4, -28, bodyY - 14);
  ctx.stroke();

  // Kafa
  ctx.fillStyle = e.hurtFlash > 0 ? '#fff' : '#3a1628';
  ctx.beginPath();
  ctx.moveTo(12, bodyY - 6);
  ctx.lineTo(27, bodyY - 1);
  ctx.lineTo(26, bodyY + 5);
  ctx.lineTo(12, bodyY + 6);
  ctx.closePath(); ctx.fill();

  // Kulaklar
  ctx.beginPath();
  ctx.moveTo(13, bodyY - 6); ctx.lineTo(15, bodyY - 15); ctx.lineTo(19, bodyY - 6);
  ctx.closePath(); ctx.fill();

  // Gözler (aggro'da kırmızı yanar, çökerken beyaza yakın parlar)
  const eyeGlow = wind > 0.15 ? '#ffd0d0' : (e.aggro > 0.3 ? '#ff3040' : '#ff9a30');
  ctx.save();
  ctx.shadowColor = wind > 0.15 ? '#ff3040' : eyeGlow;
  ctx.shadowBlur = 8 + e.aggro * 8 + wind * 16;
  ctx.fillStyle = eyeGlow;
  ctx.beginPath(); ctx.arc(20, bodyY - 1, 2.2 + wind * 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Dişler — sıçrarken ağız açılır
  const jaw = Math.sin(leap * Math.PI) * 4 + wind * 2;
  ctx.fillStyle = '#e8e0d0';
  ctx.beginPath();
  ctx.moveTo(24, bodyY + 4 + jaw); ctx.lineTo(25.5, bodyY + 8 + jaw); ctx.lineTo(27, bodyY + 4 + jaw);
  ctx.closePath(); ctx.fill();

  /* Toparlanma anında başın üstünde kısa bir "aç pencere" işareti:
     oyuncuya vurmanın tam sırası olduğunu söylüyor. */
  if (rec > 0) {
    ctx.save();
    ctx.globalAlpha *= rec * 0.7;
    ctx.strokeStyle = '#ffd76b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(4, bodyY - 22, 6 + (1 - rec) * 4, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ==========================================================================
   GECE YARASASI (flyer)
   ========================================================================== */
export function drawFlyer(ctx, e, cam) {
  const sx = e.x - cam.offsetX + e.w / 2;
  const sy = e.y - cam.offsetY + e.h / 2;

  ctx.save();
  ctx.translate(sx, sy);

  if (e.dying) {
    const t = e.deathTimer / 0.35;
    ctx.globalAlpha = 1 - t;
    ctx.scale(1 + t * 0.6, 1 + t * 0.6);
    ctx.rotate(t * 2);
  }

  const flap = Math.sin(e.wing);
  const wind = e.windup > 0 ? Math.min(1, e.windup) : 0;
  const col = e.hurtFlash > 0 ? '#fff'
    : wind > 0 ? '#8a3aba'
    : (e.diving ? '#6a2a9a' : '#3c1a5c');

  /* ---- Dalış hazırlığı ----
     Titreyerek gerilir ve altında bir hedef halkası büyür. Yarasa saniyede
     320 px'le geliyor; uyarı olmadan bu kaçınılabilir bir şey değil. */
  if (wind > 0) {
    const shake = Math.sin(e.animTime * 60) * 2.2 * wind;
    ctx.translate(shake, 0);
    ctx.save();
    ctx.globalAlpha *= 0.25 + wind * 0.45;
    ctx.strokeStyle = '#ff5a7a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 26 - wind * 14, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.scale(1 - wind * 0.12, 1 + wind * 0.14);
  }

  // Dalışta hareket izi — birden fazla hayalet silüet
  if (e.diving) {
    const tvx = Number.isFinite(e.vx) ? e.vx : 0;
    const tvy = Number.isFinite(e.vy) ? e.vy : 0;
    ctx.save();
    for (let i = 3; i >= 1; i--) {
      ctx.globalAlpha *= 0.22;
      ctx.fillStyle = '#8a4ade';
      ctx.beginPath();
      ctx.ellipse(-tvx * 0.018 * i, -tvy * 0.018 * i, 14 + i, 8 + i * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Kanatlar
  ctx.fillStyle = col;
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.scale(s, 1);
    ctx.beginPath();
    ctx.moveTo(4, -2);
    ctx.quadraticCurveTo(16, -8 + flap * 10, 30, -2 + flap * 14);
    ctx.lineTo(26, 2 + flap * 12);
    ctx.quadraticCurveTo(20, 4 + flap * 7, 14, 6 + flap * 3);
    ctx.quadraticCurveTo(10, 3, 4, 4);
    ctx.closePath();
    ctx.fill();
    // Kanat damarları
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(26, 0 + flap * 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 1); ctx.lineTo(18, 5 + flap * 6); ctx.stroke();
    ctx.restore();
  }

  // Gövde
  ctx.fillStyle = e.hurtFlash > 0 ? '#fff' : '#2a1040';
  ctx.beginPath(); ctx.ellipse(0, 0, 8, 10, 0, 0, Math.PI * 2); ctx.fill();

  // Kulaklar
  ctx.beginPath();
  ctx.moveTo(-5, -8); ctx.lineTo(-7, -16); ctx.lineTo(-1, -9); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(5, -8); ctx.lineTo(7, -16); ctx.lineTo(1, -9); ctx.closePath(); ctx.fill();

  // Gözler — dalışta / hazırlıkta daha parlak
  const eyePulse = wind > 0 ? 1.4 : (e.diving ? 1.25 : 1);
  ctx.save();
  ctx.shadowColor = '#ff4a6a'; ctx.shadowBlur = 10 + wind * 14;
  ctx.fillStyle = '#ff4a6a';
  ctx.beginPath(); ctx.arc(-3, -2, 1.9 * eyePulse, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3, -2, 1.9 * eyePulse, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ==========================================================================
   KARA BÜYÜCÜ (caster)
   ========================================================================== */
export function drawCaster(ctx, e, cam, time) {
  const sx = e.x - cam.offsetX + e.w / 2;
  const sy = e.y - cam.offsetY + e.h;

  ctx.save();
  ctx.translate(sx, sy);

  if (e.dying) {
    const t = e.deathTimer / 0.35;
    ctx.globalAlpha = 1 - t;
    ctx.translate(0, -t * 20);
    ctx.scale(1 - t * 0.3, 1 + t * 0.2);
  }

  ctx.scale(e.facing, 1);

  // Gölge
  ctx.save();
  ctx.scale(e.facing, 1);
  ctx.globalAlpha *= 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, 1, 16, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const float = Math.sin(time * 1.8 + e.animTime) * 3;
  const chargeLean = e.charging > 0.05 ? e.charging * 0.12 : 0;
  const recoilKick = e.recoil > 0 ? Math.max(0, e.recoil / 0.28) : 0;
  ctx.translate(0, float + chargeLean * 4 - recoilKick * 2);
  ctx.rotate(-chargeLean + recoilKick * 0.18);

  // Cübbe
  const robe = ctx.createLinearGradient(0, -46, 0, 0);
  robe.addColorStop(0, e.hurtFlash > 0 ? '#fff' : '#3a1f5e');
  robe.addColorStop(1, e.hurtFlash > 0 ? '#eee' : '#180a2a');
  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(-6, -40);
  ctx.lineTo(6, -40);
  ctx.quadraticCurveTo(15, -14, 14, 0);
  ctx.lineTo(-14, 0);
  ctx.quadraticCurveTo(-15, -14, -6, -40);
  ctx.closePath();
  ctx.fill();

  // Cübbe kenar süsü
  ctx.strokeStyle = '#a76bff'; ctx.lineWidth = 1.3;
  ctx.globalAlpha *= 0.6;
  ctx.beginPath(); ctx.moveTo(-13, -4); ctx.lineTo(13, -4); ctx.stroke();
  ctx.globalAlpha /= 0.6;

  // Kukuleta
  ctx.fillStyle = e.hurtFlash > 0 ? '#fff' : '#2a1246';
  ctx.beginPath();
  ctx.moveTo(-9, -38);
  ctx.quadraticCurveTo(-10, -54, 0, -55);
  ctx.quadraticCurveTo(10, -54, 9, -38);
  ctx.quadraticCurveTo(0, -34, -9, -38);
  ctx.closePath();
  ctx.fill();

  // Kukuleta içi karanlık + gözler
  ctx.fillStyle = '#08040e';
  ctx.beginPath(); ctx.ellipse(1, -44, 6, 6.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.shadowColor = '#c78bff'; ctx.shadowBlur = 10;
  ctx.fillStyle = '#c78bff';
  ctx.beginPath(); ctx.arc(-1, -45, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3.4, -45, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  /* Atıştan sonra asa geri teper: mermi "bir yerden" çıkmış olur */
  const kick = e.recoil > 0 ? Math.max(0, e.recoil / 0.28) : 0;
  ctx.save();
  ctx.rotate(kick * -0.22);

  // Asa
  ctx.strokeStyle = '#4a3a28'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(12, -6); ctx.lineTo(15, -46); ctx.stroke();

  /* ---- Şarj halkası ----
     Kristal büyümesi tek başına küçük ekranda kaçıyor. Kapanan bir halka
     "ne zaman" sorusunun cevabını veriyor: halka kapandığında mermi çıkar. */
  if (e.charging > 0.05) {
    ctx.save();
    ctx.globalAlpha *= 0.25 + e.charging * 0.55;
    ctx.strokeStyle = '#c78bff'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(15, -49, 18 - e.charging * 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * e.charging);
    ctx.stroke();
    ctx.restore();
  }

  // Asa kristali (şarj olurken büyür, atıştan sonra bir an sönük kalır)
  const ch = 0.6 + e.charging * 1.1;
  ctx.save();
  ctx.shadowColor = '#a76bff';
  ctx.shadowBlur = (14 + e.charging * 22) * (1 - kick * 0.6);
  ctx.fillStyle = kick > 0.5 ? '#f0e0ff' : '#c78bff';
  ctx.beginPath();
  ctx.moveTo(15, -54); ctx.lineTo(15 + 5 * ch, -49);
  ctx.lineTo(15, -44); ctx.lineTo(15 - 5 * ch, -49);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.restore();

  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ==========================================================================
   EJDERHA
   ========================================================================== */
export function drawDragon(ctx, d, cam, time) {
  const sx = d.x - cam.offsetX + d.w / 2;
  const sy = d.y - cam.offsetY + d.h / 2;
  const telegraph = d.telegraph || 0;
  const wingRaise = d.wingRaise || 0;
  const landShock = d.landShock || 0;
  const headShake = d.headShake || 0;
  const slamCharge = d.slamCharge || 0;
  const nextAtk = d.nextAttack;
  const isTele = d.state === 'telegraph';

  /* ---- Süpürme hattı işareti (hazırlıkta) ----
     Mantık katmanında seçilen yükseklik burada görünür hale gelir. */
  if (isTele && nextAtk === 'sweep' && telegraph > 0.05) {
    const laneY = (d.sweepLaneY || d.y) - cam.offsetY + d.h * 0.45;
    ctx.save();
    ctx.globalAlpha = 0.25 + telegraph * 0.55;
    ctx.strokeStyle = '#ff6a3a';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -time * 40;
    ctx.beginPath();
    ctx.moveTo(d.arenaMinX - cam.offsetX, laneY);
    ctx.lineTo(d.arenaMaxX - cam.offsetX, laneY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,90,40,0.12)';
    ctx.fillRect(d.arenaMinX - cam.offsetX, laneY - 18, d.arenaMaxX - d.arenaMinX, 36);
    ctx.restore();
  }

  /* ---- Çarpma hedef halkası ---- */
  if (isTele && nextAtk === 'slam' && telegraph > 0.1) {
    const gx = d.cx - cam.offsetX;
    const gy = d.groundY - cam.offsetY;
    ctx.save();
    ctx.globalAlpha = 0.35 + telegraph * 0.5;
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(gx, gy - 4, 40 + telegraph * 36, 10 + telegraph * 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(sx, sy);

  if (d.dying) {
    ctx.rotate(clamp(d.deathTimer * 0.5, 0, 0.5));
    ctx.globalAlpha = clamp(1 - (d.deathTimer - 2.2) / 1.0, 0, 1);
  }

  /* Yere çarpma sarsıntısı: kısa squash + titreme */
  if (landShock > 0.01) {
    ctx.translate((Math.sin(time * 90) * 4) * landShock, landShock * 6);
    ctx.scale(1 + landShock * 0.12, 1 - landShock * 0.14);
  }

  ctx.scale(d.facing, 1);

  const flash = d.hurtFlash > 0;
  const scaleDark = flash ? '#ffffff' : '#5c0f18';
  const scaleMid = flash ? '#ffdddd' : '#8f1a22';
  const scaleLight = flash ? '#ffffff' : '#c4302c';
  const flap = Math.sin(d.wing) * (1 - wingRaise * 0.35) + wingRaise * 0.85;
  const tired = d.state === 'tired';

  /* ---- Gölge ---- */
  const groundDist = (d.groundY - (d.y + d.h));
  ctx.save();
  ctx.scale(d.facing, 1);
  ctx.globalAlpha *= clamp(0.35 - groundDist / 900, 0.05, 0.35);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, groundDist + d.h / 2, 70 + slamCharge * 20, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  /* ---- Kuyruk ---- */
  ctx.strokeStyle = scaleDark;
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  const tailWave = Math.sin(time * 2.2 + d.animTime) * 18;
  ctx.beginPath();
  ctx.moveTo(-48, 6);
  ctx.quadraticCurveTo(-88, 10 + tailWave * 0.5, -120, -6 + tailWave);
  ctx.stroke();
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-118, -6 + tailWave);
  ctx.lineTo(-142, -16 + tailWave * 1.3);
  ctx.stroke();
  // Kuyruk ucu
  ctx.fillStyle = scaleLight;
  ctx.beginPath();
  ctx.moveTo(-140, -14 + tailWave * 1.3);
  ctx.lineTo(-162, -26 + tailWave * 1.5);
  ctx.lineTo(-146, -6 + tailWave * 1.2);
  ctx.closePath(); ctx.fill();

  /* ---- Arka kanat ---- */
  drawWing(ctx, -14, -18, flap, 1.0 + wingRaise * 0.2, 'rgba(60, 10, 16, 0.85)', tired, wingRaise);

  /* ---- Gövde ---- */
  const bodyGrad = ctx.createLinearGradient(0, -40, 0, 40);
  bodyGrad.addColorStop(0, scaleLight);
  bodyGrad.addColorStop(0.55, scaleMid);
  bodyGrad.addColorStop(1, scaleDark);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(-10, 2, 52, 32, -0.08, 0, Math.PI * 2);
  ctx.fill();

  // Karın plakaları
  ctx.fillStyle = flash ? '#fff' : '#d9a05a';
  ctx.globalAlpha *= 0.75;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(-10 + i * 13, 24, 6.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha /= 0.75;

  // Sırt dikenleri
  ctx.fillStyle = flash ? '#fff' : '#3a0a10';
  for (let i = 0; i < 6; i++) {
    const bx = -52 + i * 17;
    const bhh = 10 + Math.sin(i * 1.3) * 5;
    ctx.beginPath();
    ctx.moveTo(bx - 5, -26);
    ctx.lineTo(bx, -26 - bhh);
    ctx.lineTo(bx + 5, -26);
    ctx.closePath(); ctx.fill();
  }

  /* ---- Bacaklar ---- */
  ctx.strokeStyle = scaleDark;
  ctx.lineWidth = 11;
  const legSw = tired ? 0 : Math.sin(time * 3) * 6;
  ctx.beginPath(); ctx.moveTo(-30, 24); ctx.lineTo(-36, 44 + legSw * 0.3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(14, 24); ctx.lineTo(22, 44 - legSw * 0.3); ctx.stroke();
  // Pençeler
  ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 2.5;
  for (const [lx, ly] of [[-36, 44], [22, 44]]) {
    for (let c = -1; c <= 1; c++) {
      ctx.beginPath();
      ctx.moveTo(lx, ly); ctx.lineTo(lx + c * 6 + 3, ly + 7);
      ctx.stroke();
    }
  }

  /* ---- Boyun + kafa ---- */
  const headY = -30 + d.headBob + (isTele && nextAtk === 'meteor' ? -telegraph * 8 : 0);
  const shakeX = headShake > 0 ? Math.sin(time * 55) * 5 * headShake : 0;
  ctx.strokeStyle = scaleMid;
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.moveTo(28, -8);
  ctx.quadraticCurveTo(54, -20, 62 + shakeX, headY + 14);
  ctx.stroke();

  ctx.save();
  ctx.translate(66 + shakeX, headY + 8);
  ctx.rotate(tired ? 0.4 : (isTele && nextAtk === 'sweep' ? -0.35 - telegraph * 0.2 : -0.1));

  // Kafa
  ctx.fillStyle = flash ? '#fff' : scaleMid;
  ctx.beginPath();
  ctx.moveTo(-18, -14);
  ctx.quadraticCurveTo(6, -20, 26, -6);
  ctx.lineTo(34, 4);
  ctx.quadraticCurveTo(20, 14, -14, 14);
  ctx.quadraticCurveTo(-22, 0, -18, -14);
  ctx.closePath();
  ctx.fill();

  // Alt çene
  ctx.fillStyle = flash ? '#fff' : scaleDark;
  ctx.beginPath();
  ctx.moveTo(-12, 8);
  ctx.quadraticCurveTo(10, 16, 30, 6);
  ctx.quadraticCurveTo(14, 20, -10, 16);
  ctx.closePath();
  ctx.fill();

  // Boynuzlar
  ctx.strokeStyle = flash ? '#fff' : '#2a0a0e';
  ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-12, -12); ctx.quadraticCurveTo(-26, -26, -34, -18); ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-4, -16); ctx.quadraticCurveTo(-14, -32, -22, -30); ctx.stroke();

  // Göz
  ctx.save();
  const eyeCol = tired ? '#ff9a4a' : '#ffe14a';
  ctx.shadowColor = eyeCol; ctx.shadowBlur = tired ? 8 : 18;
  ctx.fillStyle = eyeCol;
  ctx.beginPath();
  ctx.ellipse(4, -6, 6, tired ? 1.8 : 4.5, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a0000';
  ctx.beginPath();
  ctx.ellipse(5, -6, 1.6, tired ? 1.4 : 4, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Dişler
  ctx.fillStyle = '#f0e8d0';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(6 + i * 7, 7);
    ctx.lineTo(9 + i * 7, 14);
    ctx.lineTo(12 + i * 7, 7);
    ctx.closePath(); ctx.fill();
  }

  // Ağız ışıltısı (ateş şarjı)
  if (d.mouthGlow > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(28, 4, 1, 28, 4, 34 * d.mouthGlow);
    g.addColorStop(0, `rgba(255, 220, 120, ${0.9 * d.mouthGlow})`);
    g.addColorStop(0.4, `rgba(255, 120, 40, ${0.6 * d.mouthGlow})`);
    g.addColorStop(1, 'rgba(255, 60, 20, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(28, 4, 34 * d.mouthGlow, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  ctx.restore(); // kafa

  /* ---- Ön kanat ---- */
  drawWing(ctx, -6, -22, flap, 1.15 + wingRaise * 0.25, flash ? 'rgba(255,255,255,0.9)' : 'rgba(120, 24, 30, 0.95)', tired, wingRaise);

  /* ---- Hazırlık aura ---- */
  if (isTele && telegraph > 0.08) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = telegraph * 0.45;
    const aura = ctx.createRadialGradient(0, 0, 20, 0, 0, 110);
    aura.addColorStop(0, nextAtk === 'meteor' ? 'rgba(255,80,40,0.55)' : 'rgba(255,160,60,0.4)');
    aura.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = aura;
    ctx.beginPath(); ctx.arc(0, 0, 110, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  ctx.restore();
  ctx.globalAlpha = 1;

  /* ---- Savunmasız göstergesi ---- */
  if (d.vulnerable) {
    const hb = d.headBox;
    const hx = hb.x - cam.offsetX + hb.w / 2;
    const hy = hb.y - cam.offsetY + hb.h / 2;
    const pulse = 0.6 + Math.sin(time * 8) * 0.4;
    ctx.save();
    ctx.globalAlpha = pulse * 0.8;
    ctx.strokeStyle = '#ffd76b';
    ctx.shadowColor = '#ffd76b';
    ctx.shadowBlur = 18;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -time * 30;
    ctx.beginPath();
    ctx.arc(hx, hy, 40 + Math.sin(time * 8) * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Ok işareti
    ctx.fillStyle = '#ffd76b';
    const ay = hy - 62 + Math.sin(time * 6) * 6;
    ctx.beginPath();
    ctx.moveTo(hx, ay + 14); ctx.lineTo(hx - 9, ay); ctx.lineTo(hx + 9, ay);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function drawWing(ctx, ox, oy, flap, scale, color, tired, wingRaise = 0) {
  ctx.save();
  ctx.translate(ox, oy);
  const f = tired ? -0.35 : flap;
  const spread = tired ? 0.35 : (1 + wingRaise * 0.55);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-40 * scale, (-50 + f * 30) * scale * spread, -90 * scale, (-30 + f * 46) * scale * spread);
  ctx.quadraticCurveTo(-70 * scale, (10 + f * 30) * scale * spread, -74 * scale, (26 + f * 22) * scale * spread);
  ctx.quadraticCurveTo(-52 * scale, (6 + f * 20) * scale * spread, -46 * scale, (34 + f * 14) * scale * spread);
  ctx.quadraticCurveTo(-30 * scale, (12 + f * 12) * scale * spread, -20 * scale, (32 + f * 8) * scale * spread);
  ctx.quadraticCurveTo(-12 * scale, (14 + f * 6) * scale * spread, 0, 6);
  ctx.closePath();
  ctx.fill();

  // Kanat kemikleri
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2.4 * scale;
  const tips = [
    [-90, -30 + f * 46], [-74, 26 + f * 22], [-46, 34 + f * 14], [-20, 32 + f * 8]
  ];
  for (const [tx, ty] of tips) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(tx * scale, ty * scale * spread);
    ctx.stroke();
  }
  ctx.restore();
}
