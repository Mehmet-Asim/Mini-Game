/* ==========================================================================
   FİNAL SAHNESİ — "Ret"

   Aynı ejderha, aynı çizim fonksiyonu. Tek fark: rise / eye / maw sayıları
   0'dan 1'e sürükleniyor. Leş dirilir, göz açılır, çene ayrılır ve kadraj
   ağzın içinde kararır.

   Ton önemli: korkutucu değil, ŞAKACI-EPİK. Bu bir ceza değil, bir espri.
   Sonunda "hikâyeyi geri sar" butonu geliyor.
   ========================================================================== */

import { VW, VH } from '../stage.js';
import { getPalette } from '../art/palette.js';
import { drawSky, drawStars, drawHaze } from '../art/sky.js';
import { drawHillBand, drawMountains } from '../art/hills.js';
import { drawMeadowGround, drawGrassTufts, drawForegroundGrass } from '../art/grass.js';
import { drawHero, drawCompanion } from '../art/figures.js';
import { drawDragon, drawCarcassSmoke } from '../art/dragon.js';
import { drawPixelActor, drawPixelDragon } from '../art/pixelSprites.js';
import { drawEmbers, drawGroundMist, drawMotes } from '../art/fx.js';
import { hybrid, proc } from '../layers.js';
import { clamp01, ease } from '../easing.js';
import { S } from '../script.js';

const P = getPalette('emberWake');
const HORIZON = VH * 0.60;
const GROUND = 596;

/* --------------------------------------------------------------------------
   Uyanış eğrileri — sahnenin tüm dramaturjisi bu üç fonksiyonda
   -------------------------------------------------------------------------- */

const eyeCurve  = t => ease('outCubic',  clamp01((t - 1.4) / 1.8));
const riseCurve = t => ease('inOutCubic', clamp01((t - 3.0) / 3.2));
const mawCurve  = t => {
  const open = ease('outQuad', clamp01((t - 5.2) / 1.6)) * 0.42;
  const lunge = ease('inQuart', clamp01((t - 7.0) / 1.1)) * 0.58;
  return Math.min(1, open + lunge);
};
/* Saldırı: ejderha kadraja doğru gelir */
const lungeCurve = t => ease('inQuart', clamp01((t - 7.1) / 1.2));

