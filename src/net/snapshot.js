/* ==========================================================================
   Anlık Görüntü (Snapshot)

   Host simülasyonu yürütür ve saniyede 20 kez dünyanın özetini yollar.
   Misafir bu özetleri oynatır.

   ÜÇ KURAL:

   1. KISA TUT. Saniyede 20 paket × 2 saat oyun demek. Alan adları tek harf,
      sayılar yuvarlanmış. Okunabilirlik burada bilinçli olarak feda edildi;
      karşılığında paket ~10 kat küçüldü.

   2. MİSAFİR GEÇMİŞİ OYNATIR. Gelen paketler doğrudan ekrana basılmaz,
      100 ms'lik bir tampona konur ve aralarında interpolasyon yapılır.
      Paket kaybı ya da gecikme dalgalanması böylece görünmez olur.
      Bedeli 100 ms gecikme; karşılığı tereyağı gibi hareket.

   3. KENDİ KARAKTERİN İSTİSNA. Misafir kendi tuşlarını ANINDA uygular
      (client-side prediction), sonra host'un dediğiyle karşılaştırır.
      Sapma küçükse yumuşakça düzeltir, büyükse ışınlar. Aksi halde
      kendi karakterin 100 ms gecikmeli hissettirir ve oyun "lastikli" olur.
   ========================================================================== */

import { NET } from '../../server/protocol.js';
import { WOLF_RECOVER, BAT_DIVE } from '../game/entities.js';

const r1 = (v) => Math.round(v);                 // tam sayı
const r2 = (v) => Math.round(v * 100) / 100;     // iki ondalık

/* Boss'un hazırlanmakta olduğu saldırı tek haneli kodla geçiyor.
   0 = yok; sıralama değiştirilirse iki taraf da güncellenmeli. */
const ATTACK_CODES = ['fireball', 'sweep', 'meteor', 'slam'];

/* --------------------------------------------------------------------------
   Serileştirme — host tarafı
   -------------------------------------------------------------------------- */

