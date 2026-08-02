/* ==========================================================================
   Pixel-art sinematik sprite'ları

   Kare seçimi yalnızca sahne zamanı/aktör pozundan türetilir. Böylece seek()
   ve iki tarayıcı arasındaki sinematik senkronu deterministik kalır.
   ========================================================================== */

import { loadImage } from '../layers.js';

const BASE = 'cine/sprites/';
const SOURCES = {
  hero: {
    idle: 'hero-idle.webp',
    breathe: ['hero-breathe-low.webp', 'hero-breathe-high.webp', 'hero-breathe-low.webp'],
    walk: [
      'hero-walk-contact-a.webp', 'hero-walk-pass.webp',
      'hero-walk-contact-b.webp', 'hero-walk-pass.webp'
    ],
    walkA: 'hero-walk-a.webp',
    walkB: 'hero-walk-b.webp',
    offer: ['hero-offer-anticipate.webp', 'hero-offer-settle.webp'],
    offerHand: 'hero-offer.webp',
    kneelMotion: [
      'hero-attentive.webp', 'hero-lean.webp', 'hero-half-kneel.webp',
      'hero-full-kneel.webp', 'hero-kneel-settle.webp'
    ],
    kneel: 'hero-kneel.webp',
    /* Gökyüzüne bakış — ejderha geçişinde tepki */
    lookUp: 'hero-attentive.webp',
    recoil: 'hero-recoil.webp',
    sit: 'hero-sit.webp'
  },
  companion: {
    idle: 'companion-idle.webp',
    breathe: ['companion-breathe-low.webp', 'companion-breathe-high.webp', 'companion-breathe-low.webp'],
    walk: [
      'companion-walk-contact-a.webp', 'companion-walk-pass.webp',
      'companion-walk-contact-b.webp', 'companion-walk-pass.webp'
    ],
    walkA: 'companion-walk-a.webp',
    walkB: 'companion-walk-b.webp',
    offer: [
      'companion-offer-anticipate.webp', 'companion-reach.webp',
      'companion-reach-settle.webp'
    ],
    offerHand: 'companion-offer.webp',
    headTurn: ['companion-attentive.webp', 'companion-head-turn.webp'],
    lookUp: 'companion-head-turn.webp',
    recoil: 'companion-recoil.webp',
    recoilStrong: 'companion-recoil-strong.webp',
    sit: 'companion-sit.webp'
  },
  dragon: {
    /* ÇIRPMA DÖNGÜSÜNÜN BENZERSİZ KARELERİ — FLY_CYCLE bunlardan kuruluyor.
       Burası aynı zamanda ön yükleme listesinin kaynağı (bkz. ALL_SOURCES),
       yani çizilen her kare kesin olarak önceden yükleniyor.

       Eskiden bu liste ÖLÜYDÜ: kimse okumuyordu, üstelik döngüde hiç
       kullanılmayan kareleri (fly-descend/low/rise/glide) sayıyordu.
       Döngünün gerçekten çizdiği `dragon-bank` ise listede olmadığı için
       ön yüklenmiyordu — WebP dönüşümünde de bu yüzden atlandı ve dosya
       hiç üretilmedi. Sonuç: çırpmanın 6 karesinden 2'si 404 veriyor,
       ejderha geçerken kanatlar bir anlığına yok oluyordu. */
    flyMotion: [
      'dragon-fly-up.webp', 'dragon-fly-high.webp',
      'dragon-bank.webp', 'dragon-fly-down.webp'
    ],
    flyUp: 'dragon-fly-up.webp',
    flyDown: 'dragon-fly-down.webp',
    dead: 'dragon-dead.webp',
    deadFar: 'dragon-dead-far.webp',
    wakeEye: 'dragon-wake-eye.webp',
    wakeHead: 'dragon-wake-head.webp',
    wakeHalf: 'dragon-wake-half.webp',
    wakeAnticipate: 'dragon-wake-anticipate.webp',
    wakeRoar: 'dragon-wake-roar.webp',
    wakeLunge: 'dragon-wake-lunge.webp',
    eye: 'dragon-eye.webp',
    rise: 'dragon-rise.webp',
    roar: 'dragon-roar.webp',
    lunge: 'dragon-lunge.webp'
  }
};

const ALL_SOURCES = Object.values(SOURCES)
  .flatMap(group => Object.values(group).flat())
  .map(file => BASE + file);
export const PIXEL_SPRITE_SOURCES = ALL_SOURCES;

function getRecord(file) {
  return loadImage(BASE + file);
}

function sequenceFrame(frames, elapsed, fps, loop = false) {
  const raw = Math.max(0, Math.floor(elapsed * fps));
  const index = loop ? raw % frames.length : Math.min(frames.length - 1, raw);
  return frames[index];
}

/* Adım uzunluğu: yürüme karesi başına düşen yatay piksel.
   Kare seçimi ZAMANDAN değil KONUMDAN türetilir — böylece ayaklar yere
   "yapışır": karakter yavaşlarken adımlar da yavaşlar, kayma (foot-skate)
   olmaz. x(t) deterministik olduğundan seek()/co-op senkronu bozulmaz. */
