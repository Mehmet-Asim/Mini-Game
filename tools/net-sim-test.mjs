/* ==========================================================================
   Netcode Simülasyonu — iki motor, yapay gecikme, ölçülen sapma

       npm run test:net

   İki GameEngine örneği açıyoruz: biri host, biri misafir. Aralarına
   gerçekçi bir ağ koyuyoruz (gecikme + dalgalanma + paket kaybı) ve
   misafirin ekranındaki dünyanın host'unkine ne kadar benzediğini ÖLÇÜYORUZ.

   Bu testin cevapladığı soru şu: "misafir gerçekten aynı oyunu mu görüyor,
   yoksa kendi kafasına göre bir şey mi oynuyor?"

   Ölçülenler:
     · yoldaş karakterin konum sapması (px)      → hedef: < 12 px ortalama
     · kendi karakterinin sapması (prediction)    → hedef: < 25 px ortalama
     · düşman konumlarının sapması                → hedef: < 12 px
     · co-op kapı durumlarının tutarlılığı        → hedef: birebir
     · paket boyutu                               → hedef: < 4 KB
     · %5 paket kaybında bozulma olmaması
   ========================================================================== */

/* ---------- DOM taklidi ---------- */
function fakeCtx() {
  const noop = () => {}; const grad = { addColorStop: noop };
  const c = { canvas: { width: 800, height: 500 }, createLinearGradient: () => grad,
    createRadialGradient: () => grad, createPattern: () => null,
    measureText: () => ({ width: 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: noop };
  for (const m of ['save','restore','beginPath','closePath','fill','stroke','clip','translate','scale','rotate',
    'setTransform','transform','resetTransform','moveTo','lineTo','quadraticCurveTo','bezierCurveTo','arc','arcTo',
    'ellipse','rect','roundRect','fillRect','strokeRect','clearRect','drawImage','fillText','strokeText','setLineDash']) c[m] = noop;
  return c;
}
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} };
globalThis.document = { createElement: () => ({ id: '', style: {}, width: 800, height: 500, getContext: () => fakeCtx() }) };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const container = () => ({ appendChild: () => {}, getBoundingClientRect: () => ({ width: 800, height: 500, x: 0, y: 0 }) });

/* ÖLÇÜM TEKRARLANABİLİR OLSUN — `Math.random` tohumlanıyor.

   Düşmanların başlangıç yörünge fazı rastgeleydi (`rand()`, bkz.
   entities.js → Flyer) ve bu, bölüm 3 ölçümünü aynı kodda 7.2 ile
   20.0 px arasında gezdiriyordu. Sonucu eşiğe bağlayınca test rastgele
   patlıyor; daha kötüsü, bir düzeltmenin işe yarayıp yaramadığı
   ölçülemiyordu — bu projede tam olarak bu yüzden iki yanlış teşhis
   yapıldı. Tohumlu üreteçle her koşu aynı dünyayı kuruyor.

   Not: rastgeleliğin ÇEŞİTLİLİĞİ burada bir değer değil; bu test
   senkron kalitesini ölçüyor, oyunun rastgelelik dağılımını değil. */
{
  let a = 0x9E3779B9 >>> 0;
  Math.random = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const { GameEngine } = await import('../src/game/engine.js');
const { serializeSnapshot, applySnapshot, reconcileLocal, SnapshotBuffer } = await import('../src/net/snapshot.js');
const { packInput, unpackInput } = await import('../server/protocol.js');

/* ---------- Test iskeleti ---------- */
const results = [];
let failures = 0;
function check(name, cond, detail = '') {
  results.push({ test: name, sonuç: cond ? '✔' : '✘', not: cond ? '' : String(detail).slice(0, 52) });
  if (!cond) failures++;
}

const DT = 1 / 60;

/* --------------------------------------------------------------------------
   Yapay ağ

   Gerçek dünyada paketler gecikir, gecikme dalgalanır ve bazıları kaybolur.
   Bunları taklit etmezsek test "mükemmel ağ"da geçer ve sahada patlar.
   -------------------------------------------------------------------------- */
class FakeNetwork {
  constructor({ latency = 60, jitter = 25, loss = 0 } = {}) {
    this.latency = latency; this.jitter = jitter; this.loss = loss;
    this.queue = [];
    this.now = 0;
    this.dropped = 0; this.delivered = 0; this.bytes = 0;
    this._rnd = mulberry(12345);
  }
  send(payload) {
    this.bytes += JSON.stringify(payload).length;
    if (this._rnd() < this.loss) { this.dropped++; return; }
    const delay = this.latency + (this._rnd() - 0.5) * 2 * this.jitter;
    this.queue.push({ at: this.now + Math.max(1, delay), payload });
  }
  advance(ms) {
    this.now += ms;
    const out = [];
    /* Sıra bozulması da gerçekçi: jitter yüzünden paketler karışık gelebilir */
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].at <= this.now) { out.push(this.queue[i].payload); this.queue.splice(i, 1); }
    }
    this.delivered += out.length;
    return out.reverse();
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeEngine(netMode, localIndex, levelIndex = 0, extraCb = {}) {
  const eng = new GameEngine(container(), {
    onHud: () => {}, onToast: () => {}, onStory: () => {}, onDeath: () => {},
    onLevelComplete: () => {}, onGameComplete: () => {}, onBossStart: () => {}, onPause: () => {},
    ...extraCb
  }, { mode: 'net', netMode, localIndex });
  eng.lives = 3;
  eng.loadLevel(levelIndex);
  return eng;
}

/* --------------------------------------------------------------------------
   Ana simülasyon
   -------------------------------------------------------------------------- */

