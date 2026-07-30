/* ==========================================================================
   Sahne Denetimi — bağımlılıksız, saniyeler içinde çalışır

       npm run check:scenes

   Ne yapar: her sahneyi 20 Hz'de baştan sona sahte bir 2D context'e çizdirir
   ve sessizce bozulan şeyleri yakalar. Tarayıcı canvas'ı NaN koordinat veya
   bozuk renk stringi aldığında HATA VERMEZ, sadece çizmez — bu yüzden bu tür
   hatalar gözle fark edilene kadar aylarca durabilir. Denetim onları yakalar.

   Yakaladıkları:
     · NaN / Infinity koordinat, kalınlık, opaklık
     · "rgba(255, NaN, 0, 1)" gibi bozuk renk stringleri
     · gradyan durağının 0..1 dışına çıkması
     · çizim sırasında fırlayan istisnalar
     · doldurulmamış {hero} / {target} yer tutucuları
     · aynı konumda üst üste binen metin kartları
     · seek(t) determinizminin bozulması  ← co-op senkronu buna dayanıyor
     · seçim akışı: sahne duruyor mu, atlanabiliyor mu, cevap kayboluyor mu
   ========================================================================== */

import { Director } from '../src/cinematic/director.js';
import { SCENES } from '../src/cinematic/scenes/index.js';

const problems = [];
let calls = 0;
let CTX_SCENE = '', CTX_T = 0, CTX_LAYER = '';

const where = () => `${CTX_SCENE}@${CTX_T}s [${CTX_LAYER}]`;

function checkNums(name, args) {
  for (let i = 0; i < args.length; i++) {
    const v = args[i];
    if (typeof v === 'number' && !Number.isFinite(v)) {
      problems.push(`${where()} ${name}() arg#${i} = ${v}`);
    }
  }
}

function checkColor(name, v) {
  if (typeof v !== 'string') return;
  if (/NaN|undefined|null/.test(v)) problems.push(`${where()} ${name} = "${v}"`);
}

function makeGradient() {
  return {
    addColorStop(off, col) {
      if (!Number.isFinite(off) || off < 0 || off > 1) {
        problems.push(`${where()} addColorStop offset=${off}`);
      }
      checkColor('gradientStop', col);
    }
  };
}

const VOID_METHODS = ['save', 'restore', 'beginPath', 'closePath', 'fill', 'stroke', 'clip', 'setLineDash', 'resetTransform'];
const NUM_METHODS = [
  'translate', 'scale', 'rotate', 'setTransform', 'transform',
  'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo',
  'ellipse', 'rect', 'fillRect', 'strokeRect', 'clearRect', 'drawImage',
  'fillText', 'strokeText'
];

function makeCtx() {
  const ctx = {
    canvas: { width: 1280, height: 720 },
    createLinearGradient(...a) { checkNums('createLinearGradient', a); return makeGradient(); },
    createRadialGradient(...a) { checkNums('createRadialGradient', a); return makeGradient(); },
    createPattern() { return null; },
    measureText() { return { width: 10 }; },
    getImageData() { return { data: new Uint8ClampedArray(4) }; },
    putImageData() {}
  };
  for (const m of VOID_METHODS) ctx[m] = () => { calls++; };
  for (const m of NUM_METHODS) ctx[m] = (...a) => { calls++; checkNums(m, a); };

  for (const prop of ['fillStyle', 'strokeStyle', 'shadowColor', 'filter', 'font']) {
    let v = '';
    Object.defineProperty(ctx, prop, { get: () => v, set: (nv) => { checkColor(prop, nv); v = nv; } });
  }
  for (const prop of ['lineWidth', 'globalAlpha', 'shadowBlur', 'miterLimit', 'lineDashOffset']) {
    let v = 1;
    Object.defineProperty(ctx, prop, {
      get: () => v,
      set: (nv) => {
        if (typeof nv === 'number' && !Number.isFinite(nv)) problems.push(`${where()} ${prop} = ${nv}`);
        if (prop === 'globalAlpha' && typeof nv === 'number' && (nv < 0 || nv > 1)) {
          problems.push(`${where()} globalAlpha aralık dışı: ${nv}`);
        }
        v = nv;
      }
    });
  }
  for (const prop of ['globalCompositeOperation', 'lineCap', 'lineJoin', 'textAlign', 'textBaseline', 'imageSmoothingEnabled']) {
    ctx[prop] = '';
  }
  return ctx;
}