export function serializeSnapshot(eng, tick) {
  const e = eng.entities;

  /* Misafirin İŞLENMİŞ SON GİRDİ NUMARASI.
     Uzlaştırmanın (reconciliation) can damarı bu: misafir "şu tuşları
     gönderdiğimde neredeydim" bilgisini saklıyor; host da "o tuşları
     işledikten sonra neredesin" diyor. İkisi aynı ANA ait olduğu için
     kıyaslanabiliyor. Bu numara olmadan misafir kendi güncel konumunu
     host'un 140 ms eski konumuyla kıyaslar ve sürekli geri çekilir. */
  return {
    k: tick,
    /* { seq, x, y } — "şu girdiyi aldığımda karakterin şuradaydı".
       Misafir kendi kaydıyla kıyaslayıp gerçek sapmayı buluyor. */
    ak: eng.remoteAck || null,
    st: eng.state,
    lv: eng.lives,
    hp: eng.hearts,
    li: eng.levelIndex,
    /* Yükleme sayacı — "host bölümü (yeniden) yükledi" sinyali */
    rs: eng.loadSerial || 0,

    /* Açılan hatıraların indeksleri.
       Kalp toplama kararı host'ta veriliyor; misafir bu listeyi almazsa
       oyunun DUYGUSAL YÜKÜ olan hatıra kartlarını hiç görmüyor ve final
       ekranına hatırasız giriyordu. Teklifi alan kişi o — en az görmesi
       gereken kişi değil. En fazla üç sayı, maliyeti yok. */
    sy: eng.storyUnlocked,

    /* Oyuncular
       at/sd/ck/af olmadan misafir yoldaşının kılıç savurduğunu ya da yay
       gerdiğini HİÇ görmüyordu: bu zamanlayıcılar yalnızca host'ta işliyor,
       ağdan geçmedikleri için karşı taraf sürekli boş elle koşuyordu. */
    p: eng.players.map(p => ({
      x: r1(p.x), y: r1(p.y),
      vx: r1(p.vx), vy: r1(p.vy),
      f: p.facing,
      s: p.state,
      d: p.downed ? 1 : 0,
      rv: r2(p.reviveProgress),
      iv: r2(Math.max(0, p.invuln)),
      sh: p.hasShield ? 1 : 0,
      bl: r2(p.blockAmount),
      at: r2(Math.max(0, p.attackTimer)),
      ck: p.comboStep ? 1 : 0,
      sd: r2(Math.max(0, p.shootTimer)),
      af: p.arrowFired ? 1 : 0
    })),

    /* Düşmanlar — yalnızca yaşayanlar, indeksleriyle.
       `c` ve `tg` hazırlık hareketlerini taşıyor: misafir bunları görmezse
       kurdun çöktüğünü, yarasanın gerildiğini, büyücünün şarj ettiğini
       fark etmiyor ve düşmanlar ona uyarısız saldırıyormuş gibi oluyor. */
    en: e.enemies.map(packEnemy),

    /* Mermiler ve oklar — kısa ömürlü, tam liste gönderilir.
       `t` tür kodu: boyut ve renk misafirde bu koddan yeniden kuruluyor.
       Eskiden yalnızca konum gönderiliyordu; misafirde size/color tanımsız
       kalıyor ve çizim NaN yarıçaplı gradyanla çöküyordu. */
    pr: e.projectiles.map(p => ({
      x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy),
      t: p.kind ?? 0, df: p.deflected ? 1 : 0
    })),
    ar: e.arrows.map(a => ({
      x: r1(a.x), y: r1(a.y), vx: r1(a.vx), vy: r1(a.vy),
      s: a.stuck ? 1 : 0, an: r2(a.angle), st: r2(a.stuckTimer)
    })),

    /* Toplananlar — bit maskesi. 19 kalp için 19 bit, tek sayıya sığıyor. */
    hc: packCollected(e.hearts),
    oc: packCollected(e.lifeOrbs),
    sc: e.shieldPickup && e.shieldPickup.collected ? 1 : 0,

    /* --- Kontrol noktası ve doğuş yeri ---
       Kontrol noktalarını host çözüyor; misafir o kodu hiç çalıştırmıyor.
       Bu iki alan gitmezse misafirin `spawnPoint`'i BÖLÜM BAŞINDA kalıyor
       ve ölümden sonra kendi karakterini bölümün başına ışınlıyor. Host
       ise son kontrol noktasına koyuyor. Aradaki fark uzlaştırmayı sert
       düzeltmeye zorluyor: diriliş anında karakter bir uçtan bir uca
       savruluyordu. Ayrıca misafirin ekranında kontrol noktaları hiç
       yanmıyordu. */
    cs: packActivated(e.checkpoints),
    sp: [r1(eng.spawnPoint.x), r1(eng.spawnPoint.y)],

    /* Co-op mekanizmaları */
    pl: e.plates.map(p => (p.active ? 1 : 0) | (p.locked ? 2 : 0)),
    ga: e.gates.map(g => r2(g.open) + (g.latched ? 1000 : 0)),
    lf: e.coopLifts.map(l => r1(l.y)),

    /* Hareketli/çöken platformlar — faz senkronu için */
    mp: e.movingPlatforms.map(m => ({ x: r1(m.x), y: r1(m.y) })),
    cr: e.crumbles.map(c => ({ y: r1(c.y), p: c.phase, s: c.solid ? 1 : 0 })),

    /* Boss
       Hazırlık (telegraph) bilgisi de geçmek zorunda: saldırıyı okumak
       oyunun savunma mekaniği. Misafir bunu görmezse ejderha ona hâlâ
       uyarısız saldıran bir şey gibi görünür. */
    bo: eng.boss && eng.boss.alive ? {
      x: r1(eng.boss.x), y: r1(eng.boss.y),
      f: eng.boss.facing ?? 1,
      h: eng.boss.hp,
      s: eng.boss.state,
      v: eng.boss.vulnerable ? 1 : 0,
      dy: eng.boss.dying ? 1 : 0,
      dt: r2(eng.boss.deathTimer || 0),
      hf: r2(Math.max(0, eng.boss.hurtFlash || 0)),
      iv: r2(Math.max(0, eng.boss.invuln || 0)),
      tg: r2(eng.boss.telegraph || 0),
      na: ATTACK_CODES.indexOf(eng.boss.nextAttack) + 1,
      wr: r2(eng.boss.wingRaise || 0),
      ls: r2(eng.boss.landShock || 0),
      sl: r2(eng.boss.slamCharge || 0),
      hb: r1(eng.boss.headBob || 0),
      hs: r2(Math.max(0, eng.boss.headShake || 0)),
      mg: r2(eng.boss.mouthGlow || 0),
      lane: r1(eng.boss.sweepLaneY || 0)
    } : null,

    /* Geçit */
    po: e.portal ? (e.portal.open ? 1 : 0) : 0
  };
}

/* --------------------------------------------------------------------------
   Düşman hazırlık hareketleri

   Üç evre (çökme / saldırı / toparlanma) TEK sayıya sığıyor:

       -1 .. 0   çökme, hazırlık ilerlemesi  (değer = -windup)
        0 .. 1   saldırı ilerlemesi          (sıçrama ya da dalış)
        1 .. 2   toparlanma                  (değer = 1 + kalan oran)

   Ayrı alanlar açmak paket başına düşman sayısı kadar sayı eklerdi; bu
   oyun mobil veriyle de oynanıyor ve anlık görüntü 20 Hz gidiyor.
   -------------------------------------------------------------------------- */

function packEnemy(en) {
  const out = {
    i: en.id, x: r1(en.x), y: r1(en.y),
    f: en.facing ?? en.dir ?? 1,
    a: en.alive ? 1 : 0, dy: en.dying ? 1 : 0,
    c: r2(en.charging ?? en.aggro ?? 0),
    tg: r2(encodeTelegraph(en))
  };
  /* Dalıştaki yarasanın izi hız vektöründen çiziliyor; yalnızca o anda
     gerekiyor, sürekli taşımanın anlamı yok. */
  if (en.diving) { out.vx = r1(en.vx || 0); out.vy = r1(en.vy || 0); }
  return out;
}

