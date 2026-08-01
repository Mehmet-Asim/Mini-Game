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
/* Yeniden oynatma, host'un girdi uygularken kullandığı sınıfın AYNISINI
   kullanıyor — zıplama tamponu, kenar tetiği, eksen hesabı birebir aynı
   olsun diye. Ayrı bir taklit yazmak iki tarafı sessizce ayırırdı. */
import { RemoteInput } from '../core/input.js';

const r1 = (v) => Math.round(v);                 // tam sayı
const r2 = (v) => Math.round(v * 100) / 100;     // iki ondalık

/* Boss'un hazırlanmakta olduğu saldırı tek haneli kodla geçiyor.
   0 = yok; sıralama değiştirilirse iki taraf da güncellenmeli. */
const ATTACK_CODES = ['fireball', 'sweep', 'meteor', 'slam'];

/* Misafirin tahmini ok isabeti kaç saniye onay bekler?
   Gidiş-dönüş ~265 ms (girdi 70 + host 25 + görüntü 70 + tampon 100);
   0.6 sn rahat pay bırakıyor. Bu süre dolduğunda host hâlâ "yaşıyor"
   diyorsa tahmin ıskalanmıştır ve düşman geri gelir. */
const PREDICT_CONFIRM_SEC = 0.6;

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
      s: a.stuck ? 1 : 0, an: r2(a.angle), st: r2(a.stuckTimer),
      /* Sahibi: misafir KENDİ tahmini okunu host'un onayladığı gerçek okla
         eşleştirip düşürebilsin diye (bkz. applySnapshot altında reconcile). */
      o: a.ownerIndex ?? 0
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

    /* Hareketli platform: KONUM DEĞİL SAAT gönderiliyor.
       Konum göndermek platformu misafirde tampon gecikmesi kadar geride
       bırakıyordu (ölçüldü: ort. 7 px, tepe 44 px). Üstünde duran oyuncu
       host'un bilmediği bir yükseklikte tahmin ediliyor, her anlık görüntü
       onu geri çekiyordu — "platformda titreme" buydu. Hareket saf bir
       zaman fonksiyonu (start + sin(animTime*speed + phase) * range), yani
       misafir saati bilirse konumu BİREBİR kendi hesaplar. */
    mp: e.movingPlatforms.map(m => ({ t: r2(m.animTime) })),
    cr: e.crumbles.map(c => ({ y: r1(c.y), p: c.phase, s: c.solid ? 1 : 0, tm: r2(c.timer), vy: r1(c.vy) })),

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
/**
 * @param delayMs Tamponun kaç ms geçmişi oynattığı (SnapshotBuffer.delay).
 *   Zamanı saf fonksiyon olan nesneleri (hareketli platform) "şimdi"ye
 *   taşımak için gerekiyor — bkz. aşağıdaki platform bölümü.
 */
