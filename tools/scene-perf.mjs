/* ==========================================================================
   Sahne Performansı — kare maliyeti ve en pahalı katman

       npm i -D @napi-rs/canvas
       npm run perf

   Ölçüm yazılım rasterizer üzerinde yapılır; tarayıcıda GPU hızlandırmayla
   belirgin daha hızlı olur. MUTLAK sayılar tarayıcıyı temsil etmez ama
   KATMANLAR ARASI ORAN doğrudur — bütçe aşan katmanı bulmak için yeterli.

   Bütçe: 1280x720'de kare başına ~16 ms (60 fps). Bu ölçümde 12 ms altı
   rahat, 20 ms üstü mobilde takılma riski demektir.
   ========================================================================== */

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

globalThis.window = globalThis.window || { devicePixelRatio: 1 };
const config = {
  heroName: 'A',
  targetName: 'B',
  proposalText: 'x',
  unlockedMemories: ['a', 'b', 'c']
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const imageSources = new Set([
  ...Object.values(SCENES).flatMap(scene =>
    (scene.layers || []).filter(layer => layer.kind === 'image' && layer.src).map(layer => layer.src)),
  ...PIXEL_SPRITE_SOURCES
]);
for (const src of imageSources) {
  registerImage(src, await loadCanvasImage(join(ROOT, 'public', ...src.split('/'))));
}

function newStage() {
  const canvas = createCanvas(VW, VH);
  canvas.style = {};
  const stage = new Stage(canvas);
  stage.dpr = 1; stage.w = VW; stage.h = VH;
  stage.scale = 1; stage.originX = 0; stage.originY = 0;
  return stage;
}

const rows = [];
const details = [];

for (const [id, scene] of Object.entries(SCENES)) {
  const stage = newStage();
  const d = new Director(scene, { config });
  const N = 40;

  /* Isınma — ilk karelerde tohumlu diziler önbelleğe alınıyor */
  for (let i = 0; i < 5; i++) {
    const s = d.evaluate(scene.duration * 0.5);
    stage.begin(); composite(stage, scene, s);
  }

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    const s = d.evaluate((i / N) * scene.duration);
    stage.begin(scene.clear);
    composite(stage, scene, s);
    stage.vignette(0.6); stage.grain(s.t, 0.018); stage.letterbox(1);
  }
  const frameMs = Number(process.hrtime.bigint() - t0) / 1e6 / N;

  /* Katman katman kırılım */
  const s = d.evaluate(scene.duration * 0.5);
  const perLayer = [];
  for (const L of scene.layers) {
    const a = process.hrtime.bigint();
    for (let i = 0; i < 12; i++) { stage.begin(); composite(stage, { layers: [L] }, s); }
    perLayer.push({ id: L.id, ms: Number(process.hrtime.bigint() - a) / 1e6 / 12 });
  }
  perLayer.sort((x, y) => y.ms - x.ms);

  rows.push({
    sahne: id,
    kare_ms: +frameMs.toFixed(2),
    tahmini_fps: Math.round(1000 / frameMs),
    durum: frameMs < 12 ? 'rahat' : frameMs < 20 ? 'sınırda' : 'AĞIR'
  });
  details.push({ id, top: perLayer.slice(0, 3) });
}

console.log('\n=== KARE MALİYETİ ===');
console.table(rows);

console.log('=== EN PAHALI 3 KATMAN (sahne başına) ===');
for (const d of details) {
  console.log(`  ${d.id}: ` + d.top.map(l => `${l.id} ${l.ms.toFixed(2)}ms`).join('  ·  '));
}
console.log('\nYazılım rasterizer ölçümü — tarayıcıda daha hızlı olur.\n');
