/* ==========================================================================
   Figürler — kahraman ve yoldaş

   Tasarım kararı: DETAYLI KARAKTER DEĞİL, IŞIK ALMIŞ SİLUET.

   Sebebi şu — canvas'ta prosedürel olarak detaylı yüz/kostüm çizmek neredeyse
   her zaman kötü görünür. Ama arkadan gelen güneşe karşı duran koyu bir siluet
   + altın kenar ışığı, sinemada da en çok kullanılan kadraj ve kodla mükemmel
   çıkıyor. Uçsuz bucaksız çayır + batan güneş için de doğru dil.

   Yağlı boya görsellere geçilirse: figürler ayrı PNG olarak gelir, bu dosya
   sadece ön plandaki gölge ve kenar ışığını çizmeye devam eder.

   Ortak arayüz: figür AYAK HİZASINDAN çizilir → (a.x, a.y) yerdeki nokta.
   ========================================================================== */

import { clamp } from '../easing.js';

/* Referans yükseklik — scale=1 iken figür bu kadar uzun */
const H = 108;

/* --------------------------------------------------------------------------
   Poz sistemi
   -------------------------------------------------------------------------- */

function getPose(a, t) {
  const anim = a.anim || 'idle';
  const ph = a.phase ?? 0;
  const amp = a.walkAmp ?? 0;

  const pose = {
    lean: 0,          // gövde öne eğimi (derece)
    bob: 0,           // dikey salınım
    crouch: 0,        // çömelme miktarı (0..1) — bacaklar kısalır
    legF: 0, legB: 0, // bacak açıları
    armF: 0, armB: 0, // kol açıları
    headTilt: 0,
    capeFlow: 2,
    seated: false,
    kneeling: false
  };

  switch (anim) {
    case 'walk': {
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      pose.legF = s * 26 * (0.35 + amp);
      pose.legB = -s * 26 * (0.35 + amp);
      pose.armF = -s * 20 * (0.3 + amp);
      pose.armB = s * 20 * (0.3 + amp);
      pose.bob = Math.abs(c) * 3.2 * (0.4 + amp);
      pose.lean = 5 * (0.4 + amp);
      pose.capeFlow = 6 + amp * 12 + s * 3;
      break;
    }
    /* Açı işareti önemli: POZİTİF açı kolu bakış yönüne (öne) savurur,
       negatif açı geriye. İlk sürümde "uzanma" pozları negatifti ve
       karakterler ellerini arkaya uzatıyordu. */
    case 'reach': {
      pose.armF = 78;
      pose.armB = -16;
      pose.lean = 7;
      pose.bob = Math.sin(t * 1.6) * 1.1;
      pose.capeFlow = 3 + Math.sin(t * 0.9) * 1.6;
      break;
    }
    case 'offerHand': {
      pose.armF = 62 + Math.sin(t * 1.3) * 2.5;
      pose.armB = -14;
      pose.lean = 5;
      pose.bob = Math.sin(t * 1.4) * 1.2;
      pose.capeFlow = 3;
      break;
    }
    case 'kneel': {
      pose.kneeling = true;
      pose.crouch = 0.44;
      pose.lean = 10;
      pose.armF = 44;
      pose.armB = -12;
      pose.bob = Math.sin(t * 1.2) * 0.8;
      pose.capeFlow = 5;
      break;
    }
    case 'sit': {
      pose.seated = true;
      pose.crouch = 0.55;
      pose.lean = -4;
      pose.armB = -22;
      pose.armF = 28;
      pose.bob = Math.sin(t * 1.0) * 0.7;
      pose.capeFlow = 2;
      break;
    }
    case 'recoil': {
      /* Şok pozu: iki kol da yukarı-geriye. Yatay değil. */
      pose.lean = -24;
      pose.armF = -148 + Math.sin(t * 9) * 6;
      pose.armB = -126 + Math.sin(t * 9 + 1) * 6;
      pose.bob = Math.sin(t * 9) * 2.4;
      pose.capeFlow = 14;
      break;
    }
    case 'reachBack': {
      pose.lean = -6;
      pose.armF = 52;
      pose.armB = -30;
      pose.bob = Math.sin(t * 1.5) * 1.1;
      pose.capeFlow = 4;
      break;
    }
    case 'idle':
    default: {
      pose.bob = Math.sin(t * 1.5) * 1.5;
      pose.armF = Math.sin(t * 1.5 + 0.4) * 3;
      pose.armB = -Math.sin(t * 1.5 + 0.4) * 3;
      pose.capeFlow = 2.5 + Math.sin(t * 0.85) * 1.4;
      break;
    }
  }
  return pose;
}

/* --------------------------------------------------------------------------
   Ortak parçalar
   -------------------------------------------------------------------------- */

