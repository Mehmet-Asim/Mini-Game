/* ==========================================================================
   Bölüm Verileri — veri odaklı seviye mimarisi

   Koordinat sistemi: dünya pikseli, Y aşağı doğru artar.
   Zemin taban çizgisi GROUND_Y = 520.

   Ölçülen zıplama menzili (player.js fizik değerleriyle):
     tek zıplama  → yükseklik 115px, yatay 231px
     çift zıplama → yükseklik 199px, yatay 358px

   Tasarım kuralları (sert kurallar — validate.mjs bunları denetler):
   1. Uçurumlar 140px (≈ %40 güvenlik payı) — kimse kenar hesabı yapmak zorunda kalmasın
   2. Dikey adımlar ≤ 90px
   3. Dikenler devriye alanlarıyla ÇAKIŞMAZ (çifte cezalandırma yok)
   4. UÇURUMLARIN ÜSTÜNE ALÇAK PLATFORM KOYULMAZ.
      Oyuncu yerden zıplarken gövdesi y=476..361 arasını tarar; bu bantta duran
      bir platformun altına çarpıp hızını kaybeder ve uçuruma düşer.
      Bu yüzden tüm hareketli/çöken platformlar SAĞLAM ZEMİN üstünde durur —
      düşersen sadece yere inersin, ölmezsin.
   5. Platformlar birbiriyle çakışmaz.
   6. YÜRÜME KORİDORU BOŞ KALIR. Zeminde duran oyuncu y=476..520 bandını kaplar;
      hiçbir platform (özellikle dikey asansörler) bu banda inmez, yoksa
      koşan oyuncunun önünü kesen görünmez bir duvara dönüşür.
      Bu yüzden dikey asansörler y ∈ [350, 440] aralığında kalır.
   ========================================================================== */

export const GROUND_Y = 520;
export const DEATH_Y = 900;

const g = (x0, x1) => ({ x: x0, y: GROUND_Y, w: x1 - x0, h: DEATH_Y - GROUND_Y + 200 });
const p = (x, y, w, h = 20) => ({ x, y, w, h });
const ow = (x, y, w) => ({ x, y, w, h: 14, oneWay: true });

