/* ==========================================================================
   AÇILIŞ SAHNESİ — "Maceraya Davet"

   Kadraj: uçsuz bucaksız altın saat çayırı. Kahraman soldan girer, uzakta
   bekleyen figüre doğru yürür, yanına varır ve elini uzatır. Gökyüzünden
   bir ejderha gölgesi geçer — davetin bedeli hatırlatılır. Kesme, oyun başlar.

   Süre: 32 sn. İlk 2 saniye siyahtan açılış, son 1.5 saniye siyaha kesme.
   ========================================================================== */

import { VW, VH } from '../stage.js';
import { getPalette } from '../art/palette.js';
import { drawSky, drawSun, drawClouds, drawHaze, drawBirds } from '../art/sky.js';
import { drawHillBand, drawRidgeTrees, drawMountains } from '../art/hills.js';
import {
  drawMeadowGround, drawGrassTufts, drawWildflowers,
  drawForegroundGrass, drawTrampledGrass
} from '../art/grass.js';
import { drawHero, drawCompanion, drawBond } from '../art/figures.js';
import { drawPixelActor, drawPixelDragon } from '../art/pixelSprites.js';
import { drawMotes, drawLightShafts, drawLensFlare, drawGroundMist } from '../art/fx.js';
import { hybrid, proc } from '../layers.js';
import { clamp01, envelope } from '../easing.js';
import { S } from '../script.js';

const P = getPalette('goldenMeadow');
const HORIZON = VH * 0.62;      // 446
const GROUND = 596;            // aktörlerin bastığı çizgi (ufkun ~150px altı)
const SUN = { x: VW * 0.78, y: VH * 0.26 };

/* --------------------------------------------------------------------------
   Ejendaha gölgesi — sahnenin sonunda gökten geçer
   -------------------------------------------------------------------------- */

function shadowPass(t) {
  /* 27.0 → 31.0 arasında soldan sağa süzülür */
  return clamp01((t - 27) / 4);
}

/* ==========================================================================
   EJDERHA GEÇİŞİ — uçuş yolu

   Eskiden ejderha sabit yükseklikte düz bir çizgide kayıyordu: ne yaklaşıyor
   ne uzaklaşıyordu, sadece ekranı geçen bir leke gibiydi. Perspektif yok,
   ağırlık yok, tehdit yok.

   Şimdi gerçek bir geçiş yayı var:

     · UZAKTAN GELİR   — yüksekte ve küçük (ölçek 0.42)
     · YAKLAŞIR        — alçalır, büyür; kadrajın ortasında en yakın
                         (ölçek 1.0) ve en alçak nokta
     · UZAKLAŞIR       — yeniden tırmanır ve küçülür

   Ölçek ve yükseklik AYNI eğriden türüyor; ikisi ayrı ayrı ayarlansaydı
   "yakın ama yüksekte" gibi tutarsız kareler çıkardı.

   Eğim (bank) yolun türevinden geliyor: alçalırken burun aşağı, tırmanırken
   yukarı. Bu tek detay, uçuşu "kayan resim" olmaktan çıkarıp uçuş yapıyor.
   ========================================================================== */

/** Yakınlık eğrisi: 0 = uzak/yüksek, 1 = en yakın/en alçak */
function dragonNear(f) {
  /* Ortada tepe yapan yumuşak çan eğrisi */
  return Math.sin(clamp01(f) * Math.PI);
}

function dragonFlight(f) {
  const near = dragonNear(f);
  return {
    /* Yatay yol: yaklaşınca hızlanır (perspektif hissi) */
    x: -300 + f * (VW + 600),
    /* Yükseklik: uzakta ufka yakın, yaklaşınca alçalıp kadrajı doldurur.
       En alçak nokta karakterlerin başının epey üstünde kalıyor — ejderha
       onları ezmemeli, sadece üzerlerinden geçmeli. */
    y: VH * 0.10 + near * VH * 0.23,
    /* Ölçek yakınlıkla birlikte — aynı eğri.
       1.55'e kadar çıkıyor: geçiş "uzakta bir kuş" değil, "üstümüzden bir
       şey geçti" hissi vermeli. */
    scale: 0.38 + near * 1.17,
    /* Görünürlük: kenarlarda pusun içinden çıkıp yine puslanır */
    alpha: clamp01(near * 1.9)
  };
}