function encodeTelegraph(en) {
  if (en.windup > 0) return -Math.min(1, en.windup);
  if (en.leap > 0) return Math.min(1, en.leap);
  if (en.recover > 0) return 1 + Math.min(1, en.recover / WOLF_RECOVER);
  if (en.diving) return Math.max(0.02, Math.min(1, 1 - (en.diveTimer || 0) / BAT_DIVE));
  return 0;
}

function applyTelegraph(en, tg = 0) {
  en.windup = tg < 0 ? -tg : 0;
  const atk = tg > 0 ? tg : 0;
  if (en.type === 'walker') {
    en.leap = atk > 0 && atk <= 1 ? atk : 0;
    en.recover = atk > 1 ? (atk - 1) * WOLF_RECOVER : 0;
    /* Zıplama yüksekliği konumdan zaten geliyor; buradaki `hop` yalnızca
       gölgenin küçülmesi için — host'takiyle aynı formülle türetiliyor. */
    en.hop = en.leap > 0 ? Math.sin(en.leap * Math.PI) * 30 : 0;
  } else if (en.type === 'flyer') {
    en.diving = atk > 0;
  }
}

function packCollected(list) {
  let bits = 0;
  for (let i = 0; i < list.length && i < 31; i++) if (list[i].collected) bits |= (1 << i);
  return bits;
}

function packActivated(list) {
  let bits = 0;
  for (let i = 0; i < list.length && i < 31; i++) if (list[i].activated) bits |= (1 << i);
  return bits;
}

function applyActivated(list, bits) {
  for (let i = 0; i < list.length && i < 31; i++) {
    if ((bits & (1 << i)) && !list[i].activated) list[i].activate?.();
  }
}

function applyCollected(list, bits) {
  for (let i = 0; i < list.length && i < 31; i++) {
    const should = !!(bits & (1 << i));
    if (should && !list[i].collected) list[i].collected = true;
  }
}

/* --------------------------------------------------------------------------
   Uygulama — misafir tarafı
   -------------------------------------------------------------------------- */

/**
 * @param eng          misafirin motoru
 * @param snap         interpolasyonla harmanlanmış anlık görüntü
 * @param localIndex   misafirin kendi karakteri (tahmin edilir, ışınlanmaz)
 */