export const LEVELS = [

  /* ======================================================================
     BÖLÜM 1 — KARANLIK ORMAN
     Öğretici ritim: koş → zıpla → uçurum → düşman ez → çift zıplama → kılıç
     ====================================================================== */
  {
    id: 0,
    name: 'Karanlık Orman',
    subtitle: 'Ay ışığı ağaçların arasından zar zor sızıyor.',
    theme: 'forest',
    width: 3400,
    startX: 90,
    startY: GROUND_Y - 60,
    intro: 'Ormana girdin. Sağa doğru ilerle, kalpleri topla.',
    tips: [
      { x: 260, text: 'Hareket: ← →  ·  Zıpla: Boşluk' },
      { x: 700, text: 'Zıplarken tuşu basılı tut — daha yükseğe çıkarsın' },
      { x: 1400, text: 'Düşmanın üstüne zıpla, ezerek yok et' },
      { x: 2060, text: 'Havadayken tekrar zıpla: ÇİFT ZIPLAMA' },
      { x: 2560, text: 'Kılıç: J tuşu' },
      { x: 3000, text: 'Yay: K tuşu — uzaktaki yarasaları ok ile düşür' }
    ],

    ground: [
      g(0, 860),
      g(980, 1620),
      g(1740, 2320),
      g(2440, 2660),
      g(2780, 3400)
    ],

    platforms: [
      p(540, 430, 120),
      p(740, 350, 110),
      p(1060, 430, 100),
      p(1240, 350, 110),
      p(1420, 280, 120),
      p(1840, 430, 110),
      p(2020, 350, 110),
      p(2200, 280, 120),
      p(2520, 400, 110),
      p(2900, 420, 110),
      p(3080, 340, 120)
    ],

    oneWay: [
      ow(920, 300, 130),
      ow(2180, 200, 130)
    ],

    /* Hareketli platformlar sağlam zemin üstünde — yüksek kalplere asansör */
    moving: [
      { x: 1480, y: 395, w: 110, rangeY: 45, speed: 1.0 },
      { x: 3180, y: 425, w: 110, rangeX: 75, speed: 1.05, phase: 0.8 }
    ],

    crumble: [],

    /* Dikenler devriye alanlarının dışında */
    spikes: [
      { x: 1180, y: GROUND_Y - 18, w: 48 },
      { x: 2960, y: GROUND_Y - 18, w: 48 }
    ],

    enemies: [
      { type: 'walker', x: 1470, y: GROUND_Y - 32, minX: 1430, maxX: 1600, speed: 62 },
      { type: 'flyer',  x: 1500, y: 300, rangeX: 90, amp: 40, speed: 1.5 },
      { type: 'walker', x: 1900, y: GROUND_Y - 32, minX: 1800, maxX: 2280, speed: 68 },
      { type: 'flyer',  x: 2260, y: 280, rangeX: 110, amp: 50, speed: 1.7 },
      { type: 'walker', x: 3100, y: GROUND_Y - 32, minX: 3060, maxX: 3360, speed: 74 },
      { type: 'flyer',  x: 3250, y: 260, rangeX: 100, amp: 45, speed: 1.8 }
    ],

    hearts: [
      [300, 450], [560, 380], [780, 300], [900, 250],
      [1080, 380], [1280, 300], [1460, 230], [1560, 420],
      [1820, 460], [1880, 380], [2060, 300], [2240, 230],
      [2400, 400], [2560, 350], [2860, 440], [2940, 370],
      [3120, 290], [3260, 440], [3340, 380]
    ],

    storyHearts: [
      { x: 960, y: 250, index: 0 }
    ],

    lifeOrbs: [],

    checkpoints: [
      { x: 1780, y: GROUND_Y },
      { x: 2830, y: GROUND_Y }
    ],

    /* ---------------- CO-OP ----------------
       Yalnızca iki kişilik oyunda yüklenir. Tek kişilik oynanışta bu
       diziler yok sayılır ve bölüm eskisi gibi geçilir.

       B1 öğretici mantığı: "yoldaşın olmadan olmuyor"u en basit haliyle
       tanıt. Önce plaka+kapı (biri basar, diğeri geçer), sonra ortak
       asansör (ikisi de binmeli). */
    plates: [
      /* İkisi de aynı ekranda: 284px arayla iki plaka. Bir kişi ikisine
         birden basamaz (karakter 26px). Öğretici an. */
      { id: 'p1', x: 1000, y: GROUND_Y - 12, w: 48 },
      { id: 'p2', x: 1290, y: GROUND_Y - 12, w: 56 }
    ],

    gates: [
      { x: 1390, y: GROUND_Y - 150, w: 24, h: 150, needs: ['p1', 'p2'], label: 'Orman Kapısı' }
    ],

    coopLifts: [
      /* Yükselince üstteki platforma atlama mesafesine getirir.
         Yükseliş 150px: tepedeki y=280 platformunun altında durur, ezmez. */
      { x: 2140, y: GROUND_Y - 18, w: 120, rise: 150, speed: 58 }
    ],

    portal: { x: 3320, y: GROUND_Y }
  },

  /* ======================================================================
     BÖLÜM 2 — KALE SURLARI
     Dikey tırmanış, hareketli ve çöken platformlar, büyücüler
     ====================================================================== */
  {
    id: 1,
    name: 'Kale Surları',
    subtitle: 'Taşlar yosun tutmuş, nöbetçiler hâlâ uyanık.',
    theme: 'castle',
    width: 4000,
    startX: 80,
    startY: GROUND_Y - 60,
    intro: 'Surlara ulaştın. Yukarı tırman, büyücülere dikkat et.',
    tips: [
      { x: 900, text: 'Çatlak platformlar basınca çöker — durma, sıçra' },
      { x: 1700, text: 'Büyücüleri güvenli mesafeden ok ile indir (K)' },
      { x: 2150, text: 'Büyücünün mermisini kılıçla vurup geri sektir' }
    ],

    ground: [
      g(0, 680),
      g(800, 1200),
      g(1320, 1560),
      g(1680, 2100),
      g(2220, 2900),
      g(3020, 3320),
      g(3440, 4000)
    ],

    platforms: [
      p(260, 430, 110),
      p(880, 430, 100),
      p(1040, 350, 100),
      p(1400, 420, 100),
      p(1560, 340, 110),
      p(1780, 300, 110),
      p(1960, 220, 110),
      p(2300, 430, 100),
      p(2460, 350, 110),
      p(2640, 270, 110),
      p(2820, 190, 120),
      p(3100, 420, 100),
      p(3520, 425, 110),
      p(3700, 345, 110),
      p(3880, 265, 120)
    ],

    oneWay: [
      ow(180, 345, 130),
      ow(2180, 230, 130),
      ow(3260, 300, 140)
    ],

    /* Hepsi sağlam zemin üstünde */
    moving: [
      { x: 460,  y: 395, w: 100, rangeY: 45, speed: 1.1 },
      { x: 1850, y: 430, w: 110, rangeX: 70, speed: 1.0, phase: 0.6 },
      { x: 2760, y: 395, w: 100, rangeY: 45, speed: 1.15 }
    ],

    crumble: [
      { x: 900, y: 370, w: 90 },
      { x: 1050, y: 290, w: 90 },
      { x: 2500, y: 430, w: 90 },
      { x: 3160, y: 340, w: 90 }
    ],

    spikes: [
      { x: 1000, y: GROUND_Y - 18, w: 64 },
      { x: 2400, y: GROUND_Y - 18, w: 64 },
      { x: 2740, y: GROUND_Y - 18, w: 80 },
      { x: 3600, y: GROUND_Y - 18, w: 64 }
    ],

    enemies: [
      { type: 'walker', x: 400,  y: GROUND_Y - 32, minX: 240,  maxX: 660,  speed: 68 },
      { type: 'flyer',  x: 780,  y: 260, rangeX: 120, amp: 50, speed: 1.7 },
      { type: 'walker', x: 1750, y: GROUND_Y - 32, minX: 1720, maxX: 2080, speed: 74 },
      { type: 'caster', x: 1800, y: 300 - 48, dir: -1 },
      { type: 'flyer',  x: 2150, y: 240, rangeX: 130, amp: 55, speed: 1.6 },
      { type: 'caster', x: 2470, y: 350 - 48, dir: -1 },
      { type: 'walker', x: 2560, y: GROUND_Y - 32, minX: 2480, maxX: 2700, speed: 78 },
      { type: 'caster', x: 2850, y: 190 - 48, dir: -1 },
      { type: 'flyer',  x: 3250, y: 250, rangeX: 120, amp: 50, speed: 1.9 },
      { type: 'walker', x: 3720, y: GROUND_Y - 32, minX: 3680, maxX: 3960, speed: 80 },
      { type: 'caster', x: 3900, y: 265 - 48, dir: -1 }
    ],

    hearts: [
      [300, 450], [480, 350], [560, 290], [760, 440],
      [890, 380], [1070, 300], [1250, 440], [1430, 370],
      [1600, 290], [1820, 250], [2050, 140], [2140, 250],
      [2340, 380], [2500, 300], [2680, 220], [2760, 350],
      [3140, 370], [3300, 250], [3420, 440], [3560, 375],
      [3620, 300], [3740, 295], [3900, 215], [3980, 440]
    ],

    storyHearts: [
      { x: 2870, y: 130, index: 1 }
    ],

    /* Can yenileme — zorlaşan bölümlerin hemen öncesine yerleştirildi */
    lifeOrbs: [
      { x: 2000, y: 170 },   // yüksek platform ödülü
      { x: 2260, y: 445 },   // büyücü/diken koridoruna girmeden önce
      { x: 3060, y: 440 }    // son düzlüğe girmeden önce
    ],

    checkpoints: [
      { x: 1740, y: GROUND_Y },
      { x: 2280, y: GROUND_Y },
      { x: 3080, y: GROUND_Y }
    ],

    /* ---------------- CO-OP ----------------
       B2 mantığı: EŞ ZAMANLILIK. İki plaka birbirinden uzakta ve ikisi de
       basılı olmalı. Tek kişi koşarak yetişemez.

       Gecikme toleransı: plakalar "basılı tut" mantığıyla çalıştığı için
       ağ gecikmesi sorun değil — kimse milisaniye yakalamıyor. */
    plates: [
      /* Bölümün en güçlü co-op anı: iki plaka UÇURUMUN İKİ YAKASINDA.
         (zemin 1320..1560) ve (zemin 1680..2100) — aradaki boşluk 120px.
         Birbirinizi görüyorsunuz ama yan yana gelemiyorsunuz. */
      { id: 'q1', x: 2230, y: GROUND_Y - 12, w: 56 },
      { id: 'q2', x: 2600, y: GROUND_Y - 12, w: 56 }
    ],

    gates: [
      { x: 3260, y: GROUND_Y - 150, w: 26, h: 150, needs: ['q1', 'q2'], label: 'Sur Kapısı' }
    ],

    /* Bu bölümde ortak asansör YOK: dikey tırmanış zaten platform yoğun,
       200px'lik boş sütun bulunmuyor. Zorla sıkıştırmak yerine bölümün
       kendi ritmine güvendik. */
    coopLifts: [],

    portal: { x: 3940, y: GROUND_Y }
  },

  /* ======================================================================
     BÖLÜM 3 — EJDERHA İNİ
     Zorlu geçiş + BOSS ARENASI (2580'den itibaren)
     ====================================================================== */
  {
    id: 2,
    name: 'Ejderha İni',
    subtitle: 'Lav çatlaklardan sızıyor. Bir şey nefes alıyor.',
    theme: 'lair',
    width: 3900,
    startX: 80,
    startY: GROUND_Y - 60,
    intro: 'Ejderha ini. Son aşama — dikkatli ol.',
    tips: [
      { x: 2640, text: 'Ejderha Kalkanı ileride — al ve L tuşuyla siper al' },
      { x: 2760, text: 'L basılı tut: ejderhanın TÜM saldırıları durur (ama saldıramazsın)' },
      { x: 3020, text: 'Ejderha yere indiğinde savunmasız kalır. Kafasına vur!' }
    ],

    ground: [
      g(0, 620),
      g(740, 1100),
      g(1220, 1580),
      g(1700, 2100),
      g(2220, 2440),
      g(2560, 3900)      // 2560+ = boss arenası
    ],

    platforms: [
      p(220, 425, 100),
      p(790, 425, 90),
      p(1000, 340, 100),
      p(1160, 265, 110),
      p(1300, 425, 100),
      p(1460, 345, 100),
      p(1540, 265, 100),
      p(1860, 400, 100),
      p(2020, 320, 100),
      p(2180, 245, 110),
      p(2300, 340, 100),
      p(2380, 260, 100),
      // Boss arenası
      p(2820, 380, 130),
      p(3200, 320, 140),
      p(3580, 380, 130)
    ],

    oneWay: [
      ow(1660, 190, 130),
      ow(3000, 240, 150),
      ow(3420, 240, 150)
    ],

    /* Hepsi sağlam zemin üstünde */
    moving: [
      { x: 420,  y: 395, w: 100, rangeY: 45, speed: 1.2 },
      { x: 910,  y: 395, w: 90, rangeY: 45, speed: 1.25, phase: 0.7 },
      { x: 1780, y: 435, w: 100, rangeX: 60, speed: 1.15, phase: 1.4 },
      { x: 2900, y: 440, w: 110, rangeX: 75, speed: 1.3 },
      { x: 3350, y: 395, w: 110, rangeY: 45, speed: 1.35, phase: 0.5 }
    ],

    crumble: [
      { x: 1420, y: 430, w: 90 },
      { x: 1980, y: 430, w: 90 }
    ],

    spikes: [
      { x: 460,  y: GROUND_Y - 18, w: 48 },
      { x: 920,  y: GROUND_Y - 18, w: 48 },
      { x: 1400, y: GROUND_Y - 18, w: 64 },
      { x: 1940, y: GROUND_Y - 18, w: 48 }
    ],

    enemies: [
      { type: 'walker', x: 300,  y: GROUND_Y - 32, minX: 160,  maxX: 420,  speed: 76 },
      { type: 'flyer',  x: 700,  y: 280, rangeX: 110, amp: 50, speed: 1.8 },
      { type: 'caster', x: 1180, y: 265 - 48, dir: -1 },
      { type: 'walker', x: 1300, y: GROUND_Y - 32, minX: 1260, maxX: 1380, speed: 80 },
      { type: 'flyer',  x: 1540, y: 215, rangeX: 110, amp: 55, speed: 2.0 },
      { type: 'walker', x: 1800, y: GROUND_Y - 32, minX: 1760, maxX: 1920, speed: 84 },
      { type: 'flyer',  x: 2260, y: 195, rangeX: 100, amp: 45, speed: 2.1 },
      { type: 'caster', x: 2400, y: 260 - 48, dir: -1 }
    ],

    hearts: [
      [180, 445], [280, 360], [500, 380], [580, 440],
      [880, 350], [1060, 240], [1190, 200], [1330, 360],
      [1490, 280], [1580, 200], [1780, 200], [1890, 335],
      [2050, 255], [2150, 225], [2330, 275], [2410, 195],
      [2620, 445], [2860, 315], [3060, 190], [3250, 255],
      [3480, 190], [3630, 315], [3800, 440]
    ],

    storyHearts: [
      { x: 1700, y: 140, index: 2 }
    ],

    lifeOrbs: [
      { x: 1030, y: 275 },
      { x: 2210, y: 180 },
      { x: 2980, y: 430 }   // arenada, kalkandan sonra
    ],

    checkpoints: [
      { x: 1260, y: GROUND_Y },
      { x: 1740, y: GROUND_Y },
      { x: 2620, y: GROUND_Y }
    ],

    /* ---------------- CO-OP ----------------
       B3 mantığı: arenaya GİRMEDEN önce son bir iş birliği kapısı. Boss
       savaşının kendisi zaten doğal olarak co-op — ejderha en yakın
       oyuncuyu hedefliyor, yani biri dikkat çekerken diğeri vurabiliyor
       (bkz. engine._nearestPlayer). Ayrı bir mekanizma gerekmiyor.

       Arena içine kapı/plaka KOYULMADI: boss dövüşünde yer değiştirme
       zaten yoğun, üstüne bulmaca eklemek kaosa dönerdi. */
    plates: [
      /* Farklı YÜKSEKLİKTE iki plaka: biri zeminde, biri raftaki platformda.
         Yatay mesafe az ama tek kişi ikisine birden basamaz — dikey ayrım
         yeterli. Kadraj da böylece dar kalıyor, ikisi de ekranda. */
      { id: 'r1', x: 2240, y: GROUND_Y - 12, w: 56 },
      { id: 'r2', x: 2310, y: 340 - 12, w: 56 }
    ],

    gates: [
      { x: 2380, y: GROUND_Y - 150, w: 26, h: 150, needs: ['r1', 'r2'], label: 'İn Kapısı' }
    ],

    /* Arena içine mekanizma konmadı: boss dövüşü zaten doğal co-op.
       Ejderha en yakın oyuncuyu hedefliyor, yani biri dikkat çekerken
       diğeri vuruyor (bkz. engine._nearestPlayer). */
    coopLifts: [],

    /* Ejderha Kalkanı — arena girişinde, boss tetiklenmeden önce.
       Yolun tam ortasında durur; kaçırmak neredeyse imkânsız. */
    shield: { x: 2680, y: GROUND_Y },

    boss: {
      triggerX: 2760,
      arenaMinX: 2580,
      arenaMaxX: 3900,
      spawnX: 3450,
      spawnY: 170
    },

    portal: { x: 3840, y: GROUND_Y }
  }
];

/* ==========================================================================
   Bölümü çalışma zamanı nesnesine derle
   ========================================================================== */
export function buildLevel(def) {
  const solids = [];
  const oneWays = [];

  for (const s of def.ground) solids.push({ ...s, kind: 'ground' });
  for (const s of def.platforms) solids.push({ ...s, kind: 'platform' });
  for (const s of (def.oneWay || [])) oneWays.push({ ...s, kind: 'oneway' });

  return {
    def,
    name: def.name,
    subtitle: def.subtitle,
    theme: def.theme,
    width: def.width,
    minX: 0,
    maxX: def.width,
    groundY: GROUND_Y,
    deathY: DEATH_Y,
    solids,          // hareketli/çöken platformlar engine tarafından her kare eklenir
    oneWays,
    staticSolids: solids.slice(),
    staticOneWays: oneWays.slice()
  };
}