const WALK_STRIDE_PX = 11;

/* Tüm pozlar AYNI hedef yüksekliğe çizilir. Eski kod motion karelerinde
   img.height*0.44, statiklerde 108 kullanıyordu — idle~272px / sit~203px
   / ejderha kanat karesinde 48↔164 arasında zıplıyordu. */
const ACTOR_DRAW_H = 108;
const DRAGON_FLY_H = 96;
const DRAGON_GROUND_H = 150;

function walkPhase(actor) {
  return Math.abs(actor?.x ?? 0) / WALK_STRIDE_PX;
}

function actorFrame(kind, actor, t) {
  const frames = SOURCES[kind];
  const anim = actor?.anim || 'idle';
  const elapsed = actor?.animElapsed ?? t;
  if (anim === 'idle') return sequenceFrame(frames.breathe, t + (kind === 'companion' ? 0.37 : 0), 1.35, true);
  if (anim === 'walk') {
    return sequenceFrame(frames.walk, walkPhase(actor), 1, true);
  }
  if (anim === 'offerHand' || anim === 'reach' || anim === 'reachBack') {
    return sequenceFrame(frames.offer, elapsed, kind === 'hero' ? 4.5 : 3.8);
  }
  if (anim === 'kneel' && frames.kneelMotion) return sequenceFrame(frames.kneelMotion, elapsed, 4.4);
  if (anim === 'headTurn' && frames.headTurn) return sequenceFrame(frames.headTurn, elapsed, 2.8);
  if (anim === 'lookUp' && frames.lookUp) return frames.lookUp;
  if (anim === 'recoil' && frames.recoilStrong) return frames.recoilStrong;
  if (frames[anim]) return frames[anim];
  return frames.idle;
}

export function drawPixelActor(ctx, kind, actor, t, fallback) {
  if (!actor || (actor.alpha ?? 1) <= 0.01) return;
  const file = actorFrame(kind, actor, t);
  const rec = getRecord(file);
  if (!rec?.ready) {
    fallback?.();
    return;
  }

  const img = rec.img;
  const height = ACTOR_DRAW_H * (actor.scale ?? 1);
  const width = height * (img.width / Math.max(1, img.height));

  /* Yürürken gövde canlansın: adım fazından türeyen sekme + hıza bağlı
     hafif öne eğilme. İkisi de t'nin saf fonksiyonu (x(t) deterministik). */
  const walking = (actor.anim || 'idle') === 'walk';
  const amp = walking ? Math.max(0.42, actor.walkAmp ?? 1) : (actor.walkAmp ?? 0);
  const bobY = walking
    ? -Math.abs(Math.sin(walkPhase(actor) * Math.PI * 0.5)) * 4.0 * amp * (actor.scale ?? 1)
    : Math.sin(t * 1.7 + (kind === 'companion' ? 1.3 : 0)) * 0.9;
  const lean = walking ? 0.055 * amp : 0;

  ctx.save();
  ctx.globalAlpha = actor.alpha ?? 1;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(actor.x), Math.round(actor.y + bobY));
  ctx.scale(actor.facing >= 0 ? 1 : -1, 1);
  if (actor.rot || lean) ctx.rotate((actor.rot || 0) + lean);
  ctx.drawImage(img, Math.round(-width / 2), Math.round(-height), Math.round(width), Math.round(height));
  ctx.restore();
}

/* ==========================================================================
   UÇUŞ KARELERİ — kalibrasyon tablosu

   PNG'ler içeriğe göre sıkı kırpılmış ama her kare ejderhanın FARKLI bir
   kısmını kapsıyor: `dragon-glide` yalnızca gövde (179x59), `dragon-fly-up`
   ise kanatlar tepede tam beden (334x320). Kareleri ortak bir YÜKSEKLİĞE
   normalize etmek bu yüzden felaketti — aynı ejderha bir karede 111 px, bir
   sonrakinde 425 px geniş çıkıyor, gökte şişip sönen bir leke gibi
   görünüyordu. Kullanıcının "ejderha geçişi çok kötü" dediği şey buydu.

   Doğru çapa KAFA: her karede aynı boyutta ve ejderha hep sola bakıyor,
   yani kafa opak alanın sol ucunda. Aşağıdaki sayılar kafa yüksekliğinin
   ölçülmesiyle çıkarıldı (tools/measure-dragon.mjs):

       s  → bu kareyi referansla aynı ölçeğe getiren çarpan
       hy → kafa merkezinin görüntü içindeki y'si (çapa noktası)

   Kanatları görünmeyen kırpık kareler (`fly-low`, `glide`) çırpma
   döngüsünden ÇIKARILDI: aralarına girdiklerinde kanatlar bir anlığına
   yok oluyordu.
   ========================================================================== */