export const outroNoScene = {
  id: 'outro-no',
  duration: 14,
  next: 'end-no',
  clear: '#050407',

  layers: [
    hybrid('pixelBackdrop', 0, 0.05, 'cine/no-bg.webp', (ctx, { t, cam }) => {
      drawSky(ctx, P, t, { horizon: HORIZON });
      drawStars(ctx, t, { count: 130, alpha: 0.55 * (1 - eyeCurve(t) * 0.6), seed: 29 });
      drawMountains(ctx, P, { baseY: HORIZON + 10, height: 170, alpha: 0.8, seed: 8 });
      drawHillBand(ctx, { color: P.hillMid, baseY: HORIZON + 36, amp: 58, freq: 0.0018, seed: 2.2, t });
      drawHaze(ctx, P, { horizon: HORIZON + 46, height: 180, strength: 0.4 });
      drawMeadowGround(ctx, P, t, { horizon: HORIZON + 44, wind: 0.4 });
      drawGrassTufts(ctx, P, t, { horizon: HORIZON + 52, count: 460, seed: 14, wind: 0.5, bottom: VH + 150, viewX: cam.x * 0.72 });
    }, { smoothing: false }),

    proc('mist', 5, 0.62, (ctx, { t }) => {
      drawGroundMist(ctx, P, t, { y: HORIZON + 46, alpha: 0.34, count: 4 });
    }),

    /* Yerden yükselen kor — uyanış yaklaştıkça yoğunlaşır */
    proc('embersLow', 7, 0.85, (ctx, { t }) => {
      drawEmbers(ctx, P, t, {
        x: 520, y: GROUND + 10, spread: 620, count: 60,
        alpha: eyeCurve(t) * 0.9, rise: 70, seed: 17
      });
    }),

    /* Aktörler — ejderhanın ARKASINDA kalsınlar ki leş öne çıksın */
    proc('actors', 8, 1.0, (ctx, { t, actors }) => {
      const { hero, companion } = actors;
      drawPixelActor(ctx, 'companion', companion, t, () =>
        drawCompanion(ctx, companion, P, t, { robe: '#231a24', hair: '#1a0e13', rimStrength: 0.55, lightDir: -1 }));
      drawPixelActor(ctx, 'hero', hero, t, () =>
        drawHero(ctx, hero, P, t, { cape: '#4d1220', body: '#100d15', rimStrength: 0.55, lightDir: -1 }));
    }),

    /* DİRİLEN EJDERHA — outro-ask'takiyle aynı fonksiyon, farklı sayılar */
    proc('dragon', 9, 0.95, (ctx, { t }) => {
      const l = lungeCurve(t);
      const dragonOpts = {
        /* facing -1 → baş sağda, yani çiftin tarafında.
           Saldırıda x artınca baş doğrudan onların üstüne gelir. */
        x: 330 + l * 330,
        y: GROUND + 4 + l * 40,
        scale: 1.7 + l * 2.6,
        facing: -1,
        lunge: l,
        rise: riseCurve(t),
        eye: eyeCurve(t),
        maw: mawCurve(t),
        skin: '#0f0b12', skinLo: '#070509', membrane: '#1e0d13',
        rimStrength: 0.6 + l * 0.4
      };
      drawPixelDragon(ctx, dragonOpts, () => drawDragon(ctx, P, t, dragonOpts));
    }),

    proc('smoke', 10, 0.9, (ctx, { t }) => {
      drawCarcassSmoke(ctx, P, t, {
        x: 260, y: GROUND - 120, scale: 1.5,
        alpha: 0.9 * (1 - lungeCurve(t)), count: 6
      });
    }),

    /* Son karedeki smear pozunu çevresel hız çizgileriyle kadraja bağla. */
    proc('lungeLines', 10.5, 0, (ctx, { t }) => {
      const l = lungeCurve(t);
      if (l <= 0.08) return;
      const cx = VW * 0.55;
      const cy = VH * 0.50;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 104, 54, ${l * 0.34})`;
      ctx.lineWidth = 3 + l * 5;
      for (let i = 0; i < 32; i++) {
        const angle = (i / 32) * Math.PI * 2 + Math.sin(i * 8.13) * 0.09;
        const inner = 170 + (i % 5) * 24;
        const outer = inner + 80 + l * (160 + (i % 7) * 18);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner * 0.58);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer * 0.58);
        ctx.stroke();
      }
      ctx.restore();
    }, { blend: 'lighter' }),

    /* Saldırı anında kadrajı dolduran kor fırtınası */
    proc('embersBurst', 11, 1.1, (ctx, { t }) => {
      const l = lungeCurve(t);
      if (l <= 0.01) return;
      drawEmbers(ctx, P, t, {
        x: VW * 0.55, y: VH * 0.95, spread: VW * 1.3, count: 90,
        alpha: l, rise: 200, seed: 71
      });
    }),

    proc('motes', 12, 1.05, (ctx, { t }) => {
      drawMotes(ctx, P, t, { count: 50, alpha: 0.5, rise: 9, seed: 43, color: P.mote });
    }),

    proc('fgGrass', 13, 1.32, (ctx, { t }) => {
      /* Ejderha yaklaşırken ön plan otları rüzgârdan savrulur */
      const l = lungeCurve(t);
      drawForegroundGrass(ctx, P, t, {
        count: 78, baseY: VH + 92, wind: 0.6 + l * 3.4, seed: 77,
        alpha: 1 - l * 0.35
      });
    }),

    /* Kadrajı yutan karanlık — ağzın içi */
    proc('maw', 14, 0, (ctx, { t }) => {
      const l = lungeCurve(t);
      if (l <= 0.02) return;
      const r = (1 - ease('inQuad', l)) * VW * 0.95;
      ctx.save();
      const g = ctx.createRadialGradient(VW * 0.55, VH * 0.5, r * 0.25, VW * 0.55, VH * 0.5, r + 40);
      g.addColorStop(0, 'rgba(6, 2, 3, 0)');
      g.addColorStop(0.72, `rgba(20, 4, 4, ${0.55 * l})`);
      g.addColorStop(1, `rgba(4, 1, 2, ${Math.min(1, l * 1.25)})`);
      ctx.fillStyle = g;
      ctx.fillRect(-400, -400, VW + 800, VH + 800);
      ctx.restore();
    })
  ],

  camera: [
    { t: 0,    x: 160,  y: 0,   zoom: 1.04 },
    /* Gözün açılışı — boyut sabitlemesinden sonra daha ılımlı yakın plan */
    { t: 1.45, x: -160, y: -18, zoom: 1.36, cut: true },
    { t: 2.95, x: -148, y: -22, zoom: 1.40, ease: 'inOutQuad' },
    /* Baş yükselirken alçak orta plan */
    { t: 3.0,  x: -80,  y: -14, zoom: 1.26, cut: true },
    { t: 5.15, x: -40,  y: -20, zoom: 1.30, ease: 'inOutCubic' },
    /* Tepkileri ve ejderhayı aynı kadraja geri al */
    { t: 5.2,  x: 20,   y: -6,  zoom: 1.12, cut: true },
    { t: 7.15, x: 40,   y: -10, zoom: 1.20, ease: 'inOutCubic' },
    /* Saldırı push-in */
    { t: 7.2,  x: 56,   y: -14, zoom: 1.28, cut: true },
    { t: 8.4,  x: 260,  y: 8,   zoom: 1.78, ease: 'inQuart' },
    { t: 14,   x: 260,  y: 8,   zoom: 1.78, ease: 'linear' }
  ],

  actors: {
    companion: {
      keys: [
        { t: 0,   x: 1010, y: GROUND, scale: 1.90, alpha: 1, facing: -1, anim: 'idle' },
        { t: 3.2, x: 1010, y: GROUND, scale: 1.90, alpha: 1, facing: -1, anim: 'recoil', ease: 'outQuad' },
        /* Kısa geri adım — uzun kayma yok */
        { t: 5.0, x: 1010, y: GROUND, scale: 1.90, alpha: 1, facing: -1, anim: 'recoil' },
        { t: 6.8, x: 1068, y: GROUND, scale: 1.90, alpha: 1, facing: -1, anim: 'recoil', ease: 'outQuad' },
        { t: 8.6, x: 1100, y: GROUND, scale: 1.90, alpha: 0, facing: -1, anim: 'recoil', ease: 'inQuad' },
        { t: 14,  x: 1100, y: GROUND, scale: 1.90, alpha: 0, facing: -1, anim: 'recoil' }
      ]
    },
    hero: {
      keys: [
        { t: 0,   x: 928, y: GROUND, scale: 1.90, alpha: 1, facing: 1, anim: 'kneel' },
        { t: 2.6, x: 928, y: GROUND, scale: 1.90, alpha: 1, facing: 1, anim: 'idle', ease: 'outQuad' },
        { t: 4.0, x: 940, y: GROUND, scale: 1.90, alpha: 1, facing: 1, anim: 'recoil', ease: 'outQuad' },
        { t: 7.0, x: 980, y: GROUND, scale: 1.90, alpha: 1, facing: 1, anim: 'recoil', ease: 'outQuad' },
        { t: 8.5, x: 1000, y: GROUND, scale: 1.90, alpha: 0, facing: 1, anim: 'recoil', ease: 'inQuad' },
        { t: 14,  x: 1000, y: GROUND, scale: 1.90, alpha: 0, facing: 1, anim: 'recoil' }
      ]
    }
  },

  cards: [
    { t: 1.0,  dur: 3.4, text: S.no.c1, pos: 'bottom', style: 'whisper' },
    { t: 4.6,  dur: 2.8, text: S.no.c2, pos: 'bottom', style: 'normal' },
    { t: 9.5,  dur: 1.8, text: S.no.c3, pos: 'center', style: 'normal', typeDur: 1.0 },
    { t: 11.6, dur: 2.4, text: S.no.c4, pos: 'center', style: 'hero', typeDur: 1.0 }
  ],

  fades: [
    { t: 0,   dur: 1.4, from: 1, to: 0, ease: 'outQuad' },
    { t: 8.3, dur: 0.9, from: 0, to: 1, ease: 'inQuad' }
  ],

  flashes: [
    { t: 1.5, dur: 0.9, color: '255, 110, 50', power: 0.20 },
    { t: 7.4, dur: 0.7, color: '255, 90, 40',  power: 0.42 }
  ],

  shakes: [
    { t: 1.3, dur: 1.4, power: 5 },
    { t: 3.0, dur: 2.4, power: 9 },
    { t: 6.6, dur: 0.9, power: 14 },
    { t: 7.4, dur: 1.3, power: 26 }
  ],

  cues: [
    { t: 1.2, sfx: 'rumble' },
    { t: 1.5, sfx: 'heartbeat' },
    { t: 3.0, sfx: 'dragonWake' },
    { t: 5.2, sfx: 'clothRustle' },
    { t: 7.0, sfx: 'wingWhoosh' },
    { t: 7.2, sfx: 'dragonRoar' },
    { t: 8.3, sfx: 'chomp' }
  ]
};

export default outroNoScene;