/** Uçuş yolunun eğimi → gövdenin eğilmesi */
function dragonBank(f) {
  const d = 0.02;
  const a = dragonFlight(clamp01(f - d));
  const b = dragonFlight(clamp01(f + d));
  /* Ekran uzayında yol açısı; hafifletiyoruz ki sprite bozulmasın */
  return Math.atan2(b.y - a.y, Math.max(1, b.x - a.x)) * 0.55;
}

/** Pixel sprite yoksa devreye giren yedek siluet — aynı yolu izler */
function drawFlyingDragon(ctx, t) {
  const f = shadowPass(t);
  if (f <= 0 || f >= 1) return;

  const fl = dragonFlight(f);
  const x = fl.x;
  const y = fl.y;
  const flap = Math.sin(t * 7);
  const a = fl.alpha * 0.78;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#171320';
  ctx.translate(x, y);
  ctx.rotate(dragonBank(f));
  /* Uçuş yönü sağa: siluet de sağa baksın */
  ctx.scale(-1.35 * fl.scale, 1.35 * fl.scale);

  /* Gövde */
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  /* Boyun + baş */
  ctx.beginPath();
  ctx.moveTo(-16, -2);
  ctx.quadraticCurveTo(-34, -8, -44, -2);
  ctx.lineTo(-42, 2);
  ctx.quadraticCurveTo(-32, -2, -14, 3);
  ctx.closePath();
  ctx.fill();
  /* Kuyruk */
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.quadraticCurveTo(44, 4, 58, 12);
  ctx.lineTo(56, 6);
  ctx.quadraticCurveTo(42, 0, 16, -3);
  ctx.closePath();
  ctx.fill();
  /* Kanatlar */
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-4, -1);
    ctx.quadraticCurveTo(10 * dir, -18 - flap * 10, 40 * dir, -6 - flap * 16);
    ctx.quadraticCurveTo(18 * dir, 6 - flap * 4, 6, 3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Yer gölgesi — ejderhanın altında, onunla birlikte.
 *
 * Gölge alçaldıkça KÜÇÜLÜP KOYULAŞIR, yükseldikçe büyüyüp soluklaşır.
 * Gerçek gölge davranışı bu ve seyirciye ejderhanın ne kadar alçaldığını
 * anlatan asıl ipucu bu — eskiden sabit boyutlu soluk bir lekeydi.
 */
function drawGroundShadowSweep(ctx, t) {
  const f = shadowPass(t);
  if (f <= 0 || f >= 1) return;
  const fl = dragonFlight(f);
  const near = dragonNear(f);
  /* Güneş sağ üstte (SUN.x = %78) → gölge sola düşer. Tam altına koymak
     "güneş tepede" demek olurdu ve sahnedeki ışıkla çelişirdi. */
  const x = fl.x - 90 - near * 40;
  /* Yaklaşınca: yarıçap küçülür, koyuluk artar.
     Gölge SEYİRCİNİN gördüğü tek "ne kadar alçaldı" ipucu; soluk bir leke
     olarak bırakılırsa geçişin ağırlığı kayboluyor. */
  const r = 380 - near * 175;
  const a = (0.10 + near * 0.52) * clamp01(near * 2.2);

  ctx.save();
  const g = ctx.createRadialGradient(x, GROUND - 40, 20, x, GROUND - 40, r);
  g.addColorStop(0, `rgba(12, 10, 20, ${a})`);
  g.addColorStop(0.55, `rgba(12, 10, 20, ${a * 0.45})`);
  g.addColorStop(1, 'rgba(12, 10, 20, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 400, HORIZON - 60, 800, VH);
  ctx.restore();
}

/* --------------------------------------------------------------------------
   SAHNE
   -------------------------------------------------------------------------- */

export const introScene = {
  id: 'intro',
  duration: 32,
  next: 'game',
  clear: '#0b1020',

  /* ---------------- Katmanlar ---------------- */
  layers: [

    /* Tek pixel-art master arka plan; dosya yüklenemezse eski prosedürel
       manzaranın tamamı yedek olarak çizilir. */
    hybrid('pixelBackdrop', 0, 0.04, 'cine/intro-bg.webp', (ctx, { t, cam }) => {
      drawSky(ctx, P, t, { horizon: HORIZON });
      drawSun(ctx, P, t, { x: SUN.x, y: SUN.y, r: 52, glow: 1 });
      drawClouds(ctx, P, t, { count: 8, y: VH * 0.17, alpha: 0.42, drift: 7 });
      drawMountains(ctx, P, { baseY: HORIZON + 6, height: 138, alpha: 0.42, seed: 3, snow: true });
      drawHillBand(ctx, { color: P.hillMid, baseY: HORIZON + 26, amp: 52, freq: 0.0019, seed: 1.4, alpha: 0.85, t, drift: 0 });
      drawRidgeTrees(ctx, { color: P.hillMid, baseY: HORIZON + 26, amp: 52, freq: 0.0019, seed: 1.4, count: 30, size: 13, alpha: 0.6 });
      drawHillBand(ctx, { color: P.hillNear, baseY: HORIZON + 62, amp: 44, freq: 0.0026, seed: 5.1, alpha: 0.95, t });
      drawRidgeTrees(ctx, { color: P.hillNear, baseY: HORIZON + 62, amp: 44, freq: 0.0026, seed: 5.1, count: 20, size: 20, alpha: 0.75 });
      drawHaze(ctx, P, { horizon: HORIZON + 40, height: 210, strength: 0.5 });
      drawMeadowGround(ctx, P, t, { horizon: HORIZON + 34, wind: 1 });
      drawGrassTufts(ctx, P, t, { horizon: HORIZON + 40, count: 620, seed: 11, wind: 1, bottom: VH + 170, viewX: cam.x * 0.70 });
      drawWildflowers(ctx, P, t, { horizon: HORIZON + 46, count: 120, seed: 55, alpha: 0.9 });
    }, { smoothing: false }),

    /* z8 — Yer sisi */
    proc('mist', 8, 0.6, (ctx, { t }) => {
      drawGroundMist(ctx, P, t, { y: HORIZON + 44, alpha: 0.24, count: 4 });
    }),

    /* Yavaş bulut gölgeleri, tek parça arka planın üzerinde ayrı hızda
       kayarak orta planı kameradan bağımsız canlı tutar. */
    proc('cloudShadows', 8.5, 0.78, (ctx, { t }) => {
      ctx.save();
      ctx.fillStyle = 'rgba(16, 24, 42, 0.085)';
      for (let i = 0; i < 3; i++) {
        const x = ((t * (24 + i * 5) + i * 510) % (VW + 720)) - 360;
        const y = HORIZON + 80 + i * 62;
        ctx.beginPath();
        ctx.ellipse(x, y, 260 + i * 70, 34 + i * 10, -0.08, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }),

    /* z9 — Aktörler */
    proc('actors', 9, 1.0, (ctx, { t, actors }) => {
      const { hero, companion } = actors;
      drawTrampledGrass(ctx, P, t, hero, { spread: 58 });
      drawPixelActor(ctx, 'companion', companion, t, () =>
        drawCompanion(ctx, companion, P, t, {
          robe: '#1d4a44', hair: '#2a1420', rimStrength: 0.6, lightDir: 1
        }));
      drawPixelActor(ctx, 'hero', hero, t, () =>
        drawHero(ctx, hero, P, t, {
          cape: '#7a1a30', body: '#141119', rimStrength: 0.6, lightDir: 1
        }));
      drawBond(ctx, P, hero, companion, t, { strength: 1 });
    }),

    /* z10 — Ejderha geçişi: gök + yer gölgesi aynı paralaksta, aynı x.
       Eski 0.22 / 0.9 ayrımı gölgeyi bedenin altından kaydırıyordu. */
    proc('dragonPass', 10, 0.55, (ctx, { t }) => {
      const f = shadowPass(t);
      if (f <= 0 || f >= 1) return;

      /* Yer gölgesi ejderhadan ÖNCE çizilir: gölge zeminde, beden gökte. */
      drawGroundShadowSweep(ctx, t);

      const fl = dragonFlight(f);
      drawPixelDragon(ctx, {
        flying: true,
        t,
        x: fl.x,
        y: fl.y,
        scale: fl.scale,
        /* Yaklaştıkça kanat çırpışı yavaşlar — büyük bir yaratığın
           ağırlığını anlatan en ucuz ve en etkili detay. */
        flapFps: 8.5 - dragonNear(f) * 3.5,
        rotation: dragonBank(f),
        /* Sprite'lar sola bakıyor; sağa uçtuğu için aynalanıyor. Eskiden
           facing:1 ile ejderha geri geri uçuyordu. */
        facing: 1,
        alpha: fl.alpha
      }, () => drawFlyingDragon(ctx, t));
    }),

    /* z12 — Işık huzmeleri */
    proc('shafts', 12, 0.30, (ctx, { t }) => {
      drawLightShafts(ctx, P, t, { x: SUN.x, y: SUN.y, alpha: 0.17, count: 7, spread: 0.55 });
    }, { blend: 'lighter' }),

    /* z13 — Polen */
    proc('motes', 13, 1.05, (ctx, { t }) => {
      drawMotes(ctx, P, t, { count: 95, alpha: 0.85, rise: 14 });
    }),

    /* z14 — Kuşlar */
    proc('birds', 14, 0.4, (ctx, { t }) => {
      drawBirds(ctx, t - 8, {
        x: VW * 1.3, y: VH * 0.20, count: 9, speed: 40,
        alpha: envelope(t, 8, 13, 1.6, 2.6) * 0.55
      });
    }),

    /* z15 — ÖN PLAN OTLARI: bu katman her zaman kodda kalsın.
       Yağlı boya arka planın üstünde hareket eden tek şey bu olacak. */
    proc('fgGrass', 15, 1.35, (ctx, { t }) => {
      drawForegroundGrass(ctx, P, t, { count: 95, baseY: VH + 96, wind: 1.3, seed: 99 });
    }),

    /* z16 — Lens parlaması */
    proc('flare', 16, 0.05, (ctx, { t }) => {
      drawLensFlare(ctx, P, t, { x: SUN.x, y: SUN.y, alpha: 0.42 });
    })
  ],

  /* ---------------- Kamera ----------------
     Merkez dünya X ≈ cam.x + VW/2. Kahraman takip planı kahramanın
     x'ine hizalı (t≈6 → ~378, t≈12 → 560). */
  camera: [
    /* 1 — mekânı kuran geniş plan */
    { t: 0,     x: 0,    y: 0,   zoom: 1.02 },
    { t: 6.0,   x: 36,   y: 0,   zoom: 1.05, ease: 'outQuad' },
    /* 2 — kahramanı ortalayan yumuşak takip (eski -430 kahramanı sağa itiyordu) */
    { t: 6.05,  x: -280, y: 6,   zoom: 1.20, cut: true },
    { t: 12.0,  x: -90,  y: 4,   zoom: 1.16, ease: 'inOutCubic' },
    /* 3 — iki karakteri aynı kadraja alan ikili */
    { t: 12.05, x: 150,  y: 0,   zoom: 1.04, cut: true },
    { t: 20.2,  x: 280,  y: 0,   zoom: 1.10, ease: 'inOutCubic' },
    /* 4 — el uzatma ve isim anı */
    { t: 20.25, x: 300,  y: 8,   zoom: 1.26, cut: true },
    { t: 26.9,  x: 308,  y: 6,   zoom: 1.28, ease: 'inOutQuad' },
    /* 5 — ejderha geçişi: göğe hafif aç (eski y:-72 aşırıydı) */
    { t: 27.0,  x: 40,   y: -36, zoom: 1.08, cut: true },
    { t: 32,    x: 56,   y: -44, zoom: 1.10, ease: 'linear' }
  ],

  /* ---------------- Aktörler ---------------- */
  actors: {
    /* Uzakta bekleyen figür — idle'da x sabiti (kayma yok) */
    companion: {
      keys: [
        { t: 0,    x: 1048, y: GROUND, scale: 1.95, alpha: 1, facing: -1, anim: 'idle' },
        { t: 22.6, x: 1048, y: GROUND, scale: 1.95, alpha: 1, facing: -1, anim: 'idle' },
        { t: 24.0, x: 1048, y: GROUND, scale: 1.95, alpha: 1, facing: -1, anim: 'offerHand', ease: 'outQuad' },
        /* Ejderha geçerken ikisi de başını kaldırır. Tepki vermeyen
           karakterler sahneyi "arka planda bir şey oldu"ya indirgiyordu. */
        { t: 27.6, x: 1048, y: GROUND, scale: 1.95, alpha: 1, facing: -1, anim: 'lookUp' },
        { t: 30.4, x: 1048, y: GROUND, scale: 1.95, alpha: 1, facing: -1, anim: 'offerHand' },
        { t: 32,   x: 1048, y: GROUND, scale: 1.95, alpha: 1, facing: -1, anim: 'offerHand' }
      ]
    },
    /* Kahraman — yürüyüş / duruş / jest ayrı segment; idle'da x kayması yok */
    hero: {
      keys: [
        /* YÜRÜME HIZI: 210 px boyundaki bir figür saniyede 60 px giderse
           yürümüyor, süzülüyor gibi görünür. Adım temposu artık mesafeye
           bağlı olduğu için hız da inandırıcı olmalı: ~120 px/sn. Aradaki
           duraklamalar hikâyeyi taşıyor, sürekli ağır çekim değil. */
        { t: 0,    x: -170, y: GROUND, scale: 1.95, alpha: 1, facing: 1, anim: 'walk' },
        { t: 7.5,  x: 560,  y: GROUND, scale: 1.95, alpha: 1, facing: 1, anim: 'idle',  ease: 'outQuad' },
        { t: 14.5, x: 560,  y: GROUND, scale: 1.95, alpha: 1, facing: 1, anim: 'walk' },
        { t: 17.6, x: 860,  y: GROUND, scale: 1.95, alpha: 1, facing: 1, anim: 'idle',  ease: 'inOutQuad' },
        { t: 21.0, x: 860,  y: GROUND, scale: 1.95, alpha: 1, facing: 1, anim: 'idle' },
        { t: 22.8, x: 860,  y: GROUND, scale: 1.95, alpha: 1, facing: 1, anim: 'offerHand', ease: 'outQuad' },
        { t: 27.9, x: 860,  y: GROUND, scale: 1.95, alpha: 1, facing: 1, anim: 'lookUp' },
        { t: 30.4, x: 860,  y: GROUND, scale: 1.95, alpha: 1, facing: 1, anim: 'offerHand' },
        { t: 32,   x: 860,  y: GROUND, scale: 1.95, alpha: 1, facing: 1, anim: 'offerHand' }
      ]
    }
  },

  /* ---------------- Metin kartları ---------------- */
  cards: [
    { t: 1.8,  dur: 4.6, text: S.intro.c1, pos: 'bottom', style: 'whisper', typeDur: 0.72 },
    { t: 6.8,  dur: 5.0, text: S.intro.c2, pos: 'bottom', style: 'whisper', typeDur: 0.78 },
    { t: 12.4, dur: 4.4, text: S.intro.c3, pos: 'bottom', style: 'normal', typeDur: 0.85 },
    { t: 20.6, dur: 3.4, text: S.intro.c4, speaker: '{hero}', pos: 'center', style: 'hero', typeDur: 0.48 },
    { t: 23.2, dur: 4.4, text: S.intro.c5, speaker: '{hero}', pos: 'bottom', style: 'normal', typeDur: 0.82 },
    { t: 28.0, dur: 3.0, text: S.intro.c6, speaker: '{hero}', pos: 'bottom', style: 'hero', typeDur: 0.55 }
  ],

  /* ---------------- Kararmalar ---------------- */
  fades: [
    { t: 0,    dur: 2.2, from: 1, to: 0, ease: 'outQuad' },
    { t: 30.6, dur: 1.4, from: 0, to: 1, ease: 'inQuad' }
  ],

  /* ---------------- Sarsıntı: ejderha geçerken ---------------- */
  /* Sarsıntı ejderhanın EN YAKIN olduğu ana (t≈29.0) denk gelmeli;
     28.0'da tetiklenince daha ejderha yaklaşmadan sallanıyordu. */
  shakes: [
    { t: 28.75, dur: 1.5, power: 7 }
  ],

  /* ---------------- Ses işaretleri ---------------- */
  cues: [
    { t: 0.2,  sfx: 'windSwell' },
    { t: 6.1,  sfx: 'cineFootstep' },
    { t: 8.0,  sfx: 'cineFootstep' },
    { t: 10.0, sfx: 'cineFootstep' },
    { t: 12.2, sfx: 'stopStep' },
    { t: 20.4, sfx: 'nameChime' },
    { t: 22.9, sfx: 'clothRustle' },
    { t: 24.0, sfx: 'handChime' },
    { t: 27.3, sfx: 'dragonRoarFar' },   /* uzaktan belirirken */
    { t: 28.8, sfx: 'wingWhoosh' }       /* tam tepeden geçerken */
  ]
};

export default introScene;