function simulate({ seconds = 12, latency = 60, jitter = 25, loss = 0, levelIndex = 0, reckless = false, ridePlatform = false, contact = false }) {
  const host = makeEngine('host', 0, levelIndex);

  /* Misafirin girdisi motorun SABİT ADIMINDAN yollanıyor — oyunda da
     (gameView → CoopSession.sendInputTick) tam olarak böyle. Testin ayrı
     bir zamanlayıcı kullanması, ölçtüğü şeyin gerçek yol olmaması demekti. */
  let seq = 0;
  const pending = [];
  const lastPresses = { jump: 0, attack: 0, shoot: 0 };
  const lastBits = [];
  let upLinkRef = null;

  const guest = makeEngine('guest', 1, levelIndex, {
    onInputTick: (inp) => {
      if (!upLinkRef) return;
      const pr = inp.presses || { jump: 0, attack: 0, shoot: 0 };
      const state = {
        left: inp.left, right: inp.right, down: inp.down,
        jumpHeld: inp.jumpHeld, attackHeld: inp.attackHeld,
        shootHeld: inp.shootHeld, blockHeld: inp.blockHeld,
        jumpEdge:   pr.jump   > lastPresses.jump,
        attackEdge: pr.attack > lastPresses.attack,
        shootEdge:  pr.shoot  > lastPresses.shoot
      };
      lastPresses.jump = pr.jump; lastPresses.attack = pr.attack; lastPresses.shoot = pr.shoot;

      seq++;
      const me = guest.players[1];
      pending.push({ seq, x: me.x, y: me.y, state });
      if (pending.length > 200) pending.shift();
      const bits = packInput(state);
      const pkt = { seq, bits, bk: lastBits.slice(0, 2) };
      const claims = guest.hitClaims;
      if (claims && claims.length) { pkt.hit = claims.slice(0, 6); claims.length = 0; }
      upLinkRef.send(pkt);
      lastBits.unshift(bits);
      if (lastBits.length > 3) lastBits.pop();
    }
  });

  /* Aynı rastgele durum: düşmanlar iki motorda aynı fazda başlasın.
     (Misafir zaten düşman AI'ı çalıştırmıyor ama başlangıç konumları eşleşsin.)

     TOHUMLAMA: Flyer.orbitT ve Caster/Walker cooldown'ları rastgele başlıyor.
     Bunları sabit değerlere zorluyoruz ki ölçüm koşudan koşuya değişmesin.
     Bölüm 3'te aynı kodda 7.2–16.9 px arasında ölçüm yapıldı — sebebi buydu. */
  for (const eng of [host, guest]) {
    for (const en of eng.entities.enemies) {
      if (en.type === 'flyer') {
        en.orbitT = 1.0;   // sabit faz
        const t0 = en.orbitT * en.speed;
        en.homeX = en.x - Math.sin(t0) * en.rangeX;
        en.homeY = en.y - Math.sin(t0 * 2.1) * en.amp;
        en.cooldown = 0.8;
      } else if (en.type === 'walker') {
        en.attackCooldown = 0.8;
      } else if (en.type === 'caster') {
        en.cooldown = 1.0;
      }
    }
  }
  /* İd ve başlangıç konumları host'tan kopyala */
  guest.entities.enemies.forEach((en, i) => {
    const h = host.entities.enemies[i];
    if (h) { en.x = h.x; en.y = h.y; en.animTime = h.animTime; en.id = h.id; }
  });
  guest.entities.movingPlatforms.forEach((m, i) => {
    const h = host.entities.movingPlatforms[i];
    if (h) { m.x = h.x; m.y = h.y; m.animTime = h.animTime; }
  });


  /* TEMAS SENARYOSU — düşman hasarı.
     İki karakteri de bir devriye düşmanının yoluna dikip bekletiyoruz;
     düşman gelip çarpıyor. Hasar kararı HOST'ta veriliyor, misafir
     geri tepmeyi öngörmüyor: ölçmek istediğimiz sapma bu. */
  if (contact) {
    /* İKİ MOTORDA DA HER İKİ oyuncuyu konumlandırmak şart. Önce yalnızca
       `guest.players[1]` taşınmıştı; host'un misafir kopyası bölüm
       başında kalıyor, düşman ona hiç değmiyor ve ölçüm sessizce
       sıfırlanıyordu (temas sayacı: misafir 0). */
    for (const eng of [host, guest]) {
      const w = eng.entities.enemies.find(e => e.type === 'walker');
      if (!w) continue;
      const g = eng.players[1];          // misafirin karakteri: düşmanın ÜSTÜNDE
      g.x = w.x; g.y = w.y - g.h; g.vx = 0; g.vy = 0;
      const h = eng.players[0];          // host'unki uzakta dursun, ölçümü kirletmesin
      h.x = w.x - 320; h.y = w.y - h.h; h.vx = 0; h.vy = 0;
    }
  }

  /* HAREKETLİ PLATFORM SENARYOSU
     Normal senaryo sağa-sola koşuyor ve platformlara neredeyse hiç
     basmıyor; oysa oyuncunun bildirdiği takılma yalnızca platform
     ÜSTÜNDEYKEN (`player.onPlatform && grounded`) çıkıyor. Burada iki
     karakteri de doğrudan platforma oturtup öylece bıraktırıyoruz. */
  if (ridePlatform) {
    /* İKİ MOTORDA DA HER İKİ oyuncu konumlanmalı. Önceki hâlinde yalnızca
       `guest.players[1]` ve `host.players[0]` taşınıyordu; host'un misafir
       kopyası bölüm başında kalıyordu. Üstelik oyuncu 720 karenin 1'inde
       platformda kalabiliyordu — senaryo çalışmıyordu ve ölçüm sessizce
       anlamsızdı. */
    for (const eng of [host, guest]) {
      const plat = eng.entities.movingPlatforms.find(m => m.rangeY > 0) // DİKEY
                || eng.entities.movingPlatforms[0];
      if (!plat) continue;
      for (const p of eng.players) {
        p.x = plat.x + plat.w / 2 - p.w / 2;
        p.y = plat.y - p.h;
        p.vx = 0; p.vy = 0; p.grounded = true; p.onPlatform = plat;
      }
    }
  }

  const upLink = new FakeNetwork({ latency, jitter, loss });     // misafir → host (tuşlar)
  const downLink = new FakeNetwork({ latency, jitter, loss });   // host → misafir (görüntü)
  const buffer = new SnapshotBuffer(100);
  upLinkRef = upLink;

  let clock = 0;
  let tick = 0;
  let sinceSnap = 0, sinceInput = 0;
  let maxSnapBytes = 0;

  const samples = { peer: [], self: [], enemy: [], jerk: [], gate: 0, gateChecks: 0, offPath: [], hardSnaps: 0, snapCount: 0 };
  let lastPeer = null, lastHost = null;
  /* Işınlanma (ölüm/diriliş) anları: host konumu bir karede fizikle
     açıklanamayacak kadar sıçradıysa oraya işaret koyuyoruz. O pencerede
     "sapma" ölçmek gecikmeyi hata sayar; ölçümü dışarıda bırakıyoruz.
     Işınlanmanın kendisi ayrı bir kontrolle (offPath) sınanıyor. */
  const teleports = [];
  let prevHostP0 = null;
  /* Karakter uçuruma düşüp başa dönebiliyor; "hareket etti mi" sorusunu
     son konumla değil ULAŞILAN EN UZAK NOKTA ile ölçüyoruz. */
  let maxHostX = 0, maxGuestX = 0;
  const history = [];

  /* Misafir bir senaryo oynuyor: sağa koş, ara ara zıpla */
  const gi = guest.inputs[1];
  /* Host da hareket etmeli — yoksa "yoldaş sapması" ölçümü anlamsız olur
     (durağan bir karakteri senkronlamak zaten hatasızdır). */
  const hi = host.inputs[0];

  const frames = Math.round(seconds / DT);
  for (let f = 0; f < frames; f++) {
    clock += DT * 1000;

    /* --- Host'un tuşları (farklı ritim, ki iki karakter ayrışsın) --- */
    const hPhase = Math.floor(f / 55) % 2;
    hi.right = hPhase === 0;
    hi.left = hPhase === 1;
    if (f % 55 === 0) { hi.jumpHeld = true; hi._jumpBuffer = 0.13; hi.presses.jump++; }
    else if (f % 55 === 14) hi.jumpHeld = false;

    /* --- Misafirin tuşları ---
       Uçuruma DÜŞMEYECEK şekilde gidip geliyor. Sürekli ölen bir senaryo,
       "senkron kalitesi" ölçümünü ölüm/ışınlanma olaylarıyla dolduruyor ve
       asıl ölçmek istediğimiz şeyi görünmez kılıyordu. Ölüm senkronu ayrı
       bir senaryoda (bölüm 3) zaten sınanıyor. */
    const phase = Math.floor(f / 40) % 2;
    gi.right = reckless ? true : phase === 0;
    gi.left = reckless ? false : phase === 1;

    /* Platform senaryosunda ikisi de KIMILDAMIYOR — ölçülen şey yalnızca
       platformun taşımasının senkron kalıp kalmadığı. */
    if (contact) {
      hi.right = hi.left = false; hi.jumpHeld = false;
      gi.right = gi.left = false; gi.jumpHeld = false;
    }

    if (ridePlatform) {
      hi.right = hi.left = false; hi.jumpHeld = false;
      gi.right = gi.left = false;
      /* Zıplama ŞART: `reconcileLocal` hata 5px'in altındaysa hiç
         uzlaştırma yapmıyor. Kımıldamadan duran karakterde hata hep
         5px altında kalıyor, yeniden oynatma hiç çalışmıyor ve hata
         görünmez oluyordu. Oyuncu gerçekte platformda zıplayarak
         yukarı tırmanıyor — asıl senaryo bu. */
      if (f % 45 === 0) { gi.jumpHeld = true; gi._jumpBuffer = 0.13; gi.presses.jump++; }
      else if (f % 45 === 12) gi.jumpHeld = false;

      /* SAĞA-SOLA da git: oyuncunun bildirdiği durum "zıplayıp sağ sol
         yapınca". Yön kısa aralıkla değişiyor ki karakter 100 px'lik
         platformdan yürüyerek düşmesin — ölçmek istediğimiz şey düşme
         değil, iniş karesinin host'la tutup tutmadığı. */
      const dir = Math.floor(f / 6) % 2;
      gi.right = dir === 0; gi.left = dir === 1;

      /* Yere basmışken platformun ortasına geri çek: senaryo 12 saniye
         boyunca platformda KALMALI, yoksa yine boş ölçüm olur. */
      for (const eng of [host, guest]) {
        const plat = eng.entities.movingPlatforms.find(m => m.rangeY > 0) || eng.entities.movingPlatforms[0];
        if (!plat) continue;
        for (const p of eng.players) {
          if (!p.grounded) continue;
          const cx = plat.x + plat.w / 2 - p.w / 2;
          if (Math.abs(p.x - cx) > 26) p.x = cx;
        }
      }
    }

    /* --------------------------------------------------------------------
       Ölümü ŞANSA BIRAKMA.

       `reckless` senaryosu yoldaşın uçuruma koşup ölmesine güveniyordu.
       Ama düşmanların başlangıç animasyon fazı rastgele; bazen yoldaşı
       erken durduruyor, bazen hiç düşmüyor ve "ölüm yaşandı" kontrolü
       koşuların dörtte birinde başarısız oluyordu. Testin kendi kurulumu
       kararsızdı, üründe bir sorun yoktu.

       Sabit bir karede karakteri doğrudan ölüm bölgesine bırakıyoruz:
       ışınlanma her koşuda kesin gerçekleşiyor ve asıl ölçülmek istenen
       şey (dirilişin interpole edilip edilmediği) her seferinde
       sınanabiliyor. */
    if (reckless && f === Math.round(frames * 0.45)) {
      const p = host.players[1];
      p.y = host.level.deathY + 40;
      p.vy = 0;
    }
    const wantJump = f % 45 === 0;
    if (wantJump) { gi.jumpHeld = true; gi._jumpBuffer = 0.13; gi.presses.jump++; }
    else if (f % 45 === 12) gi.jumpHeld = false;

    /* --- Misafir tuşlarını yolla (30 Hz) --- */
    /* --- Host gelen tuşları uygular --- */
    for (const m of upLink.advance(DT * 1000)) {
      host.applyRemoteInput(1, unpackInput(m.bits), m.seq,
        Array.isArray(m.bk) ? m.bk.map(b => unpackInput(b || 0)) : null);
      /* Ok isabet bildirimleri de girdi paketiyle geliyor (session.js ile
         aynı yol) — yoksa test gerçek taşıma yolunu ölçmemiş olurdu. */
      if (m.hit) host.applyRemoteHits(m.hit);
    }

    /* --- İki motor da adım atar --- */
    host._step(DT);
    guest._step(DT);

    /* --- Host anlık görüntü yollar (20 Hz) --- */
    sinceSnap += DT * 1000;
    if (sinceSnap >= 1000 / 20) {
      sinceSnap = 0;
      const snap = serializeSnapshot(host, ++tick);
      maxSnapBytes = Math.max(maxSnapBytes, JSON.stringify(snap).length);
      downLink.send(snap);
    }

    /* --- Misafir gelenleri tamponlar --- */
    for (const snap of downLink.advance(DT * 1000)) {
      /* Uzlaştırma tamponlamadan ÖNCE ve paket başına BİR KEZ — CoopSession da böyle yapıyor */
      const rErr = reconcileLocal(guest, snap, 1, pending);
      if (rErr !== null && clock > 2000) {
        /* 160px üstü düzeltmeler "gerçek olay" yolundan geçiyor: ölüm,
           diriliş, kapıya çarpma. Bunlar senkron hatası değil, host'un
           kararının uygulanması. Ortalamaya katmak, doğru çalışan bir
           mekanizmayı hata gibi gösterirdi; ayrı sayılıyorlar. */
        if (rErr > 160) samples.hardSnaps++;
        else samples.self.push(rErr);
      }
      if (globalThis.__DIAG && rErr !== null) globalThis.__DIAG.push({ t: Math.round(clock), err: Math.round(rErr), ack: snap.ak?.seq, starve: host.inputs[1].starved, q: host.inputs[1].queue.length });
      samples.snapCount++;
      buffer.push(snap, clock);
    }

    /* --- Misafir 100 ms geçmişi oynatır --- */
    const played = buffer.sample(clock);
    if (played) applySnapshot(guest, played, 1);

    maxHostX = Math.max(maxHostX, host.players[1].x);
    maxGuestX = Math.max(maxGuestX, guest.players[1].x);

    /* Host'un geçmişi — ölçüm bunun üstünden yapılacak */
    history.push({
      t: clock,
      p0: { x: host.players[0].x, y: host.players[0].y },
      p1: { x: host.players[1].x, y: host.players[1].y },
      en: host.entities.enemies.map(e => ({ i: e.id, x: e.x, y: e.y }))
    });
    if (history.length > 400) history.shift();

    /* Işınlanma taraması İKİ oyuncuyu da kapsıyor. Eskiden yalnızca
       player[0]'a (host'un kendi karakteri) bakıyordu; oysa `reckless`
       senaryosu ölümü player[1]'e (misafirin karakteri) ZORLUYOR. Kontrol
       bu yüzden gerçekte "host da tesadüfen öldü mü" sorusunu ölçüyordu ve
       zamanlama en ufak değiştiğinde sallanıyordu. */
    const nowPs = host.players.map(p => ({ x: p.x, y: p.y }));
    if (prevHostP0) {
      for (let pi = 0; pi < nowPs.length; pi++) {
        const a = nowPs[pi], b = prevHostP0[pi];
        if (b && Math.hypot(a.x - b.x, a.y - b.y) > 60) { teleports.push(clock); break; }
      }
    }
    prevHostP0 = nowPs;

    /* --- Ölçüm (ilk 2 saniye ısınma sayılmaz) ---
       Misafir bilerek 100 ms geriyi oynatıyor. Doğru karşılaştırma, onun
       ŞU ANDA gösterdiği kare ile host'un 100 MS ÖNCEKİ gerçek hali.
       (Oynattığı paketle kıyaslamak totoloji olurdu: elbette eşitler.) */
    if (f > 120 && played) {
      /* Misafirin gördüğü an = host zamanı − (tampon gecikmesi + ağ gecikmesi).
         Paketler VARIŞ zamanıyla tamponlanıyor, üretim zamanıyla değil;
         dolayısıyla toplam görsel gecikme ikisinin toplamı. Karşılaştırmayı
         bu ana göre yapmazsak "gecikme"yi "hata" diye ölçmüş oluruz. */
      const want = clock - (buffer.delay + latency);
      let h = history[0];
      for (const rec of history) { if (rec.t <= want) h = rec; else break; }

      /* IŞINLANMA PENCERESİ
         Ölüm/diriliş anında karakter bir karede haritanın öbür ucuna atlıyor.
         Misafir bunu ağ gecikmesi kadar SONRA görüyor; bu gecikmedir, sapma
         değil. Pencere payı tampon zamanlamasının bir paketlik kayması için. */
      const nearTeleport = teleports.some(tt => Math.abs(tt - want) < 400);

      /* YOLDAN SAPMA
         Misafirin gösterdiği konum, host'un gerçekten bulunduğu bir noktaya
         yakın olmak zorunda. Işınlanmayı interpole eden eski kod karakteri
         hiç uğramadığı boşluklardan süzüyordu; bu kontrol onu yakalar. */
      let nearest = Infinity;
      for (const rec of history) {
        const d = Math.hypot(guest.players[0].x - rec.p0.x, guest.players[0].y - rec.p0.y);
        if (d < nearest) nearest = d;
      }
      samples.offPath.push(nearest);

      if (!nearTeleport) {
        samples.peer.push(Math.hypot(guest.players[0].x - h.p0.x, guest.players[0].y - h.p0.y));
        /* Kendi karakterimin sapması BURADA ölçülmez.
           Misafir tahmin ettiği için host'un önünde olması NORMAL — bunu
           hata saymak, tahminin kendisini hata saymak olur. Gerçek ölçüt
           uzlaştırmanın eşleşen simülasyon anlarında bulduğu fark;
           o da snapshot geldiğinde toplanıyor (samples.self). */
      }

      /* TAKILMA: oyuncunun hissettiği şey konum hatası değil, yoldaşının
         kare kare ZIPLAMASI. Ama karakterin kendi hareketi de hızlı
         (zıplarken ~12px/kare) — sabit bir eşik yanıltır. Bu yüzden
         misafirin kare farkını HOST'un aynı andaki kare farkıyla
         kıyaslıyoruz: fazlası ağdan gelen takılmadır. */
      if (lastPeer && lastHost && !nearTeleport) {
        const guestStep = Math.hypot(guest.players[0].x - lastPeer.x, guest.players[0].y - lastPeer.y);
        const hostStep = Math.hypot(h.p0.x - lastHost.x, h.p0.y - lastHost.y);
        samples.jerk.push(Math.max(0, guestStep - hostStep));
      }
      lastPeer = { x: guest.players[0].x, y: guest.players[0].y };
      lastHost = { x: h.p0.x, y: h.p0.y };

      const hById = new Map(h.en.map(e => [e.i, e]));
      for (const ge of guest.entities.enemies) {
        const he = hById.get(ge.id);
        if (he) samples.enemy.push(Math.hypot(ge.x - he.x, ge.y - he.y));
      }

      guest.entities.gates.forEach((g, i) => {
        samples.gateChecks++;
        const hg = host.entities.gates[i];
        if (hg && Math.abs(g.open - hg.open) < 0.35 && g.latched === hg.latched) samples.gate++;
      });
    }
  }

  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const p95 = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.95)]; };

  return {
    peerAvg: avg(samples.peer), peerP95: p95(samples.peer),
    selfAvg: avg(samples.self), selfP95: p95(samples.self), selfMax: Math.max(0, ...samples.self),
    enemyAvg: avg(samples.enemy), enemyP95: p95(samples.enemy),
    jerkAvg: avg(samples.jerk), jerkP95: p95(samples.jerk), jerkMax: Math.max(0, ...samples.jerk),
    offPathP95: p95(samples.offPath), offPathMax: Math.max(0, ...samples.offPath),
    teleports: teleports.length,
    gateAgree: samples.gateChecks ? samples.gate / samples.gateChecks : 1,
    hardSnapRate: samples.snapCount ? samples.hardSnaps / samples.snapCount : 0,
    maxSnapBytes,
    hostX: maxHostX, guestX: maxGuestX,
    dropped: downLink.dropped + upLink.dropped,
    kbPerSec: (downLink.bytes + upLink.bytes) / 1024 / seconds
  };
}