function groundShadow(ctx, w, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, 1, w, w * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Bacak — kalçadan ayağa, açıya göre savrulur */
function leg(ctx, hipY, len, angle, w, color) {
  const rad = angle * Math.PI / 180;
  const kneeX = Math.sin(rad) * len * 0.45;
  const kneeY = hipY + Math.cos(rad) * len * 0.5;
  const footX = Math.sin(rad) * len * 0.95;
  const footY = hipY + Math.cos(rad * 0.72) * len;

  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, hipY);
  ctx.quadraticCurveTo(kneeX, kneeY, footX, Math.min(footY, 0));
  ctx.stroke();
}

/** Kol — omuzdan ele */
function arm(ctx, shoulderY, len, angle, w, color) {
  const rad = angle * Math.PI / 180;
  const elbowX = Math.sin(rad) * len * 0.5;
  const elbowY = shoulderY + Math.cos(rad) * len * 0.5;
  const handX = Math.sin(rad) * len;
  const handY = shoulderY + Math.cos(rad) * len;

  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, shoulderY);
  ctx.quadraticCurveTo(elbowX, elbowY, handX, handY);
  ctx.stroke();
  return { x: handX, y: handY };
}

/* --------------------------------------------------------------------------
   KAHRAMAN — pelerin, kılıç, miğfer silueti
   -------------------------------------------------------------------------- */