export function applySnapshot(eng, snap, localIndex = 1) {
  if (!snap) return;

  /* --- DÜNYA KUŞAĞI (`rs`) — bölüm yükleme host'un kararı ---

     `rs` host'un kaçıncı kez bölüm yüklediğini sayar. Misafir kendi
     sayacını TUTMAZ; tek yetkili bu sayı.

     İki ayrı hata buna bağlıydı:

     1. Canlar bitip bölüm baştan başladığında toplanan kalpler geri gelir.
        Ağda toplanma bilgisi yalnızca "toplandı" yönünde taşınıyor, bu
        sinyal olmadan misafir kalpsiz bir bölümde dolaşıyordu.

     2. BAYAT PAKET DÜŞMANLARI SİLİYORDU. Tampon 100 ms geçmişi oynatıyor;
        bölüm değişiminde eski dünyaya ait paketler hâlâ içeride. O
        paketlerde yeni bölümün düşmanları yok, `applySnapshot` da
        "listede yoksa ölmüştür" diyerek hepsini siliyordu. Silinen düşman
        bir daha geri gelmiyor (bu fonksiyon düşman YARATAMAZ, yalnızca
        günceller) — misafir bomboş bir bölümde kalıyordu.

     Bu yüzden karşılaştırma EŞİTLİK değil SIRA: eski kuşak atılır, yeni
     kuşak bölümü yükletir. */
  if (snap.rs !== undefined) {
    if (eng._netLoadSerial === undefined) {
      /* İlk paket: mevcut dünyayı kabul et — AMA bölüm aynı değilse yükle.
         Oyun ortasında yeniden bağlanan misafir host'un bulunduğu bölümde
         olmayabiliyor; sayacı sorgusuz benimserse bir daha hiç yüklemiyor
         ve yanlış bölümde, düşmansız takılı kalıyordu. */
      eng._netLoadSerial = snap.rs;
      if (snap.li !== undefined && snap.li !== eng.levelIndex) {
        eng.loadLevel(snap.li);
        return;
      }
    } else if (snap.rs < eng._netLoadSerial) {
      return;                                // geçmiş bir dünyaya ait — yoksay
    } else if (snap.rs > eng._netLoadSerial) {
      eng._netLoadSerial = snap.rs;
      eng.loadLevel(snap.li ?? eng.levelIndex);
      return;                                // taze bölüm; sonraki paket doldurur
    }
  }

  const e = eng.entities;

  eng.lives = snap.lv;
  eng.hearts = snap.hp;

  /* --- Hatıralar ---
     Yeni açılan her hatıra misafirde de kartını göstersin. `onStory`
     gameView'de motoru duraklatıp kartı açıyor; bu duraklatma YEREL
     sayılıyor, yani host'un kendi kartı kapanınca misafirinki zorla
     kapanmıyor (bkz. engine.pause('local' | 'net')). */
  if (Array.isArray(snap.sy)) {
    for (const idx of snap.sy) {
      if (eng.storyUnlocked.includes(idx)) continue;
      eng.storyUnlocked.push(idx);
      eng.cb?.onStory?.(idx);
    }
  }

  /* --- Oyuncular --- */
  snap.p.forEach((s, i) => {
    const p = eng.players[i];
    if (!p) return;

    p.facing = s.f;
    p.hasShield = !!s.sh;
    p.blockAmount = s.bl;
    p.downed = !!s.d;
    p.reviveProgress = s.rv;
    p.invuln = s.iv;

    if (i !== localIndex) {
      /* Yoldaşın silah animasyonları host'un saatinden gelir. Yerel karakterde
         bunlara DOKUNULMAZ: kendi kılıcın anında tepki vermeli, 100 ms'lik
         interpolasyon tamponunun gerisinden değil. */
      if (s.at !== undefined) p.attackTimer = s.at;
      if (s.ck !== undefined) p.comboStep = s.ck;
      if (s.sd !== undefined) p.shootTimer = s.sd;
      if (s.af !== undefined) p.arrowFired = !!s.af;
    }

    if (i === localIndex) {
      /* ------------------------------------------------------------------
         KENDİ KARAKTERİM — KONUMA DOKUNMA

         Burada konumu düzeltmek, her karede 140 ms eski bir hedefe doğru
         çekmek demekti: tahmin ileri iterken düzeltme geri çekiyordu ve
         karakter yerinde titreyip duruyordu ("hareket edemiyorum").

         Konum uzlaştırması artık YALNIZCA yeni bir anlık görüntü geldiğinde
         ve GİRDİ ONAYI (ack) üzerinden yapılıyor → reconcileLocal().
         Burada sadece host'un tekelinde olan durumlar aktarılıyor.
         ------------------------------------------------------------------ */
      if (s.s === 'dead' || s.d) {
        /* Ölüm ve yere serilme host'un kararı — bunlar tahmin edilmez */
        p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0;
        p.state = s.s;
      }
    } else {
      /* Yoldaşımın karakteri: tamamen host'tan. Zaten interpolasyon
         tamponundan geldiği için yumuşak. */
      p.x = s.x; p.y = s.y;
      p.vx = s.vx; p.vy = s.vy;
      p.state = s.s;
    }
  });

  /* --- Düşmanlar --- */
  const byId = new Map(e.enemies.map(en => [en.id, en]));
  for (const s of snap.en) {
    const en = byId.get(s.i);
    if (!en) continue;
    en.x = s.x; en.y = s.y;
    if (s.f !== undefined) {
      /* Kurt yönünü `dir`, büyücü `facing` ile tutuyor; yanlış alana yazmak
         misafirde bütün kurtların sabit yöne bakması demekti. */
      if (en.dir !== undefined) en.dir = s.f; else en.facing = s.f;
    }
    if (s.c !== undefined) {
      if (en.charging !== undefined) en.charging = s.c;
      if (en.aggro !== undefined) en.aggro = s.c;
    }
    applyTelegraph(en, s.tg);
    if (s.vx !== undefined) { en.vx = s.vx; en.vy = s.vy ?? 0; }
    en.dying = !!s.dy;
    if (!s.a) en.alive = false;
  }
  /* Host'un listesinden düşen düşman ölmüştür — ama misafirde ölüm
     animasyonu OYNAMALI. Anında silmek düşmanların tek karede yok olmasına
     yol açıyordu; `dying` işaretleyip yerel görsel saate bırakıyoruz. */
  const liveIds = new Set(snap.en.map(s => s.i));
  for (const en of e.enemies) {
    if (liveIds.has(en.id) || en.dying) continue;
    en.dying = true;
    en.deathTimer = 0;
  }
  e.enemies = e.enemies.filter(en => en.alive);

  /* --- Mermiler / oklar: listeyi host'unkine eşitle --- */
  syncList(e.projectiles, snap.pr, hydrateProjectile);
  syncList(e.arrows, snap.ar, hydrateArrow);

  /* --- Toplananlar --- */
  applyCollected(e.hearts, snap.hc);
  applyCollected(e.lifeOrbs, snap.oc);
  if (snap.sc && e.shieldPickup) e.shieldPickup.collected = true;

  /* --- Kontrol noktası + doğuş yeri (host'un kararı) --- */
  if (snap.cs !== undefined) applyActivated(e.checkpoints, snap.cs);
  if (snap.sp) { eng.spawnPoint.x = snap.sp[0]; eng.spawnPoint.y = snap.sp[1]; }

  /* --- Co-op mekanizmaları --- */
  e.plates.forEach((p, i) => {
    const v = snap.pl[i] ?? 0;
    p.active = !!(v & 1);
    p.locked = !!(v & 2);
  });
  e.gates.forEach((g, i) => {
    const v = snap.ga[i];
    if (v === undefined) return;
    g.latched = v >= 1000;
    g.open = g.latched ? v - 1000 : v;
  });
  e.coopLifts.forEach((l, i) => {
    const y = snap.lf[i];
    if (y === undefined) return;
    l.dy = y - l.y;
    l.y = y;
  });

  /* --- Platformlar --- */
  e.movingPlatforms.forEach((m, i) => {
    const s = snap.mp[i];
    if (!s) return;
    m.dx = s.x - m.x; m.dy = s.y - m.y;
    m.x = s.x; m.y = s.y;
  });
  e.crumbles.forEach((c, i) => {
    const s = snap.cr[i];
    if (!s) return;
    c.y = s.y; c.phase = s.p; c.solid = !!s.s;
  });

  /* --- Boss ---
     Ejderha misafirde de VAR OLMAK zorunda. Yapay zekâsı host'ta koşuyor
     ama nesne yoksa anlık görüntüdeki veriyi yazacak yer olmuyor ve misafir
     görünmez bir ejderhayla dövüşüyor. */
  if (snap.bo) {
    const b = eng.boss || eng.spawnBoss?.();
    if (b) applyBoss(b, snap.bo);
  } else if (eng.boss && eng.boss.alive && eng.boss.dying) {
    /* Host artık boss yollamıyorsa ölüm tamamlanmış demektir */
    eng.boss.alive = false;
  }

  if (e.portal) e.portal.open = !!snap.po;

  /* Misafirin HUD'u yalnızca burada tazelenebiliyor: _stepPlaying misafirde
     erken dönüyor, dolayısıyla can/kalp/boss canı ağdan gelenle güncellenmezse
     ekranda donuk kalıyor. */
  const sig = `${snap.lv}|${snap.hp}|${snap.bo ? snap.bo.h : '-'}|${snap.p.map(p => `${p.d}${p.sh}`).join('')}`;
  if (eng._hudSig !== sig) {
    eng._hudSig = sig;
    eng._emitHud?.();
  }
}