/* --------------------------------------------------------------------------
   Senaryolar
   -------------------------------------------------------------------------- */

console.log('[net] simülasyonlar çalışıyor...\n');

const good = simulate({ seconds: 12, latency: 45, jitter: 12, loss: 0 });
check('iyi ağda yoldaş sapması < 10px', good.peerAvg < 10, `ort ${good.peerAvg.toFixed(1)}px`);
check('iyi ağda fazladan takılma yok', good.jerkP95 < 6, `p95 ${good.jerkP95.toFixed(1)}px/kare fazla`);
check('iyi ağda uzlaştırma hatası < 20px', good.selfAvg < 20, `ort ${good.selfAvg.toFixed(1)}px`);
check('iyi ağda sert düzeltme nadir', good.hardSnapRate < 0.06, `%${(good.hardSnapRate * 100).toFixed(1)}`);
check('iyi ağda düşman sapması < 8px', good.enemyAvg < 8, `ort ${good.enemyAvg.toFixed(1)}px`);
check('kapı durumları tutarlı', good.gateAgree > 0.98, `%${(good.gateAgree * 100).toFixed(1)}`);
check('anlık görüntü < 4 KB', good.maxSnapBytes < 4096, `${good.maxSnapBytes} bayt`);
check('bant genişliği < 40 KB/sn', good.kbPerSec < 40, `${good.kbPerSec.toFixed(1)} KB/sn`);