export function drawHero(ctx, a, p, t, opts = {}) {
  if (!a || (a.alpha ?? 1) <= 0.01) return;

  const s = (a.scale ?? 1);
  const h = H * s;
  const pose = getPose(a, t);
  const dark = opts.body || '#12101a';
  const cape = opts.cape || '#5c1226';
  const rim = `rgba(${p.rim}, ${opts.rimStrength ?? 0.85})`;
  const rimW = Math.max(1.0, 1.5 * s);

  ctx.save();
  ctx.globalAlpha = a.alpha ?? 1;
  ctx.translate(a.x, a.y);
  groundShadow(ctx, 17 * s, 0.3 * (a.alpha ?? 1));

  ctx.scale(a.facing >= 0 ? 1 : -1, 1);
  if (a.rot) ctx.rotate(a.rot);
  ctx.translate(0, -pose.bob * s);
  ctx.rotate(-pose.lean * Math.PI / 180 * 0.35);

  const legLen = h * 0.40 * (1 - pose.crouch);
  const hipY = -legLen;
  const shoulderY = hipY - h * 0.30;
  const headY = shoulderY - h * 0.11;

  /* ---- Pelerin (gövdenin arkasında) ---- */
  const flow = pose.capeFlow * s;
  ctx.fillStyle = cape;
  ctx.beginPath();
  ctx.moveTo(-2 * s, shoulderY - h * 0.03);
  ctx.quadraticCurveTo(-14 * s - flow, hipY - h * 0.18, -11 * s - flow * 1.5, hipY + h * 0.26);
  ctx.quadraticCurveTo(-5 * s - flow * 0.5, hipY + h * 0.18, -1 * s, hipY - h * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.moveTo(-2 * s, shoulderY - h * 0.03);
  ctx.quadraticCurveTo(-10 * s - flow * 0.6, hipY - h * 0.14, -8 * s - flow, hipY + h * 0.16);
  ctx.quadraticCurveTo(-4 * s, hipY + h * 0.10, -1 * s, hipY - h * 0.04);
  ctx.closePath();
  ctx.fill();

  /* ---- Sırttaki kılıç ---- */
  if (opts.sword !== false) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(-7 * s, shoulderY - h * 0.06);
    ctx.lineTo(-15 * s, hipY + h * 0.10);
    ctx.stroke();
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.1 * s;
    ctx.beginPath();
    ctx.moveTo(-6 * s, shoulderY - h * 0.05);
    ctx.lineTo(-14 * s, hipY + h * 0.08);
    ctx.stroke();
  }

  /* ---- Arka kol + arka bacak ---- */
  ctx.globalAlpha = (a.alpha ?? 1) * 0.72;
  arm(ctx, shoulderY, h * 0.30, pose.armB, 5.2 * s, dark);
  if (!pose.seated) leg(ctx, hipY, legLen, pose.legB, 6.4 * s, dark);
  ctx.globalAlpha = a.alpha ?? 1;

  /* ---- Gövde ---- */
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(-7.5 * s, shoulderY);
  ctx.quadraticCurveTo(-9 * s, hipY - h * 0.14, -6 * s, hipY + 1);
  ctx.lineTo(6 * s, hipY + 1);
  ctx.quadraticCurveTo(9 * s, hipY - h * 0.14, 7.5 * s, shoulderY);
  ctx.quadraticCurveTo(0, shoulderY - h * 0.045, -7.5 * s, shoulderY);
  ctx.closePath();
  ctx.fill();

  /* Omuz zırhları */
  ctx.beginPath();
  ctx.ellipse(-7 * s, shoulderY + h * 0.01, 5 * s, 3.4 * s, -0.3, 0, Math.PI * 2);
  ctx.ellipse(7 * s, shoulderY + h * 0.01, 5 * s, 3.4 * s, 0.3, 0, Math.PI * 2);
  ctx.fill();

  /* ---- Bacaklar ----
     Oturma pozunda bacaklar öne uzanır; yoksa figür "kısa bacaklı ayakta
     duran adam" gibi görünüyor (ilk render'da tam olarak bu olmuştu). */
  if (pose.seated) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = 6.2 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(1 * s, hipY + h * 0.04);
    ctx.quadraticCurveTo(15 * s, hipY + h * 0.16, 24 * s, -1);
    ctx.stroke();
    ctx.lineWidth = 5.2 * s;
    ctx.beginPath();
    ctx.moveTo(-1 * s, hipY + h * 0.06);
    ctx.quadraticCurveTo(12 * s, hipY + h * 0.19, 19 * s, -1);
    ctx.stroke();
    /* Yere değen kalça gölgesi */
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(-3 * s, hipY + h * 0.09, 8 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    leg(ctx, hipY, legLen, pose.legF, 6.8 * s, dark);
  }

  /* ---- Baş + miğfer ---- */
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(1.2 * s, headY, 6.4 * s, 7.2 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  /* Miğfer tepeliği */
  ctx.beginPath();
  ctx.moveTo(-1 * s, headY - 6.6 * s);
  ctx.quadraticCurveTo(-6 * s, headY - 12 * s, -9 * s + flow * 0.3, headY - 5 * s);
  ctx.quadraticCurveTo(-4 * s, headY - 7 * s, -1 * s, headY - 4.4 * s);
  ctx.closePath();
  ctx.fillStyle = cape;
  ctx.fill();

  /* ---- Ön kol ---- */
  const hand = arm(ctx, shoulderY, h * 0.31, pose.armF, 5.6 * s, dark);

  /* ---- KENAR IŞIĞI ----
     Işık kaynağı sabittir, figürün baktığı yön değil. Karakter sola dönünce
     çizim uzayı aynalanıyor; bu yüzden kenar ışığını geri çevirmemiz gerekiyor,
     yoksa güneş sağdayken parıltı solda kalıyor. */
  const rimSide = (a.facing >= 0 ? 1 : -1) * (opts.lightDir ?? 1);
  ctx.save();
  ctx.scale(rimSide, 1);
  ctx.strokeStyle = rim;
  ctx.lineWidth = rimW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(6.6 * s, shoulderY + h * 0.02);
  ctx.quadraticCurveTo(8.6 * s, hipY - h * 0.14, 5.6 * s, hipY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(1.2 * s, headY, 6.4 * s, -Math.PI * 0.42, Math.PI * 0.30);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(7 * s, shoulderY + h * 0.01, 5 * s, 3.4 * s, 0.3, -Math.PI * 0.9, Math.PI * 0.15);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
  return hand;
}

/* --------------------------------------------------------------------------
   YOLDAŞ — uzun pelerin/elbise, savrulan saç, fener
   -------------------------------------------------------------------------- */

export function drawCompanion(ctx, a, p, t, opts = {}) {
  if (!a || (a.alpha ?? 1) <= 0.01) return;

  const s = (a.scale ?? 1);
  const h = H * s * 0.95;
  const pose = getPose(a, t);
  const dark = opts.body || '#14121c';
  const robe = opts.robe || '#1d4a44';
  const hair = opts.hair || '#241118';
  const rim = `rgba(${p.rim}, ${opts.rimStrength ?? 0.9})`;
  const rimW = Math.max(1.0, 1.45 * s);

  ctx.save();
  ctx.globalAlpha = a.alpha ?? 1;
  ctx.translate(a.x, a.y);
  groundShadow(ctx, 16 * s, 0.28 * (a.alpha ?? 1));

  ctx.scale(a.facing >= 0 ? 1 : -1, 1);
  if (a.rot) ctx.rotate(a.rot);
  ctx.translate(0, -pose.bob * s);
  ctx.rotate(-pose.lean * Math.PI / 180 * 0.3);

  const legLen = h * 0.38 * (1 - pose.crouch);
  const hipY = -legLen;
  const shoulderY = hipY - h * 0.29;
  const headY = shoulderY - h * 0.11;
  const flow = pose.capeFlow * s;

  /* ---- Arka kol ---- */
  ctx.globalAlpha = (a.alpha ?? 1) * 0.7;
  arm(ctx, shoulderY, h * 0.29, pose.armB, 4.4 * s, dark);
  ctx.globalAlpha = a.alpha ?? 1;

  /* ---- Uzun elbise — tabana doğru genişleyen, rüzgarda savrulan etek ---- */
  const hemY = pose.seated ? hipY + h * 0.16 : 0;
  const hemSpread = (13 + Math.abs(flow) * 0.7) * s;
  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(-6.5 * s, shoulderY);
  ctx.quadraticCurveTo(-9 * s, hipY - h * 0.10, -hemSpread - flow * 0.9, hemY);
  ctx.quadraticCurveTo(0, hemY + 4 * s, hemSpread - flow * 0.9, hemY);
  ctx.quadraticCurveTo(9 * s, hipY - h * 0.10, 6.5 * s, shoulderY);
  ctx.quadraticCurveTo(0, shoulderY - h * 0.04, -6.5 * s, shoulderY);
  ctx.closePath();
  ctx.fill();

  /* Etekte kıvrım gölgesi */
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.moveTo(-4 * s, hipY - h * 0.04);
  ctx.quadraticCurveTo(-8 * s, hipY + h * 0.10, -hemSpread * 0.55 - flow * 0.6, hemY);
  ctx.quadraticCurveTo(-2 * s, hemY + 2 * s, -1 * s, hipY);
  ctx.closePath();
  ctx.fill();

  /* Oturuyorsa bacaklar öne uzanır */
  if (pose.seated) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = 5.4 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(2 * s, hipY + h * 0.08);
    ctx.quadraticCurveTo(14 * s, hipY + h * 0.20, 22 * s, 0);
    ctx.stroke();
  }

  /* ---- Baş ---- */
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(1 * s, headY, 5.8 * s, 6.6 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  /* ---- Saç — rüzgarda arkaya savrulan kütle ---- */
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.moveTo(4.6 * s, headY - 4.4 * s);
  ctx.quadraticCurveTo(-2 * s, headY - 9.6 * s, -6.4 * s, headY - 2.6 * s);
  ctx.quadraticCurveTo(-11 * s - flow * 1.1, headY + h * 0.06, -7 * s - flow * 0.8, shoulderY + h * 0.13);
  ctx.quadraticCurveTo(-3.2 * s, shoulderY + h * 0.02, -3.6 * s, headY + 2.4 * s);
  ctx.closePath();
  ctx.fill();

  /* ---- Ön kol ---- */
  const hand = arm(ctx, shoulderY, h * 0.30, pose.armF, 4.7 * s, dark);

  /* ---- Fener (isteğe bağlı) ---- */
  if (opts.lantern && hand) {
    const lx = hand.x, ly = hand.y + 4 * s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 44 * s);
    g.addColorStop(0, 'rgba(255, 214, 140, 0.55)');
    g.addColorStop(1, 'rgba(255, 170, 60, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(lx, ly, 44 * s, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffdca0';
    ctx.beginPath(); ctx.arc(lx, ly, 2.4 * s, 0, Math.PI * 2); ctx.fill();
  }

  /* ---- Kenar ışığı — ışık yönüne göre, bakış yönüne göre değil ---- */
  const rimSide = (a.facing >= 0 ? 1 : -1) * (opts.lightDir ?? 1);
  ctx.save();
  ctx.scale(rimSide, 1);
  ctx.strokeStyle = rim;
  ctx.lineWidth = rimW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(5.8 * s, shoulderY + h * 0.02);
  ctx.quadraticCurveTo(9 * s, hipY - h * 0.06, hemSpread * 0.82 - flow * 0.9, hemY - 2 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(1 * s, headY, 5.8 * s, -Math.PI * 0.45, Math.PI * 0.28);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
  return hand;
}

/* --------------------------------------------------------------------------
   İki figür arasındaki bağ — uzanan eller, birleşme anı
   -------------------------------------------------------------------------- */

/** İki karakter yeterince yakınsa aralarında sıcak bir ışık belirir */
export function drawBond(ctx, p, a, b, t, opts = {}) {
  if (!a || !b) return;
  const d = Math.abs(a.x - b.x);
  const near = clamp(1 - (d - 55) / 90, 0, 1);
  if (near <= 0.01) return;

  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 - 58 * (a.scale ?? 1);
  const pulse = 0.72 + Math.sin(t * 1.9) * 0.28;
  const r = (34 + pulse * 16) * (a.scale ?? 1);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(mx, my, 0, mx, my, r);
  g.addColorStop(0, `rgba(${p.rim}, ${0.20 * near * pulse * (opts.strength ?? 1)})`);
  g.addColorStop(1, `rgba(${p.rim}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(mx, my, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
