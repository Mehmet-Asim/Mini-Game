/* ==========================================================================
   FİNAL SAHNESİ — "Soru"

   Kadraj: alacakaranlık. Devrilmiş ejderha ön planda, hâlâ tütüyor. İki figür
   leşin yanında duruyor. Kamera yavaşça yaklaşıyor. Kahraman diz çöküyor.

   Sonra sahne DURUYOR ve karar karşı tarafa geçiyor.
   Seçim yapılana kadar zaman akmaz — Director.awaitingChoice.
   ========================================================================== */

import { VW, VH } from '../stage.js';
import { getPalette } from '../art/palette.js';
import { drawSky, drawSun, drawClouds, drawHaze, drawStars } from '../art/sky.js';
import { drawHillBand, drawRidgeTrees, drawMountains } from '../art/hills.js';
import { drawMeadowGround, drawGrassTufts, drawForegroundGrass } from '../art/grass.js';
import { drawHero, drawCompanion, drawBond } from '../art/figures.js';
import { drawDragon, drawCarcassSmoke, drawBattleDebris } from '../art/dragon.js';
import { drawPixelActor, drawPixelDragon } from '../art/pixelSprites.js';
import { drawMotes, drawGroundMist, drawLightShafts } from '../art/fx.js';
import { hybrid, proc } from '../layers.js';
import { S } from '../script.js';

const P = getPalette('duskAsk');
const HORIZON = VH * 0.60;
const GROUND = 596;
const SUN = { x: VW * 0.20, y: VH * 0.52 };   // batmak üzere, solda

function drawMemoryLights(ctx, t, memories = []) {
  const count = Math.min(3, memories.length);
  for (let i = 0; i < count; i++) {
    const pulse = 0.68 + Math.sin(t * 2.2 + i * 1.7) * 0.25;
    const x = 720 + i * 74;
    const y = 500 - i * 28 + Math.sin(t * 1.1 + i) * 8;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pulse;
    ctx.fillStyle = i === 1 ? '#7fd8e8' : '#ffd08a';
    ctx.fillRect(x - 4, y - 6, 8, 12);
    ctx.fillRect(x - 7, y - 3, 14, 6);
    ctx.globalAlpha = pulse * 0.15;
    ctx.fillRect(x - 18, y - 18, 36, 36);
    ctx.restore();
  }
}

