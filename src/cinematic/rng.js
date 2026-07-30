/* ==========================================================================
   Tohumlanmış rastgelelik

   Prosedürel sanatın en büyük tuzağı: Math.random() her karede farklı sonuç
   verir, ot yaprakları titrer. Bu yüzden sahne içindeki HER şey tohumlanmış
   üreteçten gelir — aynı tohum, aynı manzara, her karede.
   ========================================================================== */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tohumdan deterministik bir sayı dizisi üret ve önbelleğe al */
const _cache = new Map();

export function seeded(key, seed, count, factory) {
  const id = `${key}:${seed}:${count}`;
  if (_cache.has(id)) return _cache.get(id);
  const rnd = mulberry32(seed);
  const arr = [];
  for (let i = 0; i < count; i++) arr.push(factory(rnd, i));
  _cache.set(id, arr);
  return arr;
}

export function clearSeedCache() { _cache.clear(); }

/** Yumuşak, tekrar eden gürültü — rüzgar dalgaları ve bulut kenarları için */
export function noise1(x) {
  return (
    Math.sin(x) * 0.5 +
    Math.sin(x * 2.13 + 1.7) * 0.28 +
    Math.sin(x * 4.37 + 3.1) * 0.14 +
    Math.sin(x * 8.91 + 0.6) * 0.08
  );
}