const config = { heroName: 'Mehmet', targetName: 'Yolcu', proposalText: 'Benimle çıkar mısın?' };
const STEP = 0.05;
const report = [];
let totalFrames = 0;

/* ---------- 1. Kare kare çizim taraması ---------- */

for (const [id, scene] of Object.entries(SCENES)) {
  CTX_SCENE = id;
  const director = new Director(scene, { config });
  const ctx = makeCtx();
  let cardShows = 0, maxCards = 0, choiceSeen = false;

  for (let t = 0; t <= scene.duration + 0.001; t += STEP) {
    CTX_T = t.toFixed(2);
    let state;
    try { state = director.evaluate(t); }
    catch (e) { problems.push(`${id}@${CTX_T}s evaluate() patladı: ${e.message}`); break; }

    if (!Number.isFinite(state.cam.x) || !Number.isFinite(state.cam.zoom)) {
      problems.push(`${id}@${CTX_T}s kamera NaN: x=${state.cam.x} zoom=${state.cam.zoom}`);
    }
    for (const [name, a] of Object.entries(state.actors)) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.scale)) {
        problems.push(`${id}@${CTX_T}s aktör ${name} NaN`);
      }
    }

    const byPos = {};
    for (const c of state.cards) {
      if (/\{hero\}|\{target\}|\{question\}/.test(c.text)) {
        problems.push(`${id}@${CTX_T}s kartta doldurulmamış yer tutucu: "${c.text}"`);
      }
      if (c.reveal < 0 || c.reveal > c.text.length) {
        problems.push(`${id}@${CTX_T}s reveal aralık dışı: ${c.reveal}/${c.text.length}`);
      }
      byPos[c.pos] = (byPos[c.pos] || 0) + 1;
      if (byPos[c.pos] > 1) problems.push(`${id}@${CTX_T}s "${c.pos}" konumunda ${byPos[c.pos]} kart üst üste`);
    }
    cardShows += state.cards.length;
    maxCards = Math.max(maxCards, state.cards.length);
    if (state.choice) choiceSeen = true;

    const api = { t, cam: state.cam, actors: state.actors, config, state, VW: 1280, VH: 720 };
    for (const layer of scene.layers) {
      CTX_LAYER = layer.id;
      try {
        if (layer.when && !layer.when(api)) continue;
        const op = typeof layer.opacity === 'function' ? layer.opacity(api) : (layer.opacity ?? 1);
        if (typeof op === 'number' && !Number.isFinite(op)) problems.push(`${where()} opacity = ${op}`);
        if (op <= 0.001) continue;
        if (layer.draw) layer.draw(ctx, api);
      } catch (e) {
        problems.push(`${where()} çizim patladı: ${e.message}`);
      }
    }
    totalFrames++;
  }

  report.push({
    sahne: id,
    saniye: scene.duration,
    katman: scene.layers.length,
    kart_gösterimi: cardShows,
    en_çok_eşzamanlı_kart: maxCards,
    seçim: choiceSeen ? 'var' : '—'
  });
}

/* ---------- 2. seek() determinizmi (co-op senkronunun temeli) ---------- */

for (const [id, scene] of Object.entries(SCENES)) {
  const a = new Director(scene, { config });
  const b = new Director(scene, { config });
  const target = Math.min(scene.duration, scene.choice ? scene.choice.t - 0.1 : scene.duration * 0.7);
  b.seek(target);
  const dt = 1 / 60;
  while (a.time < target - dt) a.update(dt);
  a.seek(target);
  if (JSON.stringify(a.evaluate().actors) !== JSON.stringify(b.evaluate().actors)) {
    problems.push(`${id}: seek() determinizmi bozuk — co-op senkronu çalışmaz`);
  }
}

/* ---------- 3. Seçim akışı ---------- */