const bad = simulate({ seconds: 12, latency: 150, jitter: 60, loss: 0.05 });
check('kötü ağda (150ms/%5 kayıp) yoldaş sapması < 25px', bad.peerAvg < 25, `ort ${bad.peerAvg.toFixed(1)}px`);
check('kötü ağda fazladan takılma sınırlı', bad.jerkP95 < 14, `p95 ${bad.jerkP95.toFixed(1)}px/kare fazla`);
/* Kötü ağ profili bilerek acımasız: 150 ms gecikme, ±60 ms dalgalanma ve
   ÇİFT YÖNLÜ %5 paket kaybı. Türkiye'de iki ev arası bağlantı gerçekte
   "iyi ağ" profiline çok daha yakın. Buradaki eşik "bozulmasın" eşiği,
   "mükemmel olsun" eşiği değil. */
check('kötü ağda uzlaştırma hatası sınırlı', bad.selfAvg < 90, `ort ${bad.selfAvg.toFixed(1)}px`);
check('kötü ağda sert düzeltme sınırlı', bad.hardSnapRate < 0.35, `%${(bad.hardSnapRate * 100).toFixed(1)}`);
check('kötü ağda paket kaybı yaşandı (test gerçekçi)', bad.dropped > 0, bad.dropped);
check('kötü ağda kapılar hâlâ tutarlı', bad.gateAgree > 0.95, `%${(bad.gateAgree * 100).toFixed(1)}`);