/**
 * Ejderhanın ağdan gelen durumunu uygula.
 *
 * `vulnerable` BİLEREK atanmıyor: boss.js'te türetilmiş bir özellik
 * (`state === 'tired'`) ve yalnızca getter'ı var. Üzerine yazma denemesi
 * sıkı modda TypeError atıyor, yani ejderha sahneye çıktığı anda misafirin
 * anlık görüntü uygulaması komple çöküyordu. Durumu yazmak yeterli.
 */
function applyBoss(b, s) {
  b.x = s.x;
  b.y = s.y;
  b.facing = s.f;
  b.hp = s.h;
  b.dying = !!s.dy;
  b.deathTimer = s.dt ?? 0;
  b.hurtFlash = s.hf ?? 0;
  b.invuln = s.iv ?? 0;
  b.headShake = s.hs ?? 0;
  if (b.state !== s.s && b._setState) b._setState(s.s);
  b.telegraph = s.tg ?? 0;
  b.nextAttack = s.na ? ATTACK_CODES[s.na - 1] : null;
  b.wingRaise = s.wr ?? 0;
  b.landShock = s.ls ?? 0;
  b.slamCharge = s.sl ?? 0;
  b.headBob = s.hb ?? 0;
  b.mouthGlow = s.mg ?? 0;
  if (s.lane) b.sweepLaneY = s.lane;
}

/* --------------------------------------------------------------------------
   Mermi türleri

   Ağdan yalnızca tek haneli bir tür kodu geçiyor; boyut ve renk misafirde
   bu tablodan kuruluyor. Renk/boyut alanlarını paket başına taşımanın
   anlamı yok — üç çeşit mermi var ve hiçbiri oyun ortasında değişmiyor.
   -------------------------------------------------------------------------- */
export const PROJECTILE_KINDS = [
  { kind: 0, color: '#a76bff', size: 7 },   // büyücü büyüsü
  { kind: 1, color: '#ff7a2a', size: 9 },   // ejderha ateş topu
  { kind: 2, color: '#ff5a20', size: 8 }    // gökten ateş yağmuru
];

function hydrateProjectile(o, s) {
  const spec = PROJECTILE_KINDS[s.t] || PROJECTILE_KINDS[0];
  o.kind = spec.kind;
  o.size = spec.size;
  o.w = o.h = spec.size * 2;
  o.deflected = !!s.df;
  o.color = o.deflected ? '#ffd76b' : spec.color;
}

function hydrateArrow(o, s) {
  o.w = 18; o.h = 6;
  o.stuck = !!s.s;
  /* Saplanmış okun hızı sıfır olduğu için açı vx/vy'den türetilemez;
     bu yüzden açı paketle birlikte geliyor. */
  o.angle = Number.isFinite(s.an) ? s.an : Math.atan2(s.vy ?? 0, s.vx ?? 1);
  o.stuckTimer = Number.isFinite(s.st) ? s.st : 0;
  o.dir = (s.vx ?? 0) < 0 ? -1 : 1;
}