{
  const scene = SCENES['outro-ask'];
  const dt = 1 / 60;
  let ended = null, chosen = null, guard = 0;

  const d = new Director(scene, {
    config,
    onChoice: (id) => { chosen = id; },
    onEnd: (info) => { ended = info; }
  });
  while (!d.awaitingChoice && guard++ < 5000) d.update(dt);
  if (!d.awaitingChoice) problems.push('outro-ask: seçim anına hiç gelinmedi');

  const frozen = d.time;
  for (let i = 0; i < 120; i++) d.update(dt);
  if (d.time !== frozen) problems.push('outro-ask: seçim beklerken zaman aktı');
  if (!d.evaluate().choice) problems.push('outro-ask: seçim kartları görünmüyor');

  d.submitChoice('yes');
  if (chosen !== 'yes') problems.push('outro-ask: onChoice tetiklenmedi');
  if (d.evaluate().choice) problems.push('outro-ask: seçim sonrası kartlar kalkmadı');

  guard = 0;
  while (!ended && guard++ < 5000) d.update(dt);
  if (!ended) problems.push('outro-ask: seçim sonrası sahne bitmedi');
  else if (ended.choice !== 'yes') problems.push(`outro-ask: bitişte seçim kayboldu (${ended.choice})`);

  /* Seçim ekranı açıkken atlanamaz */
  const d2 = new Director(scene, { config });
  guard = 0;
  while (!d2.awaitingChoice && guard++ < 5000) d2.update(dt);
  const before = d2.time;
  d2.skip();
  if (d2.ended || d2.time !== before) problems.push('outro-ask: seçim ekranı açıkken atlanabiliyor');

  /* KRİTİK: seçimden ÖNCE atlamak teklifi es geçmemeli, soruya götürmeli */
  const d3 = new Director(scene, { config });
  for (let i = 0; i < 60; i++) d3.update(dt);
  d3.skip();
  if (d3.ended) problems.push('outro-ask: Atla tuşu teklifi tamamen es geçiyor');
  if (!d3.awaitingChoice) problems.push('outro-ask: Atla sonrası seçim ekranı açılmadı');

  /* KRİTİK: syncTo/seek seçim anının üstüne ışınlanınca kapıyı kaçırmamalı */
  const dSeek = new Director(scene, { config });
  dSeek.seek(scene.choice.t + 2.5);
  if (!dSeek.awaitingChoice) problems.push('outro-ask: seek(choice.t+) seçim kapısını açmadı');
  if (dSeek.time !== scene.choice.t) problems.push('outro-ask: seek sonrası zaman seçimde kilitlenmedi');
  if (dSeek.ended) problems.push('outro-ask: seek seçimi atlayıp sahneyi bitirdi');

  const dSync = new Director(scene, { config });
  for (let i = 0; i < 30; i++) dSync.update(dt);
  dSync.syncTo(scene.choice.t, 0.2, true);
  if (!dSync.awaitingChoice) problems.push('outro-ask: syncTo(waiting) seçim kapısını açmadı');

  /* Seçimsiz sahneler normal atlanabilmeli */
  for (const id of ['intro', 'outro-yes', 'outro-no']) {
    const d4 = new Director(SCENES[id], { config });
    for (let i = 0; i < 30; i++) d4.update(dt);
    d4.skip();
    if (!d4.ended) problems.push(`${id}: Atla çalışmıyor`);
  }
}

/* ---------- Rapor ---------- */

console.log('\n=== SAHNE RAPORU ===');
console.table(report);
console.log(`Taranan kare: ${totalFrames}   ·   Çizim çağrısı: ${calls.toLocaleString('tr-TR')}`);

const unique = [...new Set(problems)];
if (unique.length === 0) {
  console.log('\n✔ Temiz — NaN yok, bozuk renk yok, çizim hatası yok, seek() deterministik, seçim akışı sağlam.\n');
} else {
  console.log(`\n✘ ${unique.length} farklı sorun (ilk 40):\n`);
  unique.slice(0, 40).forEach(p => console.log('  · ' + p));
  console.log('');
  process.exitCode = 1;
}