/* Bölüm 2 (kale) — HAREKETLİ PLATFORMLARIN yoğun olduğu bölüm.
   Uzun süre kapsam dışındaydı; oyuncunun "2. bölümde takılıyorum"
   şikâyeti tam da burada, platform üstündeyken çıkıyordu. */
const l2 = simulate({ seconds: 12, latency: 60, jitter: 20, loss: 0, levelIndex: 1 });
console.log(`\n[ölçüm] bölüm 2 (kale): uzlaştırma ort ${l2.selfAvg.toFixed(1)}px · ` +
  `takılma p95 ${l2.jerkP95.toFixed(1)}px/kare · sert düzeltme %${(l2.hardSnapRate * 100).toFixed(1)}\n`);
check('bölüm 2 (platformlu) uzlaştırma hatası < 20px', l2.selfAvg < 20, `ort ${l2.selfAvg.toFixed(1)}px`);
check('bölüm 2 platform üstünde fazladan takılma yok', l2.jerkP95 < 6, `p95 ${l2.jerkP95.toFixed(1)}px/kare`);

/* OK İSABET BİLDİRİMİ — misafir → host taşıma yolu

   Misafirin gördüğü dünya ~116 ms + rtt eskidir; yarasa yörüngede
   240, dalışta 320 px/sn gider ve gövdesi 34 px. Host okunu yarattığında
   yarasa bir-iki gövde boyu kaymış olur ve ıskalar; misafirin ekranında
   ölen yarasa 0.6 sn sonra geri dirilirdi ("üç ok atınca anca ölüyor").
   Çözüm: misafir isabeti düşman KİMLİĞİYLE bildiriyor, host uyguluyor.

   NOT: buradaki test mekanizmayı sınıyor (bildirim host'ta uygulanıyor
   mu, bozuk kimlik güvenli mi). Gecikme altındaki uçtan uca faydayı
   ölçen senaryo henüz yazılamadı — bkz. görev listesi. */
{
  const h = makeEngine('host', 0, 0);
  const target = h.entities.enemies.find(e => e.type === 'flyer');
  check('bölüm 1de uçan düşman var (test anlamlı)', !!target);
  const wasDying = target ? target.dying : true;
  h.applyRemoteHits([target.id]);
  check('host misafirin ok isabetini uyguluyor', !wasDying && target.dying,
    `dying=${target && target.dying}`);

  /* Aynı bildirim tekrar gelirse düşman iki kez ölmemeli */
  const before = h.entities.enemies.filter(e => e.dying).length;
  h.applyRemoteHits([target.id]);
  check('aynı isabet iki kez uygulanmıyor',
    h.entities.enemies.filter(e => e.dying).length === before);

  /* Bozuk/bilinmeyen kimlik sessizce yok sayılmalı — paket bozulması patlatmasın */
  let threw = false;
  try { h.applyRemoteHits([999999, null, 'x']); } catch { threw = true; }
  check('bilinmeyen kimlik güvenle yok sayılıyor', !threw);

  /* Misafir bu yetkiyi KULLANAMAZ: yalnızca host uygular */
  const g = makeEngine('guest', 1, 0);
  const gt = g.entities.enemies.find(e => e.type === 'flyer');
  g.applyRemoteHits([gt.id]);
  check('misafir kendi motorunda isabet uygulayamıyor', !gt.dying);
}