/* --------------------------------------------------------------------------
   Uzlaştırma (reconciliation) — kendi karakterim

   Nasıl çalışıyor:

     1. Misafir her girdi paketini yollarken o anki konumunu kaydediyor:
        pending = [{ seq: 41, x: 300, y: 476 }, ...]
     2. Host o girdiyi işleyip anlık görüntüye "ack: 41" koyuyor.
     3. Misafir 41 numaralı kaydını buluyor: "41'i yolladığımda 300'deydim".
        Host "41'i işledikten sonra 302'desin" diyor → hata 2px.
     4. Hata güncel konuma uygulanıyor.

   İki taraf da AYNI ANA ait olduğu için gecikme denkleme girmiyor.
   Bu olmadan misafir güncel konumunu host'un 140 ms eski konumuyla
   kıyaslıyor, sapmayı hata sanıp karakteri geri sürüklüyordu — oyuncunun
   "hareket edemiyorum" dediği şey buydu.
   -------------------------------------------------------------------------- */

export function reconcileLocal(eng, snap, localIndex, pending) {
  if (!snap || !pending || pending.length === 0) return null;
  const ak = snap.ak;
  if (!ak || !ak.seq) return null;

  const p = eng.players[localIndex];
  /* --------------------------------------------------------------------
     ÖLÜYKEN / YERDEYKEN DE KAYITLARI TEMİZLE.

     Konumu düzeltmiyoruz — o an karakteri host yönetiyor. Ama bekleyen
     girdi kayıtlarını BIRAKIP çıkmak sessiz bir arızaya yol açıyordu:

       · Yere serilme 14 saniyeye kadar sürüyor (DOWN_TIMEOUT).
       · `onInputTick` bu süre boyunca saniyede 60 kayıt eklemeye devam ediyor.
       · Liste 2 saniyede 120'lik tavana dayanıyor ve EN ESKİ kayıt atılıyor.
       · Atılan kayıt çoğu zaman onayın (ack) denk geldiği kayıt oluyor.
       · Kaldırıldıktan sonra `rec.seq !== ak.seq` tutuyor ve uzlaştırma
         null dönüyor — yani karakter tam da konumun önemli olduğu anda,
         diriliş anında, düzeltmesiz kalıyor.

     Gerçek bir oturumun teşhis panelinde bu "bekleyen: 120" olarak
     görünüyordu: sayaç tavana yapışmıştı ve orada kalıyordu.

     Duraklatma dalı (aşağıda) bunu zaten doğru yapıyordu; buradaki eksikti.
     -------------------------------------------------------------------- */
  if (!p || p.dead || p.downed) {
    while (pending.length && pending[0].seq <= ak.seq) pending.shift();
    return null;
  }

  /* Duraklatılmışken uzlaştırma YAPILMAZ.
     Misafir duraklamışken tahmin yürütmüyor ama host onun son tuşlarıyla
     karakteri ilerletmeye devam edebiliyor. Böyle bir anda düzeltmeyi
     uygulamak, misafirin ekranında kontrol edemediği bir karakterin
     kendi kendine kaymasına yol açıyordu. Bekleyen kayıtları temizleyip
     çıkıyoruz ki devam edince bayat bir onayla uzlaşmayalım. */
  if (eng.state === 'paused') {
    while (pending.length && pending[0].seq <= ak.seq) pending.shift();
    return null;
  }

  /* Onaylanan girdiye ait kaydı bul, daha eskilerini at */
  let rec = null;
  while (pending.length && pending[0].seq <= ak.seq) rec = pending.shift();
  if (!rec || rec.seq !== ak.seq) return null;

  /* İki konum da "N-1'e kadar işlenmiş" durumuna ait — doğrudan kıyaslanır */
  const ex = ak.x - rec.x;
  const ey = ak.y - rec.y;
  const err = Math.hypot(ex, ey);

  if (err < 5) return err;          // yuvarlama gürültüsü

  if (err > 160) {
    /* Büyük fark = gerçek bir olay (kapı çarpması, ışınlanma, geri tepme).
       Host'un GÜNCEL konumuna sert geç. */
    const s = snap.p?.[localIndex];
    if (s) { p.x = s.x; p.y = s.y; p.vx = s.vx; p.vy = s.vy; }
  } else {
    /* Küçük fark: hatayı güncel konuma yumuşakça ekle. Anlık görüntü
       başına bir kez (saniyede 20), her karede değil — yoksa düzeltme
       hareketin önüne geçiyor. */
    p.x += ex * 0.35;
    p.y += ey * 0.35;
  }
  return err;
}

