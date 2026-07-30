/* ==========================================================================
   Ejderha uçuş karelerinin kalibrasyonu

       npm i -D @napi-rs/canvas
       node tools/measure-dragon.mjs

   Sprite'lar içeriğe göre sıkı kırpılmış ve her kare ejderhanın farklı bir
   kısmını kapsıyor. Kareleri ortak bir yüksekliğe normalize etmek bu yüzden
   işe yaramıyor — aynı ejderha bir karede 111 px, diğerinde 425 px geniş
   çıkıyor ve gökte şişip sönen bir leke gibi görünüyor.

   Bu araç her kareyi ölçüp KAFA ÇAPASI tablosunu üretir:
     · ejderha tüm karelerde SOLA bakıyor → kafa, opak alanın sol ucunda
     · kafa yüksekliği kareler arası sabit → ölçek referansı olarak ideal

   Çıktıyı src/cinematic/art/pixelSprites.js içindeki FLY_CAL tablosuna
   yapıştır. Sprite'lar değişirse bu aracı yeniden çalıştır.
   ========================================================================== */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let createCanvas, loadImage;
try {
  ({ createCanvas, loadImage } = await import('@napi-rs/canvas'));
} catch {
  console.error('\n@napi-rs/canvas kurulu değil:\n\n    npm i -D @napi-rs/canvas\n');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public', 'cine', 'sprites');

/* Çırpma döngüsünde kullanılan kareler (kanatları görünenler) */
const FILES = [
  'dragon-fly-up.png',
  'dragon-fly-high.png',
  'dragon-bank.png',
  'dragon-fly-down.png',
  'dragon-fly-descend.png'
];
const REFERENCE = 'dragon-bank.png';

const rows = [];
for (const f of FILES) {
  const img = await loadImage(join(DIR, f));
  const c = createCanvas(img.width, img.height);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, img.width, img.height).data;
  const alphaAt = (px, py) => d[(py * img.width + px) * 4 + 3];

  /* Opak sınırlayıcı kutu */
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let py = 0; py < img.height; py++) {
    for (let px = 0; px < img.width; px++) {
      if (alphaAt(px, py) > 24) {
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
    }
  }

  /* Kafa bandı: opak kutunun sol %16'sı */
  const headRight = x0 + Math.max(3, Math.round((x1 - x0 + 1) * 0.16));
  let hy0 = Infinity, hy1 = -1, sumY = 0, n = 0;
  for (let px = x0; px <= headRight; px++) {
    for (let py = y0; py <= y1; py++) {
      if (alphaAt(px, py) > 24) {
        if (py < hy0) hy0 = py; if (py > hy1) hy1 = py;
        sumY += py; n++;
      }
    }
  }
  rows.push({
    file: f, w: img.width, h: img.height,
    headH: hy1 - hy0 + 1,
    headCY: Math.round(n ? sumY / n : (hy0 + hy1) / 2)
  });
}

const ref = rows.find(r => r.file === REFERENCE).headH;

console.log('\n=== ÖLÇÜM ===');
console.table(rows.map(r => ({
  kare: r.file, boyut: `${r.w}x${r.h}`,
  kafa_yüksekliği: r.headH, ölçek: +(ref / r.headH).toFixed(3), çapa_y: r.headCY
})));

console.log('--- pixelSprites.js içine ---\n');
console.log('const FLY_CAL = {');
for (const r of rows) {
  console.log(`  '${r.file}':${' '.repeat(Math.max(0, 26 - r.file.length))} { s: ${(ref / r.headH).toFixed(3)}, hy: ${r.headCY} },`);
}
console.log('};');
console.log(`\nconst FLY_REF_HEAD = ${ref};   // ${REFERENCE}\n`);
