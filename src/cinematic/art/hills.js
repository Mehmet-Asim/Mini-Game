/* ==========================================================================
   Tepeler — katmanlı siluetler

   Derinlik hissi üç şeyden gelir: renk (uzak = puslu), genlik (uzak = alçak
   dalgalar), parallax (uzak = yavaş). Üçünü birden uygulamazsan manzara düz
   görünür.
   ========================================================================== */

import { VW, VH } from '../stage.js';
import { rgba } from './palette.js';
import { noise1, seeded } from '../rng.js';

const PAD = 700;

/**
 * Tek bir tepe şeridi.
 * baseY: tepenin taban çizgisi. amp: dalga yüksekliği. freq: dalga sıklığı.
 */
export function drawHillBand(ctx, opts) {
  const {
    color, baseY, amp = 60, freq = 0.0021,
    seed = 0, drift = 0, t = 0, alpha = 1,
    detail = 0.45, step = 8
  } = opts;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-PAD, VH + 200);

  const shift = t * drift;
  for (let x = -PAD; x <= VW + PAD; x += step) {
    const n =
      noise1((x + shift) * freq + seed) * 0.62 +
      noise1((x + shift) * freq * 2.7 + seed * 1.7) * detail * 0.38;
    ctx.lineTo(x, baseY - n * amp);
  }

  ctx.lineTo(VW + PAD, VH + 200);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Uzaktaki ağaç/kale silueti — tepenin sırtına serpilir.
 * Ölçek küçük olduğu için üçgen + gövde yeterli; detay gözükmez.
 */
export function drawRidgeTrees(ctx, opts) {
  const {
    color, baseY, amp = 60, freq = 0.0021, seed = 0,
    count = 26, size = 16, alpha = 1, spread = VW + PAD * 2
  } = opts;

  const trees = seeded('ridge', seed * 977 + count, count, (r) => ({
    x: r() * spread - PAD,
    s: 0.55 + r() * 0.9,
    lean: (r() - 0.5) * 0.25
  }));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (const tr of trees) {
    const n = noise1(tr.x * freq + seed) * 0.62 + noise1(tr.x * freq * 2.7 + seed * 1.7) * 0.17;
    const y = baseY - n * amp;
    const h = size * tr.s;
    const w = h * 0.42;
    ctx.beginPath();
    ctx.moveTo(tr.x, y - h);
    ctx.lineTo(tr.x + w + tr.lean * h, y + 2);
    ctx.lineTo(tr.x - w + tr.lean * h, y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(tr.x - 1, y - 2, 2, 5);
  }
  ctx.restore();
}

/**
 * Uzak dağ sırası — keskin, buzul tepeli, en arkada.
 * Sadece geniş açılı sahnelerde kullan, yoksa kadraj kalabalıklaşır.
 */
export function drawMountains(ctx, p, opts) {
  const {
    baseY = VH * 0.56, height = 150, seed = 3,
    alpha = 0.5, color = p.hillFar, snow = false,
    freq = 0.0013, step = 6
  } = opts;

  /* "Sırtlı gürültü" (ridged noise): |gürültü| tersine çevrilince tepe noktaları
     sivri, yamaçlar sürekli olur. Üçgen dizmekten çok daha inandırıcı —
     ilk denemede dağlar piramide benziyordu, sorun buydu. */
  const ridge = (x) => {
    let v = 0, amp = 1, f = freq, norm = 0;
    for (let o = 0; o < 4; o++) {
      v += (1 - Math.abs(noise1(x * f + seed * 3.1 + o * 7.3))) * amp;
      norm += amp;
      amp *= 0.46;
      f *= 2.18;
    }
    return Math.pow(v / norm, 1.9);
  };

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-PAD, VH + 200);
  for (let x = -PAD; x <= VW + PAD; x += step) {
    ctx.lineTo(x, baseY - ridge(x) * height);
  }
  ctx.lineTo(VW + PAD, VH + 200);
  ctx.closePath();
  ctx.fill();

  /* Karlı zirveler — sadece belirli bir yüksekliğin üstünde */
  if (snow) {
    ctx.fillStyle = rgba(p.skyHaze, alpha * 0.55);
    const snowLine = 0.72;
    let open = false;
    ctx.beginPath();
    for (let x = -PAD; x <= VW + PAD; x += step) {
      const n = ridge(x);
      if (n >= snowLine) {
        const y = baseY - n * height;
        if (!open) { ctx.moveTo(x, baseY - snowLine * height); open = true; }
        ctx.lineTo(x, y);
      } else if (open) {
        ctx.lineTo(x, baseY - snowLine * height);
        ctx.closePath();
        open = false;
      }
    }
    if (open) { ctx.lineTo(VW + PAD, baseY - snowLine * height); ctx.closePath(); }
    ctx.fill();
  }
  ctx.restore();
}
