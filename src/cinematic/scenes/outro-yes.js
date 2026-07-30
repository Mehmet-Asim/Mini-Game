/* ==========================================================================
   FİNAL SAHNESİ — "Kabul"

   Kadraj: yendikleri ejderhanın yanında, sırtları bize dönük, yan yana
   oturmuş iki figür. Güneş sahne boyunca gerçekten batıyor — 20 saniyede
   ufka değiyor. Kamera yavaşça geri çekilip ikisini manzaranın içinde
   küçültüyor: hikâye onlardan büyük.
   ========================================================================== */

import { VW, VH } from '../stage.js';
import { getPalette } from '../art/palette.js';
import { drawSky, drawSun, drawClouds, drawHaze, drawStars, drawBirds } from '../art/sky.js';
import { drawHillBand, drawRidgeTrees, drawMountains } from '../art/hills.js';
import { drawMeadowGround, drawGrassTufts, drawForegroundGrass, drawWildflowers } from '../art/grass.js';
import { drawHero, drawCompanion, drawBond } from '../art/figures.js';
import { drawDragon, drawCarcassSmoke } from '../art/dragon.js';
import { drawPixelActor, drawPixelDragon } from '../art/pixelSprites.js';
import {
  drawMotes, drawGroundMist, drawLightShafts, drawLensFlare, drawAscendingSparks
} from '../art/fx.js';
import { hybrid, proc } from '../layers.js';
import { clamp01, lerp, ease } from '../easing.js';
import { S } from '../script.js';

const P = getPalette('sunsetVow');
const HORIZON = VH * 0.62;
const GROUND = 596;

/* Güneş sahne boyunca batar — tek sayı, tüm ışıklandırmayı sürükler */
function sunPos(t) {
  const f = ease('inOutQuad', clamp01(t / 19));
  return {
    /* yes-bg.webp içindeki güneşin gerçek başlangıç koordinatı */
    x: VW * 0.895,
    y: lerp(VH * 0.445, VH * 0.458, f),
    glow: lerp(0.72, 0.42, f)
  };
}