export function applySnapshot(eng, snap, localIndex = 1, delayMs = NET.INTERP_DELAY_MS) {
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
    /* Öngörülen dokunulmazlığı host'un sıfırıyla ezme — ezersek tahmin
       bir sonraki karede yeniden tetiklenir. Pencere dolunca host'un
       sözü yine geçerli. */
    if (!(i === localIndex && p.predictHurtCd > 0 && (s.iv ?? 0) <= 0)) {
      p.invuln = s.iv;
    }

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

    /* --- Tahmini ölüm: onayla ya da geri al ---
       Misafir kendi okunun isabetini host'tan önce oynatıyor (bkz.
       engine.js → _predictArrowHits). Host hâlâ "yaşıyor" diyorsa
       hemen diriltmiyoruz: paket zaten ~265 ms eski, oku daha görmemiş
       olabilir. Kısa bir onay penceresi tanıyor, dolduğunda geri
       alıyoruz — böylece ıskalanan tahmin kalıcı hayalet bırakmıyor. */
    if (en.predictedDead) {
      /* `deathTimer` tahminden bu yana geçen süreyi zaten tutuyor
         (tickVisuals her karede ilerletiyor) — ayrı sayaç gerekmiyor,
         kare hızından da bağımsız. */
      if (s.dy) { en.predictedDead = false; en.dying = true; }
      else if (en.deathTimer > PREDICT_CONFIRM_SEC) en.revivePredicted();
    } else {
      en.dying = !!s.dy;
    }
    if (!s.a) en.alive = false;
  }
  /* Host'un listesinden düşen düşman ölmüştür — ama misafirde ölüm
     animasyonu OYNAMALI. Anında silmek düşmanların tek karede yok olmasına
     yol açıyordu; `dying` işaretleyip yerel görsel saate bırakıyoruz. */
  const liveIds = new Set(snap.en.map(s => s.i));
  for (const en of e.enemies) {
    if (liveIds.has(en.id)) continue;
    /* Listeden düşmek EN KESİN onaydır: tahmini ölüm gerçekleşmiş demek.
       Bayrağı kaldırmazsak nesne `alive = false` olamaz ve ekranda
       görünmez ama silinmemiş bir düşman sonsuza dek asılı kalır. */
    en.predictedDead = false;
    if (en.dying) continue;
    en.dying = true;
    en.deathTimer = 0;
  }
  e.enemies = e.enemies.filter(en => en.alive);

  /* --- Mermiler / oklar: listeyi host'unkine eşitle ---
     `e.arrows` host'un GERÇEK (~100-250ms geriden gelen) verisi; misafirin
     KENDİ oku bunun yerine `e.predictedArrows`'ta gerçek zamanlı simüle
     ediliyor (bkz. engine.js) ve render bunu ownerIndex'e göre ayırıyor
     (bkz. renderer.js). İkisi arasında EL DEĞİŞTİRME yapılmıyor: host'un
     verisi tampon gecikmesi kadar geride olduğu için tahminden ona geçmek
     okun aniden GERİYE sıçramasına yol açıyordu (ölçüldü: ~150px). Tahmini
     ok kendi fiziğiyle (aynı kod, aynı seviye geometrisi) doğal ömrünü
     tamamlıyor; host'un versiyonu yalnızca dünyanın gerçek defterini tutmak
     için var, misafirin ekranında hiç görünmüyor. */
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

  /* --- Hareketli platformlar: SAATİ kur, konumu misafir kendi hesaplasın ---
     Anlık görüntü `delayMs` kadar geçmişten oynatılıyor (interpolasyon
     tamponu). Platformu o geçmiş ana kurarsak misafirin üstünde durduğu
     zemin host'un bildiğinden farklı yerde olur ve her uzlaştırma oyuncuyu
     geri çeker. Saati tampon gecikmesi kadar İLERİ alıp "şimdi"ye
     getiriyoruz — böylece misafirin ayağının altındaki platform host'un
     hesapladığıyla aynı yerde oluyor.

     Sapma küçükken saate dokunmuyoruz: her pakette saati zorlamak
     hareketi mikro-sıçratıyor. Büyük sapma (sekme/duraklama sonrası)
     tek seferde toparlanıyor. */
  const ahead = Math.max(0, delayMs) / 1000;
  e.movingPlatforms.forEach((m, i) => {
    const s = snap.mp[i];
    if (!s || !Number.isFinite(s.t)) return;
    const want = s.t + ahead;
    const drift = want - m.animTime;
    /* Eşik saniye cinsinden. Daha sıkı denendi (0.06 / 0.18) ve TERS
       TEPTİ: `ahead` tahmini ağ dalgalanmasıyla ±0.05 sn oynadığı için
       eşik o bandın içine girince platform HER pakette zorla hizalanıyor,
       saniyede 20 mikro sıçrama oluyordu (ölçüldü: sıçrayan kare 1 → 110).
       Eşik dalgalanma bandının üstünde kalmalı; normalde yumuşak sürükleme
       çalışır, sert hizalama yalnızca gerçek kopukluklar için devreye
       girer (bölüm açılışı, sekme, duraklama sonrası). */
    if (Math.abs(drift) > 0.25) m.animTime = want;
    else m.animTime += drift * 0.12;                     // yumuşak sürükle
  });

  /* --- Çöken platformlar ---
     Faz ve sayaç host'un; ama misafir bunları KARELER ARASINDA kendi
     ilerletiyor (bkz. engine.js). Burada yalnızca host'un defterine
     hizalıyoruz, yoksa faz saniyede 20 kez basamaklı ilerler ve üstündeki
     oyuncu 50 ms'lik adımlarla düşerdi. */
  e.crumbles.forEach((c, i) => {
    const s = snap.cr[i];
    if (!s) return;

    /* TEK İSTİSNA: misafir kendi ayağının altındaki platformu host'tan
       önce tetikler (girdi host'a ~70 ms sonra varıyor). O aralıkta host
       hâlâ 'idle' der; buna uyup fazı geri almak sarsıntı sayacını her
       karede sıfırlıyor ve platform misafirde bir türlü çökmüyordu.
       Yalnızca bu tek adımlık önden gitmeye izin veriyoruz — host'un
       gerçekten tetiklenmediğini söylediği durum kendini bir sonraki
       fazda zaten düzeltir. */
    const guestLeads = c.phase === 'shake' && s.p === 'idle';
    if (!guestLeads) {
      c.phase = s.p;
      c.solid = !!s.s;
      if (Number.isFinite(s.tm)) c.timer = s.tm;
      if (Number.isFinite(s.vy)) c.vy = s.vy;
      /* Düşerken y'yi host'a zorlamak sıçratıyor; yerel fizik zaten aynı
         ivmeyle sürüyor, sadece belirgin sapmada topluyoruz. */
      if (c.phase !== 'fall' || Math.abs(s.y - c.y) > 24) c.y = s.y;
    }
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
  o.ownerIndex = s.o ?? 0;
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
  /* MİSAFİR ÖNDE GİDİYOR OLABİLİR — tahmini geri alma.
     Misafir hasarı host'tan ~70 ms önce öngörüyor (bkz. engine.js). Bu
     tek yönlü farkı uyuşmazlık sayarsak oyuncuyu geri tepme öncesine
     çeker, dokunulmazlığı sıfırlar, tahmin yeniden tetiklenir ve karakter
     saniyede 20 kez ileri-geri sarsılır. TERS yön (host hasarlı, misafir
     değil) muaf DEĞİL: asıl düzeltmemiz gereken durum o. */
  const guestLeadsHurt = p.predictHurtCd > 0 && (ak.ht ?? 0) <= 0 && p.hurtTimer > 0;
  const hurtMismatch = !guestLeadsHurt &&
    (((ak.ht ?? 0) > 0) !== (p.hurtTimer > 0) || Math.abs((ak.iv ?? 0) - (p.invuln || 0)) > 0.15);

  if (err < 5 && !hurtMismatch) return err;          // yuvarlama gürültüsü ve hasar durumu uyumlu

  /* ------------------------------------------------------------------
     YETKİLİ DURUMA DÖN + BEKLEYEN GİRDİLERİ YENİDEN OYNAT
     ------------------------------------------------------------------ */
  p.x = ak.x;
  p.y = ak.y;
  if (Number.isFinite(ak.vx)) p.vx = ak.vx;
  if (Number.isFinite(ak.vy)) p.vy = ak.vy;
  /* Konum hatası başka bir sebepten büyükse buraya misafir öndeyken de
     girilebiliyor; o durumda tahmini silme. */
  if (!guestLeadsHurt) {
    p.hurtTimer = ak.ht ?? 0;
    p.invuln = ak.iv ?? 0;
  }

  replayPending(eng, p, pending, ak.mt);
  return err;
}

/* --------------------------------------------------------------------------
   Bekleyen girdileri yeniden oynatma

   YAN ETKİ YOK: `player.update` parçacık/kamera/ses kanallarını son üç
   parametreden alıyor ve hepsini `if (particles)` gibi korumalarla
   kullanıyor. Üçünü de null geçince saf fizik çalışıyor — yoksa tek
   zıplama on iki kez toz bulutu üretir, sesler üst üste binerdi.
   -------------------------------------------------------------------------- */

const REPLAY_DT = 1 / 60;
/* Tavan: 40 kare ≈ 0.66 sn. Bunun ötesi zaten kurtarılamayacak kadar
   bayat; sınırsız bırakmak kötü bir ağda kareyi kilitler. */
const MAX_REPLAY = 40;

/* Tek örnek yeniden kullanılıyor — saniyede 20 kez çağrılıyor, çöp üretmesin */
let _replayInput = null;

function replayPending(eng, p, pending, hostPlatformTime) {
  if (!pending.length || !eng.level) return;

  if (!_replayInput) _replayInput = new RemoteInput();
  const inp = _replayInput;
  /* Önceki oynatmadan kalan zıplama/saldırı tamponlarını temizle */
  inp.reset();

  /* Ok yeniden oynatmada DOĞMAZ — gerçek adım zaten doğurdu. Bayrağı
     koruyup geri koyuyoruz, yoksa her düzeltme fazladan ok yaratırdı. */
  const savedArrow = p.pendingArrow;

  const start = Math.max(0, pending.length - MAX_REPLAY);

  /* ------------------------------------------------------------------
     HAREKETLİ PLATFORMLARI DA GERİ SAR

     Eskiden yeniden oynatma yalnızca `eng.level` ile yapılıyordu ve
     hareketli platformlar ŞİMDİKİ konumlarında donuyordu. İki sonucu
     vardı:

       · `player._moveAndCollide` üstünde durulan platformun `dx`'ini
         ekliyor; donmuş `dx` her oynatma karesinde TEKRAR uygulanıyordu.
       · Çarpışma, platformun geçmişteki değil şimdiki yerine karşı
         çözülüyordu.

     Ölçüldü (bölüm 2, 10 karelik oynatma, tek uzlaştırma):

         yatay platform  → oyuncu 9.11 px yana kaydı (beklenen 10.12)
         dikey platform  → ~0 (zemin kelepçesi hayalet taşımayı yutuyor)

     Yatayda kelepçeleyecek bir şey olmadığı için hata doğrudan konuma
     yazılıyordu; uzlaştırma saniyede ~25 kez çalıştığı için de oyuncu
     sürekli yana çekiliyordu ("hareketli bloklarda kayma").

     Konum saf bir `animTime` fonksiyonu olduğundan platformu tam olarak
     geri sarabiliyoruz: oynatma başına alıp kare kare ilerletiyor,
     sonunda gerçek hâline geri koyuyoruz. `_rebuildSolids` şart —
     `level.solids` platform nesnelerini konumlarıyla taşıyor.
     ------------------------------------------------------------------ */
  const platforms = eng.entities?.movingPlatforms || [];
  const saved = platforms.map(m => ({ m, animTime: m.animTime, x: m.x, y: m.y, dx: m.dx, dy: m.dy }));
  const frames = pending.length - start;
  /* Tercihen HOST'un saatiyle geri sar (onayla geliyor, bkz. engine.js →
     ack.mt). Misafirin kendi saati yumuşak sürüklemeyle host'unkinden
     0.25 sn'ye kadar ayrılabiliyor; onunla sarmak yeniden oynatmayı
     YANLIŞ FAZA götürüyor ve dikey platformda zıplarken iniş karesini
     kaydırıp büyük sapma üretiyordu. Onay yoksa (eski host, ilk paketler)
     eskisi gibi kendi saatimizden geriye sayıyoruz. */
  const seekBase = Number.isFinite(hostPlatformTime) ? hostPlatformTime : null;
  for (const s of saved) {
    s.m.seek(seekBase !== null ? seekBase : s.animTime - frames * REPLAY_DT);
  }

  /* Çöken bloklar geri sarılamıyor (tetiklemeye bağlı durum makinesi),
     bu yüzden motor son karelerini saklıyor — bkz. engine.js. Şimdiki
     hâllerini kenara koyup oynatma boyunca tarihten besleyeceğiz. */
  const crumbles = eng.entities?.crumbles || [];
  const hist = eng._crumbleHistory;
  const crumbleNow = crumbles.map(c => ({
    c, phase: c.phase, timer: c.timer, vy: c.vy,
    y: c.y, solid: c.solid, shakeOff: c.shakeOff, animTime: c.animTime
  }));
  const applyCrumble = (snapArr) => {
    if (!snapArr) return false;
    for (let k = 0; k < crumbles.length; k++) {
      const s = snapArr[k]; if (!s) continue;
      const c = crumbles[k];
      c.phase = s.phase; c.timer = s.timer; c.vy = s.vy;
      c.y = s.y; c.solid = s.solid; c.shakeOff = s.shakeOff; c.animTime = s.animTime;
    }
    return true;
  };

  for (let i = start; i < pending.length; i++) {
    const rc = pending[i];

    /* Kaydı düzeltilmiş yörüngeyle TAZELE. Bunu atlarsak bir sonraki
       uzlaştırma, düzeltmeden önceki konumlarla kıyaslar; aynı hatayı
       tekrar tekrar uygular ve karakter salınmaya başlar. */
    rc.x = p.x;
    rc.y = p.y;

    /* Dünya bu oynatma karesine ilerlesin — oyuncudan ÖNCE, gerçek
       adımdaki sırayla (bkz. engine.js → _stepPlaying). */
    let worldMoved = false;
    if (saved.length) {
      for (const s of saved) s.m.update(REPLAY_DT);
      worldMoved = true;
    }
    /* Çöken blokları o karedeki hâline getir. `i` ne kadar geride?
       Son bekleyen kayıt "şimdi"ye denk geliyor. Tarih kısaysa (oyun
       yeni başladıysa) o kareyi olduğu gibi bırakıyoruz — yanlış bir
       kareyi uygulamaktansa dokunmamak daha güvenli. */
    if (hist && hist.length) {
      const back = pending.length - 1 - i;
      if (applyCrumble(hist[hist.length - 1 - back])) worldMoved = true;
    }
    if (worldMoved) eng._rebuildSolids();

    if (rc.state) inp._set(rc.state);
    p.update(REPLAY_DT, inp, eng.level, null, null, null);
    inp.update(REPLAY_DT);
  }

  /* Gerçek (şimdiki) duruma geri koy: oynatma bir simülasyon değil,
     geçmişin tekrarı. Dünyayı oynatmanın bıraktığı yerde bırakmak
     çizimi ve bir sonraki adımı bozardı. */
  /* Gerçek (şimdiki) duruma geri koy: oynatma bir simülasyon değil,
     geçmişin tekrarı.

     Host'un fazını oynatma SONRASINDA da tutmayı denedim (ak.mt + frames
     kesin bir değer, gürültülü değil) — ölçümde TERS TEPTİ: ort 11.9 →
     17.9 px, p95 45 → 75 px. Sebebi canlı saatin saniyede 20 kez sertçe
     yerinden oynaması; platform sıçrayınca üstündeki oyuncu savruluyor.
     Host'un fazı yalnızca OYNATMA SÜRESİNCE kullanılıyor; canlı saati
     yumuşak sürükleme yönetmeye devam ediyor (bkz. applySnapshot). */
  for (const s of saved) {
    s.m.animTime = s.animTime;
    s.m.x = s.x; s.m.y = s.y;
    s.m.dx = s.dx; s.m.dy = s.dy;
  }
  for (const s of crumbleNow) {
    s.c.phase = s.phase; s.c.timer = s.timer; s.c.vy = s.vy;
    s.c.y = s.y; s.c.solid = s.solid; s.c.shakeOff = s.shakeOff; s.c.animTime = s.animTime;
  }
  if (saved.length || crumbleNow.length) eng._rebuildSolids();

  p.pendingArrow = savedArrow;
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
      /* Ejderhanın hızı SON İKİ PAKETTEN türetiliyor, `bo` içindeki
         vx/vy'den değil: ejderha yalnızca bazı durumlarda (sweep, slam)
         o alanları kullanıyor, 'hover'da konumu doğrudan yazıyor ve
         vx/vy sıfır kalıyor. Ölçümden türetmek her durumda çalışır ve
         ağa tek bayt eklemez. */
      const snap = ahead <= this.maxExtrapolate
        ? extrapolate(last.snap, ahead / 1000, this._bossVelocity())
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

  /** Son iki paketten ejderhanın hızı (px/sn) — yoksa null */
  _bossVelocity() {
    const n = this.buf.length;
    if (n < 2) return null;
    const last = this.buf[n - 1], prev = this.buf[n - 2];
    if (!last.snap.bo || !prev.snap.bo) return null;
    const dts = (last.at - prev.at) / 1000;
    if (dts <= 0.001) return null;
    const vx = (last.snap.bo.x - prev.snap.bo.x) / dts;
    const vy = (last.snap.bo.y - prev.snap.bo.y) / dts;
    /* Durum geçişlerinde (giriş, ışınlanma) iki paket arası sıçrama
       gerçek hız değildir; saçma bir değerle ileri sarmaktansa hiç
       sarmamak yeğdir. */
    if (Math.hypot(vx, vy) > 2500) return null;
    return { vx, vy };
  }

  get depth() { return this.buf.length; }
  clear() { this.buf.length = 0; }
}

/**
 * Ölü hesap: son bilinen hızla kısa süre ileri taşı.
 * Sadece oyuncular ve boss — düşmanların hız bilgisi taşınmıyor ve
 * devriye hareketleri zaten yavaş, donmaları göze batmıyor.
 */
function extrapolate(snap, dt, bossVel = null) {
  const cap = 40;   // px — tek seferde bu kadardan fazla tahmin etme
  const step = (v) => Math.max(-cap, Math.min(cap, v * dt));
  const out = { ...snap };
  out.p = snap.p.map(p => ({
    ...p,
    x: p.x + step(p.vx || 0),
    y: p.y + step(p.vy || 0)
  }));
  /* EJDERHA DA İLERLETİLİYOR.
     Bu satır eskiden ejderhayı olduğu gibi kopyalıyordu — fonksiyonun
     kendi açıklaması "oyuncular ve boss" dediği hâlde. Yani paket
     geciktiği anlarda oyuncular akmaya devam ederken ejderha DONUYOR,
     sonraki paket gelince ileri sıçrıyordu.

     Dürüst olmak gerekirse: bu dal normal koşullarda hiç çalışmıyor
     (±90 ms dalgalanmada bile karelerin %0'ı — uyarlanabilir tampon
     hepsini yutuyor). Yalnızca hat gerçekten tıkandığında devreye
     giriyor. Düzeltmenin sebebi de bu: tam o anda ejderhanın donması
     dövüşün en kötü zamanda okunamaz hale gelmesi demek. */
  if (snap.bo) {
    out.bo = bossVel
      ? { ...snap.bo, x: snap.bo.x + step(bossVel.vx), y: snap.bo.y + step(bossVel.vy) }
      : { ...snap.bo };
  }
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

  /* --------------------------------------------------------------------
     OKLAR VE MERMİLER — konum burada da harmanlanmalı.

     Eskiden bu iki liste harmanlamaya HİÇ girmiyordu: `out = {...b}` onları
     olduğu gibi bırakıyor, yani konumları 20 Hz'lik ham anlık görüntüden
     BİREBİR geliyordu — 60 Hz render'da her ~50ms'de bir görünür bir sıçrama
     (ok hızında ~33px). Oyuncunun "ok atışı sarsıntılı/bozuk" dediği şeyin
     büyük kısmı buydu. Kimlik eşleşmesi yok (kısa ömürlü nesneler, ekstra
     alan taşımanın maliyeti yok); index'e göre eşleştirip TELEPORTED eşiğini
     aşan sıçramaları (bir okun tükenip yerine bambaşka birinin gelmesi gibi)
     olduğu gibi bırakıyoruz. */
  out.pr = b.pr.map((pb, i) => {
    const pa = a.pr[i];
    if (!pa || teleported(pa.x, pa.y, pb.x, pb.y)) return pb;
    return { ...pb, x: lerp(pa.x, pb.x), y: lerp(pa.y, pb.y) };
  });

  out.ar = b.ar.map((ab, i) => {
    const aa = a.ar[i];
    if (!aa || teleported(aa.x, aa.y, ab.x, ab.y)) return ab;
    return { ...ab, x: lerp(aa.x, ab.x), y: lerp(aa.y, ab.y) };
  });

  const idx = new Map(a.en.map(e => [e.i, e]));
  out.en = b.en.map(eb => {
    const ea = idx.get(eb.i);
    if (!ea || teleported(ea.x, ea.y, eb.x, eb.y)) return eb;
    return { ...eb, x: lerp(ea.x, eb.x), y: lerp(ea.y, eb.y) };
  });

  /* Hareketli platform artık saat taşıyor; saati harmanlamak konumu
     harmanlamakla aynı şey (ikisi de doğrusal ilerliyor) ama misafir
     bunu yerel simülasyonda ileri sarabiliyor. */
  out.mp = b.mp.map((mb, i) => {
    const ma = a.mp[i];
    return ma ? { t: lerp(ma.t, mb.t) } : mb;
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