/**
 * Basit liste eşitleme — sayı farkını kırpar/doldurur.
 *
 * `hydrate` çizim için gereken görsel alanları (boyut, renk, açı) tamamlar.
 * Bunlar olmadan misafirde `pr.size` tanımsız kalıyor, `drawProjectile`
 * NaN yarıçaplı bir gradyan kurmaya çalışıp istisna atıyor ve o karenin
 * geri kalanı — parçacıklar, ışıklar, ekran dışı okları — hiç çizilmiyordu.
 */
function syncList(list, incoming, hydrate) {
  while (list.length > incoming.length) list.pop();
  for (let i = 0; i < incoming.length; i++) {
    const s = incoming[i];
    if (!list[i]) { list[i] = { alive: true, w: 12, h: 12, animTime: 0 }; }
    Object.assign(list[i], { x: s.x, y: s.y, vx: s.vx ?? 0, vy: s.vy ?? 0, alive: true });
    if (s.s !== undefined) list[i].stuck = !!s.s;
    if (hydrate) hydrate(list[i], s);
    if (list[i].cx === undefined) {
      Object.defineProperty(list[i], 'cx', { get() { return this.x + this.w / 2; }, configurable: true });
      Object.defineProperty(list[i], 'cy', { get() { return this.y + this.h / 2; }, configurable: true });
    }
  }
}

/* --------------------------------------------------------------------------
   İnterpolasyon Tamponu

   Gelen paketler zaman damgalarıyla saklanır ve oynatma kafası GERÇEK
   ZAMANDAN 100 ms GERİDE tutulur. Böylece her an elimizde "öncesi" ve
   "sonrası" paketi olur ve aradaki değerleri hesaplayabiliriz.
   -------------------------------------------------------------------------- */

export class SnapshotBuffer {
  constructor(delayMs = NET.INTERP_DELAY_MS) {
    this.baseDelay = delayMs;
    this.maxDelay = delayMs * 3.5;
    this.delay = delayMs;
    this.buf = [];          // { at, snap }
    this.maxSize = 60;
    this.lastServed = null;

    /* Uyarlanabilir gecikme için ağ ölçümleri */
    this.lastArrival = null;
    this.gapAvg = 1000 / NET.SNAPSHOT_HZ;
    this.jitter = 0;
    this.maxExtrapolate = 90;   // ms — bunun ötesinde tahmin etmek yanıltıcı
    this.lastTick = null;
    this.outOfOrder = 0;        // atılan geç paket sayısı (teşhis için)
  }

  push(snap, at = performance.now()) {
    /* --------------------------------------------------------------------
       SIRASIZ PAKETİ AT

       Gecikme dalgalanması paketlerin sırasını bozabiliyor: 12 numaralı
       paket 11'den önce gelebiliyor. Tampon varış sırasına göre dizildiği
       için bu, iki eski kare arasında interpolasyon yapılmasına ve
       yoldaşın BİR AN GERİ SARMASINA yol açıyordu — oyuncunun gördüğü
       "ışınlanma" tam olarak buydu.

       Çözüm en basiti: geç kalan paketi yok say. Zaten 50 ms sonra
       yenisi gelecek; eskisini işlemenin hiçbir faydası yok.
       -------------------------------------------------------------------- */
    if (snap.k !== undefined) {
      if (this.lastTick !== null && snap.k <= this.lastTick) { this.outOfOrder++; return; }
      this.lastTick = snap.k;
    }

    /* --------------------------------------------------------------------
       UYARLANABİLİR TAMPON

       Sabit 100 ms tampon iyi ağda mükemmel, kötü ağda yetersiz: gecikme
       dalgalanması tamponu aşınca oynatma kafası en yeni paketin ötesine
       geçiyor, donuyor ve sonraki paket gelince sıçrıyor. Oyuncu bunu
       "yoldaşım ışınlanıyor" diye hissediyor.

       Çözüm: paketler arası boşluğun DALGALANMASINI ölç, tamponu ona göre
       büyüt. Kötüleşmeye hızlı tepki ver (donma olmasın), iyileşmeye yavaş
       (gecikme boşuna artıp durmasın).
       -------------------------------------------------------------------- */
    if (this.lastArrival !== null) {
      const gap = at - this.lastArrival;
      this.gapAvg += (gap - this.gapAvg) * 0.12;
      const dev = Math.abs(gap - this.gapAvg);
      this.jitter += (dev - this.jitter) * (dev > this.jitter ? 0.45 : 0.03);
    }
    this.lastArrival = at;

    const want = Math.min(this.maxDelay, this.baseDelay + this.jitter * 2.2);
    /* Gecikmeyi yumuşak değiştir; ani değişim zaman atlaması demek */
    this.delay += (want - this.delay) * (want > this.delay ? 0.12 : 0.02);

    this.buf.push({ at, snap });
    if (this.buf.length > this.maxSize) this.buf.shift();
  }

