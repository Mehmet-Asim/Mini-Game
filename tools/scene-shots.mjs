/* ==========================================================================
   Sahne Kareleri — sahneleri PNG olarak diske basar

       npm i -D @napi-rs/canvas
       npm run shots            → tools/shots/ klasörüne yazar

   Neden var: sinematik sanatı gözle görmeden ayarlanamıyor. Tarayıcıyı açıp
   30 saniye beklemek yerine kritik anların karesini alıp yan yana bakmak
   çok daha hızlı. Geliştirme sırasında bu döngü defalarca kullanıldı.

   İstediğin anı eklemek için aşağıdaki SHOTS tablosunu düzenle.
   ========================================================================== */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Director } from '../src/cinematic/director.js';
import { Stage, VW, VH } from '../src/cinematic/stage.js';
import { composite, registerImage } from '../src/cinematic/layers.js';
import { PIXEL_SPRITE_SOURCES } from '../src/cinematic/art/pixelSprites.js';
import { SCENES } from '../src/cinematic/scenes/index.js';

let createCanvas, loadCanvasImage;
try {
  ({ createCanvas, loadImage: loadCanvasImage } = await import('@napi-rs/canvas'));
} catch {
  console.error('\n@napi-rs/canvas kurulu değil. Önce:\n\n    npm i -D @napi-rs/canvas\n');
  process.exit(1);
}

/* Stage tarayıcı ortamı bekliyor; tek ihtiyacı devicePixelRatio */
globalThis.window = globalThis.window || { devicePixelRatio: 1 };

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(OUT, { recursive: true });

const config = {
  heroName: process.env.HERO || 'Mehmet',
  targetName: process.env.TARGET || 'Yolcu',
  proposalText: 'Benimle çıkar mısın?',
  unlockedMemories: ['İlk gülüşümüz', 'Birlikte aştığımız yollar', 'Bugüne saklanan cümle']
};

const imageSources = new Set([
  ...Object.values(SCENES).flatMap(scene =>
    (scene.layers || []).filter(layer => layer.kind === 'image' && layer.src).map(layer => layer.src)),
  ...PIXEL_SPRITE_SOURCES
]);
for (const src of imageSources) {
  registerImage(src, await loadCanvasImage(join(ROOT, 'public', ...src.split('/'))));
}

/* Her sahnenin anlatı olarak önemli anları */
const SHOTS = {
  'intro':     [3, 10, 16, 21.5, 24, 28.5, 31],
  'outro-ask': [2, 7, 10.5, 13.4],
  'outro-yes': [3, 9, 14, 19],
  'outro-no':  [1, 3.5, 6, 7.6]
};

for (const [id, times] of Object.entries(SHOTS)) {
  const scene = SCENES[id];
  if (!scene) { console.warn('sahne yok:', id); continue; }
  const director = new Director(scene, { config });

  for (const t of times) {
    const canvas = createCanvas(VW, VH);
    canvas.style = {};                 // Stage.resize style'a yazıyor
    const stage = new Stage(canvas);
    /* resize() yerine elle kur: DPR 1, birebir sanal çözünürlük */
    stage.dpr = 1; stage.w = VW; stage.h = VH;
    stage.scale = 1; stage.originX = 0; stage.originY = 0;

    const state = director.evaluate(t);
    stage.begin(scene.clear || '#05070d');
    composite(stage, scene, state);
    stage.vignette(scene.vignette ?? 0.6);
    if (scene.tint) stage.tint(scene.tint);
    if (scene.grain !== false) stage.grain(state.t, 0.018);
    stage.letterbox(scene.letterbox === false ? 0 : 1);
    if (state.flash > 0.001) stage.fade(state.flash, state.flashColor);
    if (state.fadeAlpha > 0.001) stage.fade(state.fadeAlpha, state.fadeColor);

    const file = join(OUT, `${id}_${String(t).replace('.', '-')}s.png`);
    writeFileSync(file, canvas.toBuffer('image/png'));
    console.log('yazıldı:', file);
  }
}

console.log(`\nNot: metin kartları ve seçim ekranı DOM'da çizilir, bu karelerde görünmez.\n`);
