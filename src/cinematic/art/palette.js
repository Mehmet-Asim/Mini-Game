/* ==========================================================================
   Renk Paletleri

   Her sahnenin bir "saati" var. Palet o saati taşır: gökyüzü, tepeler, otlar,
   figürlerin üstüne düşen ışığın rengi — hepsi tek yerden.

   Yağlı boya görsellere geçtiğimizde bu paletler ölmez: prosedürel kalan
   katmanlar (ön plan otları, polen, ışık huzmeleri) buradan renk almaya
   devam eder, böylece görselle uyumlu kalırlar.
   ========================================================================== */

export const PALETTES = {

  /* Altın saat — açılış sahnesi. Uçsuz bucaksız otlar, sıcak ama umutlu. */
  goldenMeadow: {
    name: 'goldenMeadow',
    skyTop:   '#172b4d',
    skyMid:   '#405d82',
    skyLow:   '#f0a45f',
    skyHaze:  '#ffd08a',
    sun:      '#ffe9b8',
    sunGlow:  '255, 208, 130',
    hillFar:  '#4a5f7a',
    hillMid:  '#3d5c52',
    hillNear: '#2c4535',
    grassLow: '#142d24',
    grassMid: '#31513a',
    grassHi:  '#597343',
    grassTip: '#b39a4d',
    rim:      '255, 214, 150',
    ambient:  'rgba(255, 190, 120, 0.07)',
    fog:      '246, 217, 168',
    mote:     '255, 232, 180'
  },

  /* Gün batımı — kabul finali. Sıcak, doygun, huzurlu. */
  sunsetVow: {
    name: 'sunsetVow',
    skyTop:   '#1b1f45',
    skyMid:   '#9f465c',
    skyLow:   '#f2783f',
    skyHaze:  '#ffc164',
    sun:      '#fff0c4',
    sunGlow:  '255, 168, 92',
    hillFar:  '#4a3358',
    hillMid:  '#33253f',
    hillNear: '#1f1728',
    grassLow: '#14101c',
    grassMid: '#241a26',
    grassHi:  '#3d2a2c',
    grassTip: '#7d5340',
    rim:      '255, 178, 107',
    ambient:  'rgba(255, 140, 70, 0.10)',
    fog:      '255, 178, 107',
    mote:     '255, 200, 140'
  },

  /* Kor — ret finali. Ejderha uyanıyor. */
  emberWake: {
    name: 'emberWake',
    skyTop:   '#07070c',
    skyMid:   '#24101f',
    skyLow:   '#52151d',
    skyHaze:  '#8a2822',
    sun:      '#ff6b3d',
    sunGlow:  '220, 60, 40',
    hillFar:  '#241016',
    hillMid:  '#170a0f',
    hillNear: '#0d0609',
    grassLow: '#080406',
    grassMid: '#12080a',
    grassHi:  '#1e0c0c',
    grassTip: '#3a1712',
    rim:      '255, 96, 48',
    ambient:  'rgba(180, 30, 20, 0.14)',
    fog:      '160, 40, 30',
    mote:     '255, 120, 60'
  },

  /* Alacakaranlık — teklif anı. Ne gündüz ne gece; kararın rengi. */
  duskAsk: {
    name: 'duskAsk',
    skyTop:   '#131836',
    skyMid:   '#5d2f75',
    skyLow:   '#c24c69',
    skyHaze:  '#ff9569',
    sun:      '#ffe2b0',
    sunGlow:  '255, 150, 110',
    hillFar:  '#2f2b4a',
    hillMid:  '#221d33',
    hillNear: '#14101f',
    grassLow: '#0d0a14',
    grassMid: '#171224',
    grassHi:  '#241b2c',
    grassTip: '#4d3640',
    rim:      '255, 190, 140',
    ambient:  'rgba(180, 120, 140, 0.08)',
    fog:      '212, 144, 111',
    mote:     '255, 210, 170'
  }
};

export function getPalette(name) {
  return PALETTES[name] || PALETTES.goldenMeadow;
}

/* ---------- Renk yardımcıları ---------- */

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** İki paleti karıştır — sahne içinde gün batımı ilerlesin diye */
export function mixHex(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}