  /** Oynatılacak anlık görüntüyü üret (iki paket arası harmanlanmış) */
  sample(now = performance.now()) {
    if (this.buf.length === 0) return null;
    const target = now - this.delay;

    /* Hedef en eskiden de eskiyse (yeni bağlandık) ilk paketi ver */
    if (target <= this.buf[0].at) { this.lastServed = this.buf[0].snap; return this.buf[0].snap; }

    /* Hedef en yeni paketten de ileriyse paket gecikmiş demektir.
       Burada DONDURMAK en kötü seçenek: yoldaş bir an duruyor, paket
       gelince sıçrıyor. Onun yerine kısa bir süre (≤90 ms) son bilinen
       HIZLA devam ettiriyoruz — "ölü hesap" (dead reckoning).
       Sınırlı tutuyoruz çünkü uzun tahmin duvara girmiş bir karakteri
       duvarın içinde yürütür. */
    const last = this.buf[this.buf.length - 1];
    if (target >= last.at) {
      const ahead = target - last.at;
      const snap = ahead <= this.maxExtrapolate
        ? extrapolate(last.snap, ahead / 1000)
        : last.snap;
      this.lastServed = snap;
      return snap;
    }

    let i = 0;
    while (i < this.buf.length - 2 && this.buf[i + 1].at < target) i++;
    const a = this.buf[i], b = this.buf[i + 1];
    const span = b.at - a.at;
    const alpha = span > 0 ? (target - a.at) / span : 1;

    const blended = blend(a.snap, b.snap, alpha, span);
    this.lastServed = blended;
    return blended;
  }

  get depth() { return this.buf.length; }
  clear() { this.buf.length = 0; }
}

/**
 * Ölü hesap: son bilinen hızla kısa süre ileri taşı.
 * Sadece oyuncular ve boss — düşmanların hız bilgisi taşınmıyor ve
 * devriye hareketleri zaten yavaş, donmaları göze batmıyor.
 */
function extrapolate(snap, dt) {
  const cap = 40;   // px — tek seferde bu kadardan fazla tahmin etme
  const step = (v) => Math.max(-cap, Math.min(cap, v * dt));
  const out = { ...snap };
  out.p = snap.p.map(p => ({
    ...p,
    x: p.x + step(p.vx || 0),
    y: p.y + step(p.vy || 0)
  }));
  if (snap.bo) out.bo = { ...snap.bo };
  return out;
}

/**
 * İki anlık görüntüyü karıştır — sadece konumlar, durumlar b'den alınır.
 *
 * IŞINLANMA İNTERPOLE EDİLMEZ. Ölüp yeniden doğan bir karakter iki paket
 * arasında haritanın öbür ucuna atlıyor; aradaki değerleri hesaplamak onu
 * hiç bulunmadığı yerlerden GEÇİREREK süzülüyormuş gibi gösteriyordu.
 * Sıçrama, geçen süreyle mümkün olan mesafeyi aşıyorsa harmanlamayı bırakıp
 * doğrudan yeni konuma geçiyoruz.
 */
function blend(a, b, t, spanMs = 1000 / NET.SNAPSHOT_HZ) {
  const lerp = (x, y) => x + (y - x) * t;
  /* Fizikle ulaşılabilir azami mesafe + ölçüm payı. Serbest düşüş en hızlı
     hareket; bunun üstü ancak ışınlanmayla olur. */
  const maxStep = 60 + 1400 * (Math.max(16, spanMs) / 1000);
  const teleported = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay) > maxStep;
  const out = { ...b };

  out.p = b.p.map((pb, i) => {
    const pa = a.p[i];
    if (!pa) return pb;
    /* Ölüm/diriliş sınırında konum host'un kararı; harmanlanmaz */
    if (pa.s !== pb.s && (pa.s === 'dead' || pb.s === 'dead')) return pb;
    if (teleported(pa.x, pa.y, pb.x, pb.y)) return pb;
    return { ...pb, x: lerp(pa.x, pb.x), y: lerp(pa.y, pb.y) };
  });

  const idx = new Map(a.en.map(e => [e.i, e]));
  out.en = b.en.map(eb => {
    const ea = idx.get(eb.i);
    if (!ea || teleported(ea.x, ea.y, eb.x, eb.y)) return eb;
    return { ...eb, x: lerp(ea.x, eb.x), y: lerp(ea.y, eb.y) };
  });

  out.mp = b.mp.map((mb, i) => {
    const ma = a.mp[i];
    return ma ? { x: lerp(ma.x, mb.x), y: lerp(ma.y, mb.y) } : mb;
  });

  out.lf = b.lf.map((yb, i) => {
    const ya = a.lf[i];
    return ya === undefined ? yb : lerp(ya, yb);
  });

  out.ga = b.ga.map((gb, i) => {
    const ga = a.ga[i];
    if (ga === undefined) return gb;
    /* Kilitli bayrağı (1000+) interpolasyona sokma */
    if (gb >= 1000 || ga >= 1000) return gb;
    return lerp(ga, gb);
  });

  if (a.bo && b.bo) {
    out.bo = teleported(a.bo.x, a.bo.y, b.bo.x, b.bo.y)
      ? { ...b.bo }
      : { ...b.bo, x: lerp(a.bo.x, b.bo.x), y: lerp(a.bo.y, b.bo.y) };
  }

  return out;
}