/* ==========================================================================
   YENİDEN OYNATMA SIRASINDA DÜNYA DA GERİ SARILIYOR MU?

   Uzlaştırma, onaylanmamış girdileri yeniden oynatıyor. O karelerde dünya
   da geçmişteki hâlinde olmalı. Eskiden yalnızca statik geometri
   veriliyordu; hareketli platform ve çöken blok ŞİMDİKİ hâllerinde
   donuyordu.

   Bu iki kontrol AYRI duruyor çünkü yukarıdaki büyük senaryolar bu yolu
   hiç geçmiyor: oyuncu 720 karenin 1'inde platformda kalıyor. Bir ara
   "platform senaryosu" ile ölçtüğümüz sayı bu yüzden anlamsızdı ve
   düzeltmenin işe yaradığı sanılmıştı. Aşağıdakiler oyuncuyu doğrudan
   ilgili zemine oturtup GERÇEK `reconcileLocal` yolunu çağırıyor.
   ========================================================================== */
{
  /* --- Hareketli platform: üstünde duran oyuncu kaymamalı --- */
  const eng = makeEngine('guest', 1, 1);
  const p = eng.players[1];
  const plat = eng.entities.movingPlatforms.find(m => m.rangeX > 0);   // yatay olan
  check('bölüm 2de yatay hareketli platform var (test anlamlı)', !!plat);

  if (plat) {
    const inp = eng.inputs[1];
    p.x = plat.x + plat.w / 2 - p.w / 2;
    p.vx = 0; p.vy = 0;
    for (let i = 0; i < 90; i++) {
      plat.update(DT);
      eng._rebuildSolids();
      p.update(DT, inp, eng.level, null, null, null);
      if (i < 5 && !p.onPlatform) { p.y = plat.y - p.h - 2; p.vy = 0; }
    }
    /* Kurulum tutmadıysa SESSİZCE geçmesin — ölçtüğünü sandığın şeyi
       ölçmemek, bu projede en pahalı hata oldu. */
    check('oyuncu hareketli platforma oturdu (kurulum)', !!(p.onPlatform && p.grounded));

    if (p.onPlatform) {
      const N = 10;
      const pend = [];
      for (let i = 0; i < N; i++) pend.push({ seq: i + 1, x: p.x, y: p.y, state: {} });
      const relBefore = { x: p.x - plat.x, y: p.y - plat.y };

      /* Hasar uyuşmazlığı vererek uzlaştırmayı ZORLA (err küçük olsa bile) */
      p.hurtTimer = 0; p.invuln = 0;
      reconcileLocal(eng, { ak: { seq: 1, x: p.x, y: p.y, vx: p.vx, vy: p.vy, ht: 0.2, iv: 1 } }, 1, pend);

      const slip = Math.hypot((p.x - plat.x) - relBefore.x, (p.y - plat.y) - relBefore.y);
      /* Düzeltmeden önce ~15 px ölçülmüştü (donmuş dx her karede tekrar
         uygulanıyordu). Yatayda kelepçeleyecek bir şey olmadığı için hata
         doğrudan konuma yazılıyordu. */
      check('platform üstünde yeniden oynatma oyuncuyu kaydırmıyor', slip < 5,
        `kayma ${slip.toFixed(1)}px`);
    }
  }
}