export const outroAskScene = {
  id: 'outro-ask',
  duration: 15.5,
  next: null,               // seçime göre view karar verir
  clear: '#0a0a16',

  layers: [
    hybrid('pixelBackdrop', 0, 0.05, 'cine/ask-bg.webp', (ctx, { t, cam }) => {
      drawSky(ctx, P, t, { horizon: HORIZON });
      drawStars(ctx, t, { count: 110, alpha: 0.75, seed: 12 });
      drawSun(ctx, P, t, { x: SUN.x, y: SUN.y, r: 40, glow: 0.85 });
      drawClouds(ctx, P, t, { count: 7, y: VH * 0.24, alpha: 0.5, drift: 4, seed: 31 });
      drawMountains(ctx, P, { baseY: HORIZON + 10, height: 160, alpha: 0.55, seed: 8 });
      drawHillBand(ctx, { color: P.hillMid, baseY: HORIZON + 34, amp: 56, freq: 0.0018, seed: 2.2, t });
      drawRidgeTrees(ctx, { color: P.hillMid, baseY: HORIZON + 34, amp: 56, freq: 0.0018, seed: 2.2, count: 24, size: 11, alpha: 0.45 });
      drawHaze(ctx, P, { horizon: HORIZON + 44, height: 200, strength: 0.46 });
      drawHillBand(ctx, { color: P.hillNear, baseY: HORIZON + 72, amp: 40, freq: 0.0028, seed: 6.4, t });
      drawMeadowGround(ctx, P, t, { horizon: HORIZON + 44, wind: 0.55 });
      drawGrassTufts(ctx, P, t, { horizon: HORIZON + 52, count: 520, seed: 14, wind: 0.6, bottom: VH + 150, viewX: cam.x * 0.72 });
    }, { smoothing: false }),

    proc('mist', 6, 0.62, (ctx, { t }) => {
      drawGroundMist(ctx, P, t, { y: HORIZON + 48, alpha: 0.30, count: 4 });
    }),

    /* Devrilmiş ejderha — rise/eye/maw hepsi 0. Ölü.
       "Ret" finalinde AYNI çizim fonksiyonu bu üç sayı 1'e giderken diriliyor. */
    /* Ejderha ters yönde yatıyor (facing -1): BAŞI sağda, çiftin hemen yanında.
       Gövde ve kuyruk sola uzanıp kadrajdan taşıyor — leşin büyüklüğü
       böyle hissediliyor. */
    proc('dragon', 8, 0.92, (ctx, { t }) => {
      const dragonOpts = {
        x: 330, y: GROUND + 4, scale: 1.7, facing: -1,
        rise: 0, eye: 0, maw: 0,
        skin: '#0f0d16', skinLo: '#08070d', membrane: '#1c1220',
        rimStrength: 0.5
      };
      drawPixelDragon(ctx, dragonOpts, () => drawDragon(ctx, P, t, dragonOpts));
      drawBattleDebris(ctx, P, { x: 640, y: GROUND + 18, scale: 0.85 });
    }),

    proc('smoke', 9, 0.9, (ctx, { t }) => {
      drawCarcassSmoke(ctx, P, t, { x: 260, y: GROUND - 120, scale: 1.5, alpha: 0.8, count: 6 });
    }),

    proc('memoryLights', 9.5, 0.96, (ctx, { t, config }) => {
      drawMemoryLights(ctx, t, config.unlockedMemories || []);
    }),

    proc('memoryGlow', 9.7, 0.96, (ctx, { t, config }) => {
      if (!(config.unlockedMemories || []).length) return;
      const pulse = 0.10 + Math.sin(t * 2.15) * 0.025;
      const glow = ctx.createRadialGradient(792, 496, 12, 792, 496, 220);
      glow.addColorStop(0, `rgba(255, 194, 112, ${pulse})`);
      glow.addColorStop(0.45, `rgba(92, 164, 188, ${pulse * 0.45})`);
      glow.addColorStop(1, 'rgba(50, 90, 120, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(540, 270, 510, 420);
    }, { blend: 'lighter' }),

    proc('actors', 10, 1.0, (ctx, { t, actors }) => {
      const { hero, companion } = actors;
      drawPixelActor(ctx, 'companion', companion, t, () =>
        drawCompanion(ctx, companion, P, t, { robe: '#1b3f4a', hair: '#2a1420', rimStrength: 0.62, lightDir: -1 }));
      drawPixelActor(ctx, 'hero', hero, t, () =>
        drawHero(ctx, hero, P, t, { cape: '#6e1729', body: '#131019', rimStrength: 0.62, lightDir: -1 }));
      drawBond(ctx, P, hero, companion, t, { strength: 1.3 });
    }),

    proc('shafts', 11, 0.30, (ctx, { t }) => {
      drawLightShafts(ctx, P, t, { x: SUN.x, y: SUN.y, alpha: 0.14, count: 6, spread: 0.5 });
    }, { blend: 'lighter' }),

    proc('motes', 12, 1.05, (ctx, { t }) => {
      drawMotes(ctx, P, t, { count: 70, alpha: 0.7, rise: 11, seed: 41 });
    }),

    proc('fgGrass', 13, 1.32, (ctx, { t }) => {
      drawForegroundGrass(ctx, P, t, { count: 78, baseY: VH + 92, wind: 0.7, seed: 77, alpha: 0.95 });
    })
  ],

  camera: [
    /* Savaş alanını ve bedeli kur */
    { t: 0,    x: 100, y: 0,  zoom: 1.00 },
    { t: 5.7,  x: 160, y: 4,  zoom: 1.05, ease: 'inOutCubic' },
    /* Duygusal konuşmada çiftin omuz planına yumuşak kes */
    { t: 5.75, x: 280, y: 10, zoom: 1.16, cut: true },
    { t: 8.5,  x: 290, y: 12, zoom: 1.20, ease: 'outQuad' },
    /* Diz çöküşü — alçak ama abartısız (eski 1.42 başları kesiyordu) */
    { t: 8.55, x: 286, y: 18, zoom: 1.28, cut: true },
    { t: 12.0, x: 294, y: 20, zoom: 1.30, ease: 'inOutCubic' },
    /* Seçim kartı: nefes alan dengeli ikili */
    { t: 12.05, x: 270, y: 10, zoom: 1.18, cut: true },
    { t: 15.5,  x: 276, y: 10, zoom: 1.20, ease: 'linear' }
  ],

  actors: {
    companion: {
      keys: [
        /* idle'da x sabiti — eski 1050→1046 kayması odun gibi görünüyordu */
        { t: 0,    x: 1048, y: GROUND, scale: 1.90, alpha: 1, facing: -1, anim: 'idle' },
        { t: 15.5, x: 1048, y: GROUND, scale: 1.90, alpha: 1, facing: -1, anim: 'idle' }
      ]
    },
    hero: {
      keys: [
        { t: 0,    x: 872, y: GROUND, scale: 1.90, alpha: 1, facing: 1, anim: 'idle' },
        /* Daha uzun yürüyüş + duruş, sonra diz */
        { t: 5.8,  x: 872, y: GROUND, scale: 1.90, alpha: 1, facing: 1, anim: 'walk' },
        { t: 8.4,  x: 924, y: GROUND, scale: 1.90, alpha: 1, facing: 1, anim: 'idle', ease: 'outQuad' },
        { t: 8.9,  x: 924, y: GROUND, scale: 1.90, alpha: 1, facing: 1, anim: 'kneel', ease: 'inOutQuad' },
        { t: 15.5, x: 924, y: GROUND, scale: 1.90, alpha: 1, facing: 1, anim: 'kneel' }
      ]
    }
  },

  cards: [
    { t: 1.2, dur: 4.2, text: S.ask.c1, pos: 'bottom', style: 'whisper', typeDur: 0.7 },
    { t: 5.6, dur: 4.0, text: S.ask.c2, pos: 'bottom', style: 'normal', typeDur: 0.78 },
    { t: 9.8, dur: 3.4, text: S.ask.c3, pos: 'bottom', style: 'whisper', typeDur: 0.65 }
  ],

  /* Soru ve seçim — buraya gelince sahne durur */
  choice: {
    t: 13.2,
    speaker: '{hero}',
    question: S.ask.question,
    options: [
      { id: 'yes', label: S.ask.optYes, hint: S.ask.hintYes, glyph: '❤' },
      { id: 'no',  label: S.ask.optNo,  hint: S.ask.hintNo,  glyph: '✖' }
    ]
  },

  fades: [
    { t: 0,    dur: 1.6, from: 1, to: 0, ease: 'outQuad' },
    { t: 14.4, dur: 1.1, from: 0, to: 1, ease: 'inQuad' }
  ],

  cues: [
    { t: 0.2,  sfx: 'duskAmbience' },
    { t: 5.8,  sfx: 'heartbeat' },
    { t: 8.7,  sfx: 'clothRustle' },
    { t: 8.9,  sfx: 'kneel' },
    { t: 12.4, sfx: 'heartbeat' },
    { t: 13.0, sfx: 'questionChime' }
  ]
};

export default outroAskScene;
