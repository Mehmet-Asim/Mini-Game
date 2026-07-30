/* ==========================================================================
   Katman Sistemi — prosedürel ve görsel katmanlar aynı arayüzden

   BU DOSYANIN TEK AMACI ŞU:
   Bugün her katman kodla çiziliyor. Yarın Mehmet yağlı boya görseller
   ürettiğinde, o katmanın tanımında tek satır değişecek:

       { id:'meadow', z:2, parallax:0.35, kind:'proc',  draw: drawMeadow }
       { id:'meadow', z:2, parallax:0.35, kind:'image', src:'cine/meadow.webp' }

   Timeline, kamera, kartlar, sesler — hiçbiri değişmez.
   İkisini karıştırmak da serbest: yağlı boya arka plan + üstünde kodla
   çizilen dalgalanan otlar en iyi sonucu verir.

   Katman alanları:
     id        benzersiz ad
     z         çizim sırası (küçük → arkada)
     parallax  0=sabit gökyüzü, 1=ön plan
     kind      'proc' | 'image'
     draw      (ctx, api) => void          [proc]
     src       'cine/xxx.webp'             [image]  public/ altına göre
     fit       'cover' | 'contain' | 'tile' | 'none'
     rect      { x, y, w, h }              [image, fit:'none']
     opacity   sayı veya (api) => sayı
     offsetX/Y sayı veya (api) => sayı
     scale     sayı veya (api) => sayı
     blend     'lighter' | 'screen' | 'multiply' | 'overlay' ...
     clip      true ise kadraj dışına taşmaz
     when      (api) => bool — katmanı koşullu çizer
   ========================================================================== */

import { VW, VH } from './stage.js';

/* ---------- Görsel önbelleği ---------- */

const _images = new Map();

/* Görsel kökü.
   Vite derleme sırasında `import.meta.env`'i sabitle değiştirir; Node
   araçlarında (kare alma, sahne denetimi) ise tanımsızdır. Doğrudan
   `import.meta.env.BASE_URL` okumak araçları patlatıyordu. */
const ASSET_BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';

/** Node tabanlı shot/perf araçları önceden yükledikleri görselleri buraya kaydeder. */
export function registerImage(src, img) {
  _images.set(src, { img, ready: true, failed: false });
}

export function loadImage(src) {
  if (_images.has(src)) return _images.get(src);
  if (typeof Image === 'undefined') {
    const rec = { img: null, ready: false, failed: true };
    _images.set(src, rec);
    return rec;
  }
  const img = new Image();
  const rec = { img, ready: false, failed: false };
  img.onload = () => { rec.ready = true; };
  img.onerror = () => { rec.failed = true; console.warn('[cinematic] görsel yüklenemedi:', src); };
  img.src = ASSET_BASE + src.replace(/^\//, '');
  _images.set(src, rec);
  return rec;
}

/** Sahnenin tüm görsellerini önceden yükle — ilk karede pop olmasın */
export function preloadScene(scene) {
  const srcs = (scene.layers || []).filter(l => l.kind === 'image' && l.src).map(l => l.src);
  if (srcs.length === 0) return Promise.resolve();
  return Promise.all(srcs.map(src => new Promise(res => {
    const rec = loadImage(src);
    if (rec.ready || rec.failed) return res();
    rec.img.addEventListener('load', res, { once: true });
    rec.img.addEventListener('error', res, { once: true });
  })));
}

/* ---------- Değer çözümleyici: sayı ya da fonksiyon ---------- */

function val(v, api, fallback) {
  if (v === undefined || v === null) return fallback;
  return typeof v === 'function' ? v(api) : v;
}

/* ---------- Görsel katman çizimi ---------- */

function drawImageLayer(ctx, layer, api) {
  const rec = loadImage(layer.src);
  if (!rec.ready) {
    /* Görsel henüz gelmediyse yedek prosedürel çizim varsa onu kullan —
       böylece yağlı boyaya geçiş sırasında sahne asla boş kalmaz */
    if (layer.fallback) layer.fallback(ctx, api);
    return;
  }
  const img = rec.img;
  const fit = layer.fit || 'cover';
  ctx.imageSmoothingEnabled = layer.smoothing === true;

  if (fit === 'none' && layer.rect) {
    const r = layer.rect;
    ctx.drawImage(img, r.x, r.y, r.w ?? img.width, r.h ?? img.height);
    return;
  }

  if (fit === 'tile') {
    /* Yatayda sonsuz tekrar — uçsuz bucaksız ot tarlası için */
    const h = layer.tileH ?? VH;
    const w = img.width * (h / img.height);
    const y = layer.tileY ?? 0;
    const span = layer.tileSpan ?? VW * 3;
    const start = -span;
    for (let x = start; x < span; x += w) ctx.drawImage(img, x, y, w, h);
    return;
  }

  const ir = img.width / img.height;
  const fr = VW / VH;
  let dw, dh;
  if ((fit === 'cover') === (ir > fr)) { dh = VH; dw = VH * ir; }
  else { dw = VW; dh = VW / ir; }
  ctx.drawImage(img, (VW - dw) / 2, (VH - dh) / 2, dw, dh);
}

/* ---------- Kompozisyon ---------- */

/**
 * Sahnenin tüm katmanlarını z sırasına göre çiz.
 * state: Director.evaluate() çıktısı
 */
export function composite(stage, scene, state) {
  const layers = (scene.layers || []).slice().sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  const api = {
    t: state.t,
    cam: state.cam,
    actors: state.actors,
    config: state.config,
    state,
    VW, VH
  };

  for (const layer of layers) {
    if (layer.when && !layer.when(api)) continue;

    const opacity = val(layer.opacity, api, 1);
    if (opacity <= 0.001) continue;

    const ctx = stage.pushLayer(state.cam, layer.parallax ?? 1, {
      opacity,
      offsetX: val(layer.offsetX, api, 0),
      offsetY: val(layer.offsetY, api, 0),
      scale: val(layer.scale, api, 1),
      blend: layer.blend
    });

    if (layer.clip) stage.clipFrame(ctx);

    try {
      if (layer.kind === 'image') drawImageLayer(ctx, layer, api);
      else if (layer.draw) layer.draw(ctx, api);
    } catch (err) {
      console.error(`[cinematic] katman çizim hatası: ${layer.id}`, err);
    }

    stage.popLayer();
  }
}

/* ---------- Kısayol fabrikaları ---------- */

/** Prosedürel katman */
export const proc = (id, z, parallax, draw, extra = {}) =>
  ({ id, z, parallax, kind: 'proc', draw, ...extra });

/** Görsel katman — yağlı boyaya geçerken proc() yerine bunu yaz */
export const image = (id, z, parallax, src, extra = {}) =>
  ({ id, z, parallax, kind: 'image', src, fit: 'cover', ...extra });

/**
 * Melez: görsel varsa onu, yoksa prosedürel çizimi kullanır.
 * Geçiş dönemi için ideal — dosyayı public/cine/ içine atınca kendiliğinden devreye girer.
 */
export const hybrid = (id, z, parallax, src, fallbackDraw, extra = {}) =>
  ({ id, z, parallax, kind: 'image', src, fit: 'cover', fallback: fallbackDraw, ...extra });
