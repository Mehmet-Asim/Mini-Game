/* ==========================================================================
   Easing + örnekleme yardımcıları

   Sinematik motorunun TEK kuralı: her şey zamanın saf fonksiyonu olmalı.
   Hiçbir yerde "önceki kareye göre ilerlet" yok. Böylece seek(t) çağırdığımızda
   sahne o ana tam olarak ışınlanır — co-op senkronu bunun üstüne kurulacak.
   ========================================================================== */

export const EASE = {
  linear:      t => t,
  inQuad:      t => t * t,
  outQuad:     t => 1 - (1 - t) * (1 - t),
  inOutQuad:   t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  inCubic:     t => t * t * t,
  outCubic:    t => 1 - Math.pow(1 - t, 3),
  inOutCubic:  t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  inQuart:     t => t * t * t * t,
  outQuart:    t => 1 - Math.pow(1 - t, 4),
  inOutQuart:  t => t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2,
  outExpo:     t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t),
  inExpo:      t => t <= 0 ? 0 : Math.pow(2, 10 * t - 10),
  outBack:     t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  outElastic:  t => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
  },
  /** Yumuşak nefes alma — sürekli döngü için */
  breathe:     t => 0.5 - Math.cos(t * Math.PI * 2) * 0.5
};

export function ease(name, t) {
  const fn = EASE[name] || EASE.inOutCubic;
  return fn(clamp01(t));
}

export const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;

/** 0..1 aralığında normalize et; a===b ise 1 döner */
export function norm(v, a, b) {
  if (b === a) return 1;
  return clamp01((v - a) / (b - a));
}

/**
 * Keyframe dizisini t anında örnekle.
 * keys: [{ t, ...değerler, ease }]  — t'ye göre artan sırada olmalı
 * fields: interpolasyona girecek sayısal alanlar
 * stepFields: interpolasyona GİRMEYEN alanlar (facing, anim gibi) — son geçerli değeri alır
 */
export function sampleKeys(keys, t, fields, stepFields = []) {
  const out = {};
  if (!keys || keys.length === 0) return out;

  // t ilk keyframe'den önceyse ilk keyframe'i döndür
  if (t <= keys[0].t) {
    for (const f of fields) out[f] = keys[0][f];
    for (const f of stepFields) out[f] = keys[0][f];
    out._segment = -1;
    return out;
  }

  // t son keyframe'den sonraysa son keyframe'i döndür
  const last = keys[keys.length - 1];
  if (t >= last.t) {
    for (const f of fields) out[f] = last[f];
    for (const f of stepFields) out[f] = last[f];
    out._segment = keys.length - 1;
    return out;
  }

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;

  const a = keys[i];
  const b = keys[i + 1];
  const raw = norm(t, a.t, b.t);
  if (b.cut) {
    for (const f of fields) out[f] = a[f] !== undefined ? a[f] : b[f];
    for (const f of stepFields) out[f] = a[f] !== undefined ? a[f] : b[f];
    out._segment = i;
    out._segmentProgress = raw;
    return out;
  }
  const e = ease(b.ease || 'inOutCubic', raw);

  for (const f of fields) {
    const av = a[f];
    const bv = b[f];
    if (av === undefined && bv === undefined) continue;
    if (av === undefined) { out[f] = bv; continue; }
    if (bv === undefined) { out[f] = av; continue; }
    out[f] = lerp(av, bv, e);
  }
  for (const f of stepFields) {
    out[f] = b[f] !== undefined && raw >= 1 ? b[f] : (a[f] !== undefined ? a[f] : b[f]);
  }

  out._segment = i;
  out._segmentProgress = raw;
  return out;
}

/**
 * Bir "olay" penceresinin zarfı (envelope).
 * Giriş → sabit → çıkış. Dışarıdaysa 0 döner.
 * Kartların, flaşların, ışık huzmelerinin opaklığı hep bundan gelir.
 */
export function envelope(t, start, dur, fadeIn = 0.5, fadeOut = 0.6) {
  const local = t - start;
  if (local < 0 || local > dur) return 0;
  const inA = fadeIn > 0 ? clamp01(local / fadeIn) : 1;
  const outA = fadeOut > 0 ? clamp01((dur - local) / fadeOut) : 1;
  return Math.min(ease('outCubic', inA), ease('inCubic', outA));
}

/** Belirli bir anda tetiklenen tek seferlik olayları bulmak için pencere testi */
export function crossed(prevT, t, at) {
  return prevT < at && t >= at;
}