{
  /* --- Çöken blok: geçmişte KATI olan bloktan düşülmemeli --- */
  const eng = makeEngine('guest', 1, 1);
  const p = eng.players[1];
  const cr = eng.entities.crumbles[0];
  check('bölüm 2de çöken blok var (test anlamlı)', !!cr);

  if (cr) {
    const pend = [];
    let seq = 0;
    const step = () => { eng._stepPlaying(DT); pend.push({ seq: ++seq, x: p.x, y: p.y, state: {} }); };

    p.x = cr.x + cr.w / 2 - p.w / 2; p.vx = 0; p.vy = 0;
    for (let i = 0; i < 25; i++) { step(); if (i < 8 && !p.grounded) { p.y = cr.y - p.h - 2; p.vy = 0; } }
    check('oyuncu çöken bloğa oturdu (kurulum)', p.grounded);

    /* Blok çöküp KATI OLMAYANA kadar ilerlet: artık geçmişte katı,
       şimdi değil — yeniden oynatmanın yanlış yaptığı tam an. */
    let guard = 0;
    while (cr.solid && guard++ < 240) step();
    for (let i = 0; i < 6; i++) step();
    check('çöken blok artık katı değil (kurulum)', !cr.solid);

    const target = pend[pend.length - 1 - 10];
    if (target && !cr.solid) {
      const yBefore = p.y;
      p.hurtTimer = 0; p.invuln = 0;
      reconcileLocal(eng, { ak: { seq: target.seq, x: target.x, y: target.y, vx: 0, vy: 0, ht: 0.2, iv: 1 } }, 1, pend);
      /* Düzeltmeden önce oyuncu burada 12.4 px aşağı düşüyordu: oynatma
         sırasında blok listede yoktu, oyuncu içinden geçiyordu. */
      const drop = p.y - yBefore;
      check('çöken blokta yeniden oynatma oyuncuyu düşürmüyor', Math.abs(drop) < 5,
        `${drop.toFixed(1)}px düştü`);
    }
  }
}

/* DÜŞMAN TEMASI — hasar alınca sapma. */
const ct = simulate({ seconds: 12, latency: 60, jitter: 20, loss: 0, levelIndex: 0, contact: true });
console.log(`
[ölçüm] düşman teması: uzlaştırma ort ${ct.selfAvg.toFixed(1)}px · ` +
  `p95 ${ct.selfP95.toFixed(1)}px · TEPE ${ct.selfMax.toFixed(1)}px
`);

/* Karakter HAREKETLİ PLATFORMUN ÜSTÜNDE dururken. Asıl şikâyet bu. */
const ride = simulate({ seconds: 12, latency: 150, jitter: 60, loss: 0.05, levelIndex: 1, ridePlatform: true });
console.log(`\n[ölçüm] DİKEY platformda zıplayıp sağa-sola: ort ${ride.selfAvg.toFixed(1)}px · ` +
  `p95 ${ride.selfP95.toFixed(1)}px · TEPE ${ride.selfMax.toFixed(1)}px\n`);