const FLY_CAL = {
  'dragon-fly-up.webp':      { s: 0.617, hy: 223 },
  'dragon-fly-high.webp':    { s: 0.877, hy: 175 },
  'dragon-bank.webp':        { s: 1.000, hy: 54 },
  'dragon-fly-down.webp':    { s: 0.617, hy: 50 },
  'dragon-fly-descend.webp': { s: 1.064, hy: 40 }
};

/** Kalibrasyonun referans aldığı kafa yüksekliği (dragon-bank.png) */
const FLY_REF_HEAD = 50;
/** scale=1 iken kafanın ekranda kaplayacağı yükseklik */
const FLY_HEAD_H = 34;

/* Kanat çırpma döngüsü: yukarı → yarı → açık → aşağı → açık → yarı.
   Gidiş-dönüş (ping-pong) olduğu için başa dönerken sıçrama olmuyor.

   Kare adları ELLE YAZILMIYOR, SOURCES.dragon.flyMotion'dan geliyor:
   ön yükleme listesi de oradan türüyor, dolayısıyla "çizilen ama
   yüklenmeyen kare" durumu artık oluşamaz. */
const [FLY_UP, FLY_HIGH, FLY_BANK, FLY_DOWN] = SOURCES.dragon.flyMotion;
const FLY_CYCLE = [FLY_UP, FLY_HIGH, FLY_BANK, FLY_DOWN, FLY_BANK, FLY_HIGH];

function dragonFrame(options) {
  if (options.flying) {
    return sequenceFrame(FLY_CYCLE, options.t ?? 0, options.flapFps ?? 7, true);
  }
  if ((options.lunge ?? 0) > 0.18) return SOURCES.dragon.wakeLunge;
  if ((options.maw ?? 0) > 0.28) return SOURCES.dragon.wakeRoar;
  if ((options.rise ?? 0) > 0.72) return SOURCES.dragon.wakeAnticipate;
  if ((options.rise ?? 0) > 0.34) return SOURCES.dragon.wakeHalf;
  if ((options.rise ?? 0) > 0.04) return SOURCES.dragon.wakeHead;
  if ((options.eye ?? 0) > 0.04) return SOURCES.dragon.wakeEye;
  return options.far ? SOURCES.dragon.deadFar : SOURCES.dragon.dead;
}

export function drawPixelDragon(ctx, options = {}, fallback) {
  const alpha = options.alpha ?? 1;
  if (alpha <= 0.01) return;
  const file = dragonFrame(options);
  const rec = getRecord(file);
  if (!rec?.ready) {
    fallback?.();
    return;
  }

  const img = rec.img;

  /* ---------------- UÇUŞ: kafadan çapalı, kalibre ölçek ----------------
     Kare boyutuna göre değil, ÖLÇÜLMÜŞ kafa yüksekliğine göre ölçekliyoruz
     ve kafayı (x, y) noktasına oturtuyoruz. Böylece kanatlar çırparken
     gövde yerinde duruyor; eski hâlinde her kare farklı boyda çıkıp
     ejderhayı titretiyordu. */
  if (options.flying) {
    const cal = FLY_CAL[file] || { s: 1, hy: img.height / 2 };
    const k = (FLY_HEAD_H * (options.scale ?? 1) * cal.s) / FLY_REF_HEAD;
    const w = img.width * k;
    const h = img.height * k;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(options.x ?? 0), Math.round(options.y ?? 0));
    /* Sprite'lar SOLA bakıyor. Uçuş yönü sağa ise aynala. */
    ctx.scale((options.facing ?? 1) >= 0 ? -1 : 1, 1);
    if (options.rotation) ctx.rotate(options.rotation);
    /* Kafa yerel (0,0)'da: sol kenar çapa, dikeyde kafa merkezi hizada */
    ctx.drawImage(img, 0, -cal.hy * k, w, h);
    ctx.restore();
    return;
  }

  /* ---------------- YER: eski davranış ---------------- */
  const height = DRAGON_GROUND_H * (options.scale ?? 1);
  const width = height * (img.width / Math.max(1, img.height));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(options.x ?? 0), Math.round(options.y ?? 0));
  ctx.scale((options.facing ?? 1) >= 0 ? 1 : -1, 1);
  if (options.rotation) ctx.rotate(options.rotation);
  if ((options.lunge ?? 0) > 0.12) {
    ctx.save();
    ctx.globalAlpha *= 0.18 * (options.lunge ?? 0);
    ctx.drawImage(img, Math.round(-width / 2 - 24), Math.round(-height), Math.round(width), Math.round(height));
    ctx.restore();
  }
  ctx.drawImage(img, Math.round(-width / 2), Math.round(-height), Math.round(width), Math.round(height));
  ctx.restore();
}

export function preloadPixelSprites() {
  if (typeof Image === 'undefined') return Promise.resolve();
  return Promise.all(ALL_SOURCES.map(src => new Promise(resolve => {
    const rec = loadImage(src);
    if (rec.ready || rec.failed) return resolve();
    rec.img.addEventListener('load', resolve, { once: true });
    rec.img.addEventListener('error', resolve, { once: true });
  })));
}