export const outroYesScene = {
  id: 'outro-yes',
  duration: 21,
  next: 'end-yes',
  clear: '#120a18',

  layers: [
    hybrid('pixelBackdrop', 0, 0.04, 'cine/yes-bg.webp', (ctx, { t, cam }) => {
      const s = sunPos(t);
      drawSky(ctx, P, t, { horizon: HORIZON });
      drawStars(ctx, t, { count: 80, alpha: clamp01((t - 9) / 9) * 0.7, seed: 19 });
      drawSun(ctx, P, t, { x: s.x, y: s.y, r: 58, glow: s.glow });
      drawClouds(ctx, P, t, { count: 9, y: VH * 0.22, alpha: 0.6, drift: 5, seed: 44 });
      drawMountains(ctx, P, { baseY: HORIZON + 6, height: 145, alpha: 0.5, seed: 5 });
      drawHillBand(ctx, { color: P.hillMid, baseY: HORIZON + 30, amp: 54, freq: 0.0017, seed: 3.3, t });
      drawRidgeTrees(ctx, { color: P.hillMid, baseY: HORIZON + 30, amp: 54, freq: 0.0017, seed: 3.3, count: 28, size: 14, alpha: 0.65 });
      drawHaze(ctx, P, { horizon: HORIZON + 40, height: 220, strength: 0.58 });
      drawHillBand(ctx, { color: P.hillNear, baseY: HORIZON + 66, amp: 42, freq: 0.0027, seed: 7.7, t });
      drawMeadowGround(ctx, P, t, { horizon: HORIZON + 36, wind: 0.7 });
      drawGrassTufts(ctx, P, t, { horizon: HORIZON + 44, count: 560, seed: 16, wind: 0.75, bottom: VH + 160, viewX: cam.x * 0.70 });
      drawWildflowers(ctx, P, t, { horizon: HORIZON + 50, count: 90, seed: 61, alpha: 0.65 });
    }, { smoothing: false }),

    /* Statik master görselin üstünde gerçek zamanlı gün batımı:
       sıcaklık azalır, yıldızlar belirir ve yeni güneş ufka iner. */
    proc('sunsetGrade', 1, 0.03, (ctx, { t }) => {
      const f = ease('inOutQuad', clamp01(t / 19));
      const grade = ctx.createLinearGradient(0, 0, 0, VH);
      grade.addColorStop(0, `rgba(30, 18, 78, ${f * 0.34})`);
      grade.addColorStop(0.58, `rgba(82, 28, 66, ${f * 0.18})`);
      grade.addColorStop(1, `rgba(8, 12, 30, ${f * 0.30})`);
      ctx.fillStyle = grade;
      ctx.fillRect(-120, -80, VW + 240, VH + 160);
      const horizonHaze = ctx.createLinearGradient(0, VH * 0.40, 0, VH * 0.66);
      horizonHaze.addColorStop(0, 'rgba(54, 30, 76, 0)');
      horizonHaze.addColorStop(0.58, `rgba(54, 30, 76, ${f * 0.20})`);
      horizonHaze.addColorStop(1, 'rgba(22, 18, 48, 0)');
      ctx.fillStyle = horizonHaze;
      ctx.fillRect(0, VH * 0.38, VW, VH * 0.32);
      drawStars(ctx, t, { count: 96, alpha: clamp01((t - 7) / 10) * 0.72, seed: 19 });
    }, { blend: 'source-over' }),

    /* Uzakta, artık sadece bir manzara unsuru olan ejderha */
    proc('dragon', 5, 0.42, (ctx, { t }) => {
      const dragonOpts = {
        x: 210, y: HORIZON + 118, scale: 0.62, facing: -1,
        rise: 0, eye: 0, maw: 0,
        far: true,
        skin: '#191020', skinLo: '#0e0812', membrane: '#22131f',
        rimStrength: 0.75, alpha: 0.95
      };
      drawPixelDragon(ctx, dragonOpts, () => drawDragon(ctx, P, t, dragonOpts));
      drawCarcassSmoke(ctx, P, t, { x: 210, y: HORIZON + 80, scale: 0.6, alpha: 0.55, count: 4, seed: 9 });
    }),

    proc('mist', 7, 0.6, (ctx, { t }) => {
      drawGroundMist(ctx, P, t, { y: HORIZON + 44, alpha: 0.28, count: 4 });
    }),

    /* İki figür, sırtları dönük, batan güneşe bakıyor */
    proc('actors', 10, 1.0, (ctx, { t, actors }) => {
      const { hero, companion } = actors;
      drawPixelActor(ctx, 'companion', companion, t, () =>
        drawCompanion(ctx, companion, P, t, { robe: '#2b2233', hair: '#1c1016', rimStrength: 0.66, lightDir: 1 }));
      drawPixelActor(ctx, 'hero', hero, t, () =>
        drawHero(ctx, hero, P, t, { cape: '#5e1626', body: '#141019', rimStrength: 0.66, lightDir: 1, sword: false }));
      drawBond(ctx, P, hero, companion, t, { strength: 1.6 });
    }),

    proc('sparks', 11, 0.95, (ctx, { t }) => {
      drawAscendingSparks(ctx, P, t, {
        x: 600, y: GROUND + 10, spread: 620, count: 26,
        alpha: clamp01((t - 8) / 4) * 0.55, seed: 23
      });
    }),

    proc('shafts', 12, 0.28, (ctx, { t }) => {
      const s = sunPos(t);
      drawLightShafts(ctx, P, t, { x: s.x, y: s.y, alpha: 0.20, count: 8, spread: 0.6 });
    }, { blend: 'lighter' }),

    proc('motes', 13, 1.05, (ctx, { t }) => {
      drawMotes(ctx, P, t, { count: 80, alpha: 0.8, rise: 12, seed: 27 });
    }),

    proc('birds', 14, 0.35, (ctx, { t }) => {
      drawBirds(ctx, t - 3, {
        x: VW * 1.25, y: VH * 0.24, count: 11, speed: 34,
        alpha: clamp01((t - 3) / 2.5) * clamp01((17 - t) / 3) * 0.5,
        color: '30, 16, 24', seed: 51
      });
    }),

    proc('fgGrass', 15, 1.30, (ctx, { t }) => {
      drawForegroundGrass(ctx, P, t, { count: 88, baseY: VH + 94, wind: 0.85, seed: 88 });
    }),

    proc('flare', 16, 0.04, (ctx, { t }) => {
      const s = sunPos(t);
      drawLensFlare(ctx, P, t, { x: s.x, y: s.y, alpha: 0.5 });
    })
  ],

  /* Yakın plandan geniş plana — hikâye onlardan büyür */
  camera: [
    { t: 0,    x: -20, y: 16, zoom: 1.32 },
    { t: 5.8,  x: -12, y: 12, zoom: 1.24, ease: 'inOutCubic' },
    /* Birlikte kurdukları dünyayı göstermek için geniş plana çık */
    { t: 5.85, x: 110, y: 4,  zoom: 1.10, cut: true },
    { t: 10.9, x: 96,  y: 2,  zoom: 1.06, ease: 'inOutCubic' },
    /* İsim/vurgu anında kısa, sıcak bir yakın plan */
    { t: 10.95, x: -10, y: 14, zoom: 1.36, cut: true },
    { t: 13.1,  x: -6,  y: 12, zoom: 1.32, ease: 'outQuad' },
    /* Finalde çift manzaranın içinde küçülür */
    { t: 13.15, x: 118, y: 2,  zoom: 1.06, cut: true },
    { t: 21,    x: 88,  y: 0,  zoom: 0.98, ease: 'inOutQuad' }
  ],

  actors: {
    companion: {
      keys: [
        { t: 0,  x: 566, y: GROUND, scale: 1.88, alpha: 1, facing: 1, anim: 'sit' },
        { t: 21, x: 566, y: GROUND, scale: 1.88, alpha: 1, facing: 1, anim: 'sit' }
      ]
    },
    hero: {
      keys: [
        { t: 0,  x: 620, y: GROUND, scale: 1.88, alpha: 1, facing: 1, anim: 'sit' },
        { t: 21, x: 620, y: GROUND, scale: 1.88, alpha: 1, facing: 1, anim: 'sit' }
      ]
    }
  },

  cards: [
    { t: 1.6,  dur: 4.4, text: S.yes.c1, pos: 'bottom', style: 'whisper' },
    { t: 6.2,  dur: 4.4, text: S.yes.c2, pos: 'bottom', style: 'whisper' },
    { t: 11.4, dur: 4.2, text: S.yes.c3, pos: 'center', style: 'hero', typeDur: 1.1 },
    { t: 16.2, dur: 3.8, text: S.yes.c4, pos: 'bottom', style: 'normal' }
  ],

  fades: [
    { t: 0,    dur: 2.0, from: 1, to: 0, ease: 'outQuad' },
    { t: 19.6, dur: 1.4, from: 0, to: 1, ease: 'inQuad' }
  ],

  flashes: [
    { t: 11.2, dur: 1.6, color: '255, 226, 180', power: 0.22 }
  ],

  cues: [
    { t: 0.2,  sfx: 'sunsetTheme' },
    { t: 5.9,  sfx: 'windSwell' },
    { t: 10.9, sfx: 'heartbeat' },
    { t: 11.2, sfx: 'nameChime' },
    { t: 13.2, sfx: 'handChime' },
    { t: 16.0, sfx: 'closeTheme' }
  ]
};

export default outroYesScene;