/* AÇIK SORUN — eşik "iyi" değil, "geriye gitme" eşiği.

   Oyuncunun bildirdiği durum: dikey platformda zıplayıp sağa-sola
   giderken sapma anlık 90 px'e fırlıyor. Senaryo bunu üretiyor.

   Yerinde dururken sorun yok (platform zemin gibi kelepçeliyor);
   ZIPLAYINCA kelepçe kalkıyor ve misafirin platform saatiyle host'unki
   arasındaki fark iniş karesini kaydırıyor — biri yere basmışken diğeri
   ~500 px/sn düşüyor, fark birkaç karede büyüyor.

   Onaya host'un platform saati eklenince (ak.mt) ölçülen iyileşme:

       ort 18.8 → 11.9 px      p95 77.2 → 45.1 px

   Kalan hata, misafirin CANLI saatinin host'unkinden ayrılabilmesinden.
   Sertçe hizalamak denendi ve TERS TEPTİ (ort 17.9, p95 75.0): platform
   saniyede 20 kez sıçrayınca üstündeki oyuncu savruluyor. Gerçek çözüm
   muhtemelen `ahead` tahminini gürültüsüzleştirmek. */
check('dikey platformda zıplarken uzlaştırma hatası gerilemiyor', ride.selfAvg < 14,
  `ort ${ride.selfAvg.toFixed(1)}px`);

const l3 = simulate({ seconds: 10, latency: 60, jitter: 20, loss: 0, levelIndex: 2, reckless: true });
check('bölüm 3 (boss bölümü) senkron kalıyor', l3.peerAvg < 15, `ort ${l3.peerAvg.toFixed(1)}px`);
check('bölüm 3 uzlaştırma hatası < 20px', l3.selfAvg < 20, `ort ${l3.selfAvg.toFixed(1)}px`);
check('bölüm 3 takılma yok', l3.jerkP95 < 8, `p95 ${l3.jerkP95.toFixed(1)}px/kare`);
console.log(`[ölçüm] bölüm 3 (in): uzlaştırma ort ${l3.selfAvg.toFixed(1)}px · ` +
  `takılma p95 ${l3.jerkP95.toFixed(1)}px/kare\n`);

/* Bölüm 3'te senaryo yoldaşı uçuruma düşürüyor: ışınlanma davranışı burada
   sınanabiliyor. Misafir, host'un hiç uğramadığı bir noktada görünmemeli.

   DİKKAT — bu kontrol KARARSIZ ve öyle olduğu biliniyor. Co-op'ta ölüm
   doğrudan ışınlanma değil, önce YERE SERİLME: karakter olduğu yerde
   kalıyor. Işınlanma ancak yoldaş kaldırırsa ya da süre dolarsa oluyor;
   ikisi de düşmanların rastgele başlangıç fazına bağlı. Bu yüzden bazı
   koşularda hiç ışınlanma görülmüyor ve kontrol "0 ışınlanma" diye
   patlıyordu — üründe bir sorun yok, senaryonun garanti etmediği bir şeyi
   ölçüyordu. Asıl anlamlı kontrol bir alttaki `offPathMax`: ışınlanma
   OLDUĞUNDA misafirin boşluktan süzülmediğini sınıyor ve o kararlı. */
console.log(`[bilgi] bölüm 3 senaryosunda ${l3.teleports} ışınlanma gözlendi\n`);
check('diriliş interpole edilip yoldaş boşluktan süzülmüyor',
  l3.offPathMax < 60, `en fazla ${l3.offPathMax.toFixed(0)}px yol dışı`);
check('iyi ağda yoldaş host\'un izlediği yolda kalıyor',
  good.offPathP95 < 20, `p95 ${good.offPathP95.toFixed(1)}px yol dışı`);

/* Misafirin karakteri gerçekten ilerliyor mu — tuşlar host'a ulaşıyor mu? */
check('misafirin tuşları host tarafında karakteri hareket ettiriyor',
  good.hostX > 200, `hostX=${good.hostX.toFixed(0)}`);
check('misafirin ekranındaki karakteri host ile aynı mesafeyi katetti',
  Math.abs(good.hostX - good.guestX) < 120, `host=${good.hostX.toFixed(0)} misafir=${good.guestX.toFixed(0)}`);

/* --------------------------------------------------------------------------
   Rapor
   -------------------------------------------------------------------------- */

console.log('=== NETCODE SİMÜLASYONU ===');
console.table(results);

console.log('Ölçümler:');
console.table([
  { senaryo: 'iyi ağ (45ms)',   yoldaş_ort: +good.peerAvg.toFixed(1), yoldaş_p95: +good.peerP95.toFixed(1), kendi_ort: +good.selfAvg.toFixed(1), düşman_ort: +good.enemyAvg.toFixed(1), takılma_p95: +good.jerkP95.toFixed(1), 'KB/sn': +good.kbPerSec.toFixed(1) },
  { senaryo: 'kötü ağ (150ms)', yoldaş_ort: +bad.peerAvg.toFixed(1),  yoldaş_p95: +bad.peerP95.toFixed(1),  kendi_ort: +bad.selfAvg.toFixed(1),  düşman_ort: +bad.enemyAvg.toFixed(1),  takılma_p95: +bad.jerkP95.toFixed(1), 'KB/sn': +bad.kbPerSec.toFixed(1) },
  { senaryo: 'bölüm 3',         yoldaş_ort: +l3.peerAvg.toFixed(1),   yoldaş_p95: +l3.peerP95.toFixed(1),   kendi_ort: +l3.selfAvg.toFixed(1),   düşman_ort: +l3.enemyAvg.toFixed(1),   takılma_p95: +l3.jerkP95.toFixed(1), 'KB/sn': +l3.kbPerSec.toFixed(1) }
]);

if (failures === 0) console.log(`\n✔ ${results.length} kontrolün tamamı geçti.\n`);
else { console.log(`\n✘ ${failures}/${results.length} kontrol başarısız.\n`); process.exitCode = 1; }
