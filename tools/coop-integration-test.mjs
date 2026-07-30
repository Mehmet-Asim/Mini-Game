/* ==========================================================================
   Co-op Entegrasyon Testi — GERÇEK ZİNCİR

       npm run test:integration

   Neden bu test var: elimizdeki diğer testler parçaları ayrı ayrı doğruluyordu.
   `test:net` anlık görüntüleri ELLE taşıyor, `CoopSession` sınıfına hiç
   dokunmuyor. `test:server` soketleri doğruluyor ama motoru tanımıyor.
   Aradaki bağlantı katmanı — yani gerçekte kullanılan yol — test edilmemişti
   ve hata tam oradaydı.

   Bu test gerçek zinciri kurar:

       Motor(host) ─ CoopSession(host) ─ sahte taşıma ─ CoopSession(misafir) ─ Motor(misafir)

   Sahte taşıma sunucunun aktarım davranışını taklit eder (mesaj karşı tarafa
   gider, gönderene geri dönmez) ve gerçek gecikme uygular. Zamanlayıcılar
   GERÇEK: CoopSession setInterval kullanıyor, testte de öyle çalışıyor.
   ========================================================================== */

/* ---------- DOM taklidi ---------- */
function fakeCtx() {
  const noop = () => {}; const grad = { addColorStop: noop };
  const c = {
    canvas: { width: 800, height: 500 },
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    createPattern: () => null, measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: noop
  };
  for (const m of ['save','restore','beginPath','closePath','fill','stroke','clip','translate','scale','rotate',
    'setTransform','transform','resetTransform','moveTo','lineTo','quadraticCurveTo','bezierCurveTo','arc','arcTo',
    'ellipse','rect','roundRect','fillRect','strokeRect','clearRect','drawImage','fillText','strokeText','setLineDash']) c[m] = noop;
  return c;
}
globalThis.window = {
  devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}
};
globalThis.document = { createElement: () => ({ id: '', style: {}, width: 800, height: 500, getContext: () => fakeCtx() }) };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.sessionStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
};

const container = () => ({ appendChild: () => {}, getBoundingClientRect: () => ({ width: 800, height: 500, x: 0, y: 0 }) });

const { GameEngine } = await import('../src/game/engine.js');
const { CoopSession } = await import('../src/net/session.js');
const { MSG } = await import('../server/protocol.js');

/* ---------- Test iskeleti ---------- */
const results = [];
let failures = 0;
function check(name, cond, detail = '') {
  results.push({ test: name, sonuç: cond ? '✔' : '✘', not: cond ? '' : String(detail).slice(0, 56) });
  if (!cond) failures++;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* --------------------------------------------------------------------------
   Sahte taşıma — sunucunun aktarım davranışı

   Sunucu ne yapıyorsa o: mesajı KARŞI tarafa iletir, gönderene geri döndürmez.
   NetClient'ın CoopSession tarafından kullanılan yüzeyini taklit eder.
   -------------------------------------------------------------------------- */
class FakeNet {
  constructor(role, latency = 40) {
    this.role = role;
    this.isHost = role === 'host';
    this.isGuest = role === 'guest';
    this.status = 'online';
    this.rtt = latency * 2;
    this.peer = null;
    this.latency = latency;
    this.handlers = new Map();
    this.sentCount = 0;
    this.sentByType = {};
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  send(type, payload = {}) {
    this.sentCount++;
    this.sentByType[type] = (this.sentByType[type] || 0) + 1;
    if (!this.peer) return false;
    /* Sunucu gibi: JSON'a çevirip geri açıyoruz ki serileştirilemeyen
       bir şey kaçarsa test yakalasın. */
    let wire;
    try { wire = JSON.parse(JSON.stringify({ t: type, ...payload, from: this.role })); }
    catch (e) { throw new Error(`${type} serileştirilemedi: ${e.message}`); }
    setTimeout(() => this.peer._deliver(type, wire), this.latency);
    return true;
  }

  _deliver(type, msg) {
    for (const fn of (this.handlers.get(type) || [])) fn(msg);
  }
}

/* --------------------------------------------------------------------------
   Gerçek oyun kurulumu — main.js + gameView.js ne yapıyorsa aynısı
   -------------------------------------------------------------------------- */
function buildSide(role, net, levelIndex = 0) {
  const log = { story: [], levelComplete: 0, gameComplete: 0, netPause: [] };
  const session = new CoopSession(net, {
    onNetPause: (p) => log.netPause.push(p)
  });
  const engine = new GameEngine(container(), {
    onHud: () => {}, onToast: () => {}, onDeath: () => {},
    onStory: (i) => log.story.push(i),
    onLevelComplete: () => { log.levelComplete++; },
    onGameComplete: () => { log.gameComplete++; },
    onBossStart: () => {}, onPause: () => {},
    /* gameView bunu motorun kare döngüsünde çağırıyor */
    onFrame: () => session.applyIncoming(),
    onInputTick: (inp) => session.sendInputTick(inp)
  }, {
    mode: 'net',
    netMode: session.isHost ? 'host' : 'guest',
    localIndex: session.localIndex,
    names: ['Mehmet', 'Ayşe']
  });
  engine.lives = 3;
  engine.loadLevel(levelIndex);
  engine.entities.enemies.length = 0;          // ölçüm gürültüsünü kaldır
  /* rAF döngüsünü elle çeviriyoruz ama motor "çalışıyor" sayılmalı:
     pause() çalışmayan motorda erken dönüyor ve duraklatma testleri
     sessizce hiçbir şey ölçmüyordu. */
  engine.running = true;
  session.attachEngine(engine);
  return { session, engine, log };
}

/** Motorun kare döngüsünü elle döndür (rAF yok) */
function stepSide(side, dt) {
  side.engine.cb.onFrame?.(dt);
  side.engine._step(dt);
}

const DT = 1 / 60;

/**
 * GERÇEK ZAMANA KİLİTLİ koşum.
 *
 * Bu ayrıntı testin doğruluğu için kritik: CoopSession `setInterval` ile
 * çalışıyor, yani DUVAR SAATİNE bağlı. Simülasyonu "olabildiğince hızlı"
 * döndürürsek oyun zamanı duvar saatinden kat kat hızlı akar; ağ paketleri
 * arasında karakter çok daha fazla yol alır ve test, olmayan bir senkron
 * hatası uydurur. (İlk sürümde tam bu oldu.)
 *
 * Bu yüzden kareleri biriktirip 60 fps'i AŞMADAN ilerletiyoruz.
 */
async function runRealtime(sides, ms, onTick) {
  let acc = 0;
  let last = Date.now();
  const t0 = last;
  while (Date.now() - t0 < ms) {
    const now = Date.now();
    acc += (now - last) / 1000;
    last = now;
    while (acc >= DT) {
      for (const s of sides) stepSide(s, DT);
      acc -= DT;
    }
    onTick?.(Date.now() - t0);
    await sleep(2);
  }
}

/* ==========================================================================
   1. Misafir hareket edebiliyor mu — ASIL ŞİKÂYET
   ========================================================================== */
{
  const hostNet = new FakeNet('host');
  const guestNet = new FakeNet('guest');
  hostNet.peer = guestNet; guestNet.peer = hostNet;

  const host = buildSide('host', hostNet);
  const guest = buildSide('guest', guestNet);

  check('host 0. oyuncuyu, misafir 1. oyuncuyu kontrol ediyor',
    host.session.localIndex === 0 && guest.session.localIndex === 1,
    `host=${host.session.localIndex} misafir=${guest.session.localIndex}`);

  check('misafirin klavyesi kendi karakterine bağlı',
    guest.engine.inputs[1]?.constructor.name === 'Input' &&
    guest.engine.inputs[0]?.constructor.name === 'RemoteInput',
    `${guest.engine.inputs[0]?.constructor.name} / ${guest.engine.inputs[1]?.constructor.name}`);

  check('host tarafında 1. oyuncu ağ girdisi bekliyor',
    host.engine.inputs[1]?.constructor.name === 'RemoteInput',
    host.engine.inputs[1]?.constructor.name);

  /* Misafir sağa basıyor */
  const gi = guest.engine.inputs[1];
  gi.right = true;

  const startHostX = host.engine.players[1].x;
  const startGuestX = guest.engine.players[1].x;

  /* Karakter uçuruma düşüp başa dönebiliyor; ULAŞILAN EN UZAK NOKTAYI ölç.
     Ayrıca iki ekranın birbirini ne kadar iyi takip ettiğini de topluyoruz —
     asıl kalite ölçüsü bu. */
  let maxHostX = startHostX, maxGuestX = startGuestX;
  let diffSum = 0, diffMax = 0, diffN = 0;

  await runRealtime([host, guest], 2200, (elapsed) => {
    maxHostX = Math.max(maxHostX, host.engine.players[1].x);
    maxGuestX = Math.max(maxGuestX, guest.engine.players[1].x);
    if (elapsed > 500) {                      // ilk yarım saniye ısınma
      const d = Math.abs(guest.engine.players[1].x - host.engine.players[1].x);
      diffSum += d; diffMax = Math.max(diffMax, d); diffN++;
    }
  });
  gi.right = false;

  const hostMoved = maxHostX - startHostX;
  const guestMoved = maxGuestX - startGuestX;
  const diffAvg = diffN ? diffSum / diffN : 0;

  check('misafirin tuşları AĞA gidiyor',
    (guestNet.sentByType[MSG.INPUT] || 0) > 10,
    `${guestNet.sentByType[MSG.INPUT] || 0} input paketi`);

  check('host misafirin girdisini ALIYOR',
    host.engine.inputs[1].lastSeq > 0,
    `lastSeq=${host.engine.inputs[1].lastSeq}`);

  check('MİSAFİRİN KARAKTERİ HOST TARAFINDA HAREKET EDİYOR',
    hostMoved > 60, `${hostMoved.toFixed(0)}px`);

  check('MİSAFİRİN KARAKTERİ KENDİ EKRANINDA HAREKET EDİYOR',
    guestMoved > 60, `${guestMoved.toFixed(0)}px`);

  check('iki ekran birbirine yakın',
    Math.abs(hostMoved - guestMoved) < 90,
    `host=${hostMoved.toFixed(0)} misafir=${guestMoved.toFixed(0)}`);

  /* ASIL KALİTE ÖLÇÜSÜ: misafirin kendi karakteri host'unkini yakından
     takip etmeli. Tahmin payı yüzünden birkaç on piksel önde olması normal;
     lastikli bir his ancak bu fark büyük ve dalgalı olduğunda doğar. */
  check('misafirin karakteri host ile hizalı kalıyor (lastik yok)',
    diffAvg < 45 && diffMax < 110,
    `ort=${diffAvg.toFixed(0)}px en büyük=${diffMax.toFixed(0)}px`);

  check('uzlaştırma sapması küçük',
    (guest.session.stats.drift ?? 999) < 40,
    `sapma=${(guest.session.stats.drift ?? -1).toFixed(1)}px`);

  /* Host da kendi karakterini oynatabilmeli */
  const hi = host.engine.inputs[0];
  hi.right = true;
  const hostOwnStart = host.engine.players[0].x;
  const guestSeesStart = guest.engine.players[0].x;
  let maxOwn = hostOwnStart, maxSeen = guestSeesStart;
  await runRealtime([host, guest], 1400, () => {
    maxOwn = Math.max(maxOwn, host.engine.players[0].x);
    maxSeen = Math.max(maxSeen, guest.engine.players[0].x);
  });
  hi.right = false;

  check('host kendi karakterini oynatabiliyor',
    maxOwn - hostOwnStart > 60,
    `${(maxOwn - hostOwnStart).toFixed(0)}px`);
  check("host'un karakteri misafirin ekranında da hareket ediyor",
    maxSeen - guestSeesStart > 40,
    `${(maxSeen - guestSeesStart).toFixed(0)}px`);

  check('anlık görüntüler misafire ulaşıyor',
    guest.session.buffer.depth > 0 || guest.session.stats.received > 5,
    `alınan=${guest.session.stats.received}`);

  host.session.destroy(); guest.session.destroy();
  host.engine.stop(); guest.engine.stop();
}

/* ==========================================================================
   2. Ara sahne senkronu — gerçek Director + gerçek CoopSession
   ========================================================================== */
{
  const { Director } = await import('../src/cinematic/director.js');
  const { SCENES } = await import('../src/cinematic/scenes/index.js');
  const config = { heroName: 'Mehmet', targetName: 'Ayşe', proposalText: 'Soru?' };

  const hostNet = new FakeNet('host', 35);
  const guestNet = new FakeNet('guest', 35);
  hostNet.peer = guestNet; guestNet.peer = hostNet;

  const hostSession = new CoopSession(hostNet, {});
  const guestSession = new CoopSession(guestNet, {});

  const hostD = new Director(SCENES['intro'], { config });
  const guestD = new Director(SCENES['intro'], { config });

  hostSession.attachDirector(hostD);
  guestSession.attachDirector(guestD);

  /* Misafiri bilerek geride başlat — senkron onu yakalamalı */
  guestD.seek(0);
  hostD.seek(3.0);

  const t0 = Date.now();
  while (Date.now() - t0 < 1600) {
    hostD.update(1 / 60);
    guestD.update(1 / 60);
    await sleep(6);
  }

  check('host sahne saatini yayınlıyor',
    (hostNet.sentByType[MSG.SCENE] || 0) > 2,
    `${hostNet.sentByType[MSG.SCENE] || 0} sahne paketi`);

  check('MİSAFİRİN SAHNESİ HOST İLE SENKRON',
    Math.abs(hostD.time - guestD.time) < 0.5,
    `host=${hostD.time.toFixed(2)} misafir=${guestD.time.toFixed(2)}`);

  hostSession.destroy(); guestSession.destroy();
}

/* ==========================================================================
   3. Teklif seçimi — misafir seçiyor, host da devam ediyor
   ========================================================================== */
{
  const { Director } = await import('../src/cinematic/director.js');
  const { SCENES } = await import('../src/cinematic/scenes/index.js');
  const config = { heroName: 'Mehmet', targetName: 'Ayşe', proposalText: 'Soru?' };

  const hostNet = new FakeNet('host', 30);
  const guestNet = new FakeNet('guest', 30);
  hostNet.peer = guestNet; guestNet.peer = hostNet;

  const hostSession = new CoopSession(hostNet, {});
  const guestSession = new CoopSession(guestNet, {});

  let hostEnded = null;
  const hostD = new Director(SCENES['outro-ask'], { config, onEnd: (i) => { hostEnded = i; } });
  const guestD = new Director(SCENES['outro-ask'], { config, onChoice: (id) => guestSession.sendChoice(id) });

  hostSession.attachDirector(hostD);
  guestSession.attachDirector(guestD);
  /* main.js'te host bu aboneliği kuruyor */
  hostSession.onChoice((id) => hostD.submitChoice(id));

  /* İkisini de seçim anına getir */
  hostD.seek(SCENES['outro-ask'].choice.t - 0.1);
  guestD.seek(SCENES['outro-ask'].choice.t - 0.1);
  for (let i = 0; i < 20; i++) { hostD.update(1 / 60); guestD.update(1 / 60); }

  check('host seçim anında bekliyor', hostD.awaitingChoice, `t=${hostD.time.toFixed(2)}`);
  check('misafir seçim anında bekliyor', guestD.awaitingChoice, `t=${guestD.time.toFixed(2)}`);

  guestD.submitChoice('yes');

  const t0 = Date.now();
  while (Date.now() - t0 < 2500 && !hostEnded) {
    for (let k = 0; k < 4; k++) { hostD.update(1 / 60); guestD.update(1 / 60); }
    await sleep(4);
  }

  check('MİSAFİRİN CEVABI HOST\'A ULAŞTI VE SAHNE DEVAM ETTİ',
    !!hostEnded, hostD.awaitingChoice ? 'host hâlâ bekliyor' : 'sahne bitmedi');
  check('iki taraf da aynı cevabı biliyor',
    hostD.choiceMade === 'yes' && guestD.choiceMade === 'yes',
    `host=${hostD.choiceMade} misafir=${guestD.choiceMade}`);

  hostSession.destroy(); guestSession.destroy();
}

/* ==========================================================================
   4. Duraklatma — misafiri kilitleyen hata

   Ölçülen hata: host duraklatınca misafir de duruyordu, host devam edince
   misafir SONSUZA DEK duruyordu. Ekranında karakteri uzlaştırma yüzünden
   kayıyor ama tuşlara cevap vermiyordu — "2. oyuncu oyunda değil gibi".
   ========================================================================== */
{
  const hostNet = new FakeNet('host', 30), guestNet = new FakeNet('guest', 30);
  hostNet.peer = guestNet; guestNet.peer = hostNet;
  const host = buildSide('host', hostNet), guest = buildSide('guest', guestNet);

  await runRealtime([host, guest], 500);
  check('oyun iki tarafta da akıyor',
    host.engine.state === 'playing' && guest.engine.state === 'playing',
    `host=${host.engine.state} misafir=${guest.engine.state}`);

  host.engine.pause('local');
  await runRealtime([host, guest], 500);
  check('host duraklatınca misafir de duruyor',
    guest.engine.state === 'paused', guest.engine.state);
  check('misafire sebebi bildiriliyor',
    guest.log.netPause[0] === true, JSON.stringify(guest.log.netPause));

  host.engine.resume('local');
  await runRealtime([host, guest], 700);
  check('HOST DEVAM EDİNCE MİSAFİR DE DEVAM EDİYOR',
    guest.engine.state === 'playing', guest.engine.state);

  /* Ve gerçekten oynayabiliyor */
  const gi = guest.engine.inputs[1];
  gi.right = true;
  const x0 = guest.engine.players[1].x;
  await runRealtime([host, guest], 800);
  gi.right = false;
  check('misafir duraklatmadan sonra hâlâ hareket edebiliyor',
    guest.engine.players[1].x - x0 > 60,
    `${(guest.engine.players[1].x - x0).toFixed(0)}px`);

  /* Ters yön: misafirin kendi menüsü ağdan gelen sinyalle kapanmamalı */
  guest.engine.pause('local');
  await runRealtime([host, guest], 500);
  check('MİSAFİRİN KENDİ DURAKLATMASI AĞDAN AÇILMIYOR',
    guest.engine.state === 'paused', guest.engine.state);
  check('misafirin duraklatması host\'a da geçiyor',
    host.engine.state === 'paused', host.engine.state);

  guest.engine.resume('local');
  await runRealtime([host, guest], 700);
  check('misafir devam edince host da devam ediyor',
    host.engine.state === 'playing' && guest.engine.state === 'playing',
    `host=${host.engine.state} misafir=${guest.engine.state}`);

  host.session.destroy(); guest.session.destroy();
  host.engine.stop(); guest.engine.stop();
}

/* ==========================================================================
   5. Hatıralar — teklifi ALAN kişi onları görmeliydi

   Ölçülen hata: kalp toplama kararı host'ta veriliyor, misafir hatıra
   listesini hiç almıyordu. Misafir oyun boyunca tek bir hatıra kartı
   görmüyor, final ekranına da hatırasız giriyordu.
   ========================================================================== */
{
  const hostNet = new FakeNet('host', 30), guestNet = new FakeNet('guest', 30);
  hostNet.peer = guestNet; guestNet.peer = hostNet;
  const host = buildSide('host', hostNet), guest = buildSide('guest', guestNet);

  host.engine.storyUnlocked.push(0);
  host.engine.hearts = 7;
  await runRealtime([host, guest], 700);

  check('MİSAFİR HATIRA KARTINI GÖRÜYOR',
    guest.log.story.length === 1 && guest.log.story[0] === 0,
    JSON.stringify(guest.log.story));
  check('misafirin hatıra listesi host ile aynı',
    JSON.stringify(guest.engine.storyUnlocked) === JSON.stringify(host.engine.storyUnlocked),
    `misafir=${JSON.stringify(guest.engine.storyUnlocked)}`);
  check('kalp sayacı senkron',
    guest.engine.hearts === host.engine.hearts,
    `host=${host.engine.hearts} misafir=${guest.engine.hearts}`);

  /* Aynı hatıra tekrar tekrar açılmamalı */
  await runRealtime([host, guest], 600);
  check('hatıra kartı yalnızca bir kez açılıyor',
    guest.log.story.length === 1, `${guest.log.story.length} kez`);

  host.session.destroy(); guest.session.destroy();
  host.engine.stop(); guest.engine.stop();
}

/* ==========================================================================
   6. Bölüm sonu — misafirde tam bir kez

   İki ayrı ölçüm hatası vardı: önce misafir bölüm sonunu 4 KEZ
   tetikliyordu (host 'levelDone'u 1.4 sn boyunca yayınlıyor, misafir her
   pakette yeniden giriyordu), sonra düzeltme fazla kaçınca HİÇ
   tetiklemez oldu (host 'idle'a dönünce misafir dışarı çekiliyordu).
   ========================================================================== */
{
  const hostNet = new FakeNet('host', 30), guestNet = new FakeNet('guest', 30);
  hostNet.peer = guestNet; guestNet.peer = hostNet;
  const host = buildSide('host', hostNet), guest = buildSide('guest', guestNet);

  await runRealtime([host, guest], 400);
  host.engine._levelComplete();
  await runRealtime([host, guest], 3200);

  check('host bölüm sonunu bir kez bildiriyor',
    host.log.levelComplete === 1, `${host.log.levelComplete} kez`);
  check('MİSAFİR BÖLÜM SONUNU TAM BİR KEZ ALIYOR',
    guest.log.levelComplete === 1, `${guest.log.levelComplete} kez`);

  host.session.destroy(); guest.session.destroy();
  host.engine.stop(); guest.engine.stop();
}

/* ==========================================================================
   7. Bölümü baştan yükleme — yetki host'ta

   Canlar bitince host bölümü baştan yüklüyor ve kalpler geri geliyor.
   Toplanma bilgisi ağda yalnızca "toplandı" yönünde taşındığı için bu
   sinyal olmadan misafir kalpsiz bir bölümde dolaşıyordu.
   ========================================================================== */
{
  const hostNet = new FakeNet('host', 30), guestNet = new FakeNet('guest', 30);
  hostNet.peer = guestNet; guestNet.peer = hostNet;
  const host = buildSide('host', hostNet), guest = buildSide('guest', guestNet);

  await runRealtime([host, guest], 400);

  /* Misafir kalpleri toplanmış görsün, sonra host bölümü baştan yüklesin */
  host.engine.entities.hearts.forEach(h => { h.collected = true; });
  await runRealtime([host, guest], 400);
  const guestCollected = guest.engine.entities.hearts.filter(h => h.collected).length;

  host.engine.loadLevel(host.engine.levelIndex);   // canlar bitti → baştan
  host.engine.entities.enemies.length = 0;
  await runRealtime([host, guest], 900);

  const guestAfter = guest.engine.entities.hearts.filter(h => h.collected).length;
  check('misafir kalpleri toplanmış görüyordu',
    guestCollected > 0, `${guestCollected} kalp`);
  check('HOST BAŞTAN YÜKLEYİNCE MİSAFİRİN KALPLERİ GERİ GELİYOR',
    guestAfter === 0, `${guestAfter} kalp hâlâ toplanmış`);
  check('yükleme sayaçları hizalı',
    guest.engine._netLoadSerial === host.engine.loadSerial,
    `host=${host.engine.loadSerial} misafir=${guest.engine._netLoadSerial}`);

  host.session.destroy(); guest.session.destroy();
  host.engine.stop(); guest.engine.stop();
}

/* ==========================================================================
   8. ARKA PLANDAKİ SEKME — asıl "hayalet mod" sebebi

   Tarayıcı arka plandaki sekmede requestAnimationFrame'i durdurur. Host
   sekmesi arka plandayken host'un motoru hiç adım atmaz: misafirin
   girdilerini işlemez, anlık görüntü üretmez. Misafir kendi ekranında
   yürümeye devam eder ama yetkili dünyada kımıldamaz — kalp toplamaz,
   düşmanlar onu görmez. Host sekmesine dönülünce yetkili konum geri gelir
   ve misafir "sıfırlanmış" görünür.

   Burada host'un karesini hiç çevirmeyerek arka planı taklit ediyoruz.
   ========================================================================== */
{
  const hostNet = new FakeNet('host', 30), guestNet = new FakeNet('guest', 30);
  hostNet.peer = guestNet; guestNet.peer = hostNet;
  const host = buildSide('host', hostNet), guest = buildSide('guest', guestNet);

  await runRealtime([host, guest], 500);

  /* --- Düzeltme YOKKEN ne oluyordu: yalnız koşan misafir --- */
  const gi = guest.engine.inputs[1];
  gi.right = true;
  const guestStart = guest.engine.players[1].x;
  const hostStart = host.engine.players[1].x;

  /* Host sekmesi arka planda: SADECE misafirin karesi dönüyor */
  await runRealtime([guest], 1500);
  gi.right = false;

  const guestRan = guest.engine.players[1].x - guestStart;
  const hostRan = host.engine.players[1].x - hostStart;

  check('arka plan taklidi gerçekten ayrışma üretiyor',
    guestRan > 40 && Math.abs(hostRan) < 20,
    `misafir=${guestRan.toFixed(0)}px host=${hostRan.toFixed(0)}px`);

  /* --- Düzeltme: sekme gizlenince oyun İKİ TARAFTA da durur --- */
  host.engine.pause('local');          // gameView'deki visibilitychange
  await runRealtime([guest], 400);     // host hâlâ arka planda

  check('HOST ARKA PLANA DÜŞÜNCE MİSAFİR DE DURUYOR',
    guest.engine.state === 'paused', guest.engine.state);

  const frozenAt = guest.engine.players[1].x;
  gi.right = true;
  await runRealtime([guest], 600);
  gi.right = false;
  check('duran misafir yalnız başına ilerlemiyor',
    Math.abs(guest.engine.players[1].x - frozenAt) < 8,
    `${(guest.engine.players[1].x - frozenAt).toFixed(0)}px kaydı`);

  /* --- Sekmeye dönüldü --- */
  host.engine.resume('local');
  await runRealtime([host, guest], 800);
  check('sekmeye dönünce iki taraf da devam ediyor',
    host.engine.state === 'playing' && guest.engine.state === 'playing',
    `host=${host.engine.state} misafir=${guest.engine.state}`);

  check('bayat girdi kuyruğu boşaltıldı',
    host.engine.inputs[1].queue.length < 6,
    `${host.engine.inputs[1].queue.length} bekleyen girdi`);

  /* Devam edince misafir yine host'un dünyasında hareket edebilmeli */
  gi.right = true;
  const reHost = host.engine.players[1].x;
  await runRealtime([host, guest], 1200);
  gi.right = false;
  check('devam ettikten sonra misafir host tarafında yine hareket ediyor',
    host.engine.players[1].x - reHost > 40,
    `${(host.engine.players[1].x - reHost).toFixed(0)}px`);

  host.session.destroy(); guest.session.destroy();
  host.engine.stop(); guest.engine.stop();
}

/* ==========================================================================
   9. SİNEMATİK + ARKA PLANDAKİ SEKME

   Oyunla aynı kök sebep, farklı sonuç. Host sekmesi arka plandayken
   `requestAnimationFrame` durur ama sahne saatini yayınlayan `setInterval`
   DURMAZ — host donmuş bir saati yayınlamaya devam eder. Misafir ona
   kilitlenince sahne ilerlemez, takılır ve `syncTo` geri sardığı için
   başa döner.
   ========================================================================== */
{
  const { Director } = await import('../src/cinematic/director.js');
  const { SCENES } = await import('../src/cinematic/scenes/index.js');
  const config = { heroName: 'a', targetName: 'b', proposalText: 'Soru?' };

  const hostNet = new FakeNet('host', 30), guestNet = new FakeNet('guest', 30);
  hostNet.peer = guestNet; guestNet.peer = hostNet;

  const hostSession = new CoopSession(hostNet, {});
  const guestSession = new CoopSession(guestNet, {});

  const hostD = new Director(SCENES['intro'], { config });
  const guestD = new Director(SCENES['intro'], { config });

  /* cinematicView'in yaptığı bağlantı: karşı taraf bekletince
     yerel yönetmen de durur */
  hostSession.attachDirector(hostD, { onHold: (v) => { hostD.playing = !v; } });
  guestSession.attachDirector(guestD, { onHold: (v) => { guestD.playing = !v; } });

  hostD.seek(4); guestD.seek(4);

  /* Yayın 4 Hz; ölçüme başlamadan önce iki saatin oturmasını bekle.
     (İlk sürümde beklemeden ölçtüm ve yayının ilk paketi misafiri 0'a
     çekti — testin kendi kurulum yarışıydı, koddaki hata değil.) */
  const tw = Date.now();
  while (Date.now() - tw < 700) { hostD.update(1 / 60); guestD.update(1 / 60); await sleep(6); }

  /* --- Host sekmesi arka planda: rAF durdu, saat dondu --- */
  hostD.playing = false;                 // rAF durdu
  hostSession.holdScene(true);           // visibilitychange

  const guestBefore = guestD.time;
  const t0 = Date.now();
  while (Date.now() - t0 < 900) { guestD.update(1 / 60); await sleep(6); }

  check('HOST SEKMESİ ARKA PLANDAYKEN MİSAFİRİN SAHNESİ DE BEKLİYOR',
    Math.abs(guestD.time - guestBefore) < 0.35,
    `misafir ${guestBefore.toFixed(2)} → ${guestD.time.toFixed(2)}`);
  check('misafir donmuş saate kilitlenip geri sarmıyor',
    guestD.time >= guestBefore - 0.05,
    `${guestD.time.toFixed(2)} < ${guestBefore.toFixed(2)}`);

  /* --- Sekmeye dönüldü --- */
  hostD.playing = true;
  hostSession.holdScene(false);
  const t1 = Date.now();
  while (Date.now() - t1 < 1200) { hostD.update(1 / 60); guestD.update(1 / 60); await sleep(6); }

  check('sekmeye dönünce iki sahne de ilerliyor',
    hostD.time > 4.3 && guestD.time > 4.3,
    `host=${hostD.time.toFixed(2)} misafir=${guestD.time.toFixed(2)}`);
  check('iki sahne senkron kaldı',
    Math.abs(hostD.time - guestD.time) < 0.5,
    `host=${hostD.time.toFixed(2)} misafir=${guestD.time.toFixed(2)}`);

  /* --- Misafirin atlama isteği host'a gidiyor mu --- */
  const beforeSkip = hostD.time;
  guestSession.requestSkip();
  const t2 = Date.now();
  while (Date.now() - t2 < 700) { hostD.update(1 / 60); guestD.update(1 / 60); await sleep(6); }

  check('MİSAFİRİN ATLA İSTEĞİ HOST\'TA UYGULANIYOR',
    hostD.time > beforeSkip + 2, `${beforeSkip.toFixed(1)} → ${hostD.time.toFixed(1)}`);
  check('atlama sonrası misafir de aynı yere geldi',
    Math.abs(hostD.time - guestD.time) < 0.6,
    `host=${hostD.time.toFixed(1)} misafir=${guestD.time.toFixed(1)}`);

  hostSession.destroy(); guestSession.destroy();
}

/* ==========================================================================
   10. EŞZAMANLI SAVAŞ

   İki oyuncu aynı anda aynı düşmana vurduğunda ne oluyor? Vuruşlar
   oyuncu başına `attackHitIds` ile sayılıyor; ortak olan şey düşmanın
   canı. Aynı karede iki kez öldürülmemeli, ölüm sesi/ödül ikilenmemeli.
   ========================================================================== */
{
  const hostNet = new FakeNet('host', 25), guestNet = new FakeNet('guest', 25);
  hostNet.peer = guestNet; guestNet.peer = hostNet;
  const host = buildSide('host', hostNet), guest = buildSide('guest', guestNet);

  /* Bölümü düşmanlarıyla birlikte yeniden kur.
     İKİ TARAFTA da yüklemek şart: `buildSide` ölçüm gürültüsü için
     düşmanları siliyor, sadece host'ta yüklersem misafir boş dünyayla
     kalıyor ve test kendi kurulumunu ölçmüş oluyor. */
  host.engine.loadLevel(0);
  guest.engine.loadLevel(0);
  await runRealtime([host, guest], 900);

  const target = host.engine.entities.enemies[0];
  check('savaş testi için düşman var', !!target, 'düşman yok');

  if (target) {
    const hp0 = target.hp ?? 1;
    /* İki oyuncuyu da düşmanın üstüne koy ve aynı karede vurdur */
    for (const p of host.engine.players) {
      p.x = target.x - 4;
      p.y = target.y - 6;
      p.vy = 0;
    }
    const before = host.engine.entities.enemies.length;

    for (const inp of [host.engine.inputs[0], host.engine.inputs[1]]) {
      inp.attackHeld = true;
      inp._attackBuffer = 0.13;
      if (inp.presses) inp.presses.attack++;
    }
    await runRealtime([host, guest], 900);

    const after = host.engine.entities.enemies.length;
    check('iki oyuncu aynı anda vurunca düşman tek kez ölüyor',
      before - after <= 1, `${before} → ${after}`);
    check('düşman canı eksiye düşmüyor',
      (target.hp ?? 0) >= 0, `hp=${target.hp} (başlangıç ${hp0})`);
    check('eşzamanlı savaş iki dünyayı ayırmıyor',
      host.engine.entities.enemies.length === guest.engine.entities.enemies.length ||
      Math.abs(host.engine.entities.enemies.length - guest.engine.entities.enemies.length) <= 1,
      `host=${host.engine.entities.enemies.length} misafir=${guest.engine.entities.enemies.length}`);
  }

  host.session.destroy(); guest.session.destroy();
  host.engine.stop(); guest.engine.stop();
}

/* ==========================================================================
   11. ÖLÜM → DİRİLİŞ

   Ölüm host'un kararı; misafir onu anlık görüntüyle öğreniyor. Kritik
   ayrıntı: doğuş noktası. Kontrol noktalarını yalnızca host çözüyor, bu
   yüzden `spawnPoint` ağdan geçmezse misafir ölümden sonra kendi
   karakterini BÖLÜM BAŞINA koyuyor, host ise son kontrol noktasına —
   ve uzlaştırma karakteri bir uçtan bir uca savuruyordu.
   ========================================================================== */
{
  const hostNet = new FakeNet('host', 25), guestNet = new FakeNet('guest', 25);
  hostNet.peer = guestNet; guestNet.peer = hostNet;
  const host = buildSide('host', hostNet), guest = buildSide('guest', guestNet);

  await runRealtime([host, guest], 500);

  /* Host bir kontrol noktasına değdi */
  host.engine.spawnPoint = { x: 1500, y: 300 };
  await runRealtime([host, guest], 600);

  check('DOĞUŞ NOKTASI MİSAFİRE GEÇİYOR',
    Math.abs(guest.engine.spawnPoint.x - 1500) < 2 &&
    Math.abs(guest.engine.spawnPoint.y - 300) < 2,
    `misafir=${guest.engine.spawnPoint.x},${guest.engine.spawnPoint.y}`);

  /* Ölüm */
  host.engine.lives = 1;
  host.engine._playerDies('damage');
  check('host ölüm durumuna geçti', host.engine.state === 'dying', host.engine.state);

  await runRealtime([host, guest], 900);
  check('misafir de ölüm durumunu gördü',
    ['dying', 'respawning', 'playing'].includes(guest.engine.state), guest.engine.state);

  /* Diriliş tamamlansın */
  await runRealtime([host, guest], 2600);

  check('ölümden sonra iki taraf da oynanır durumda',
    host.engine.state === 'playing' && guest.engine.state === 'playing',
    `host=${host.engine.state} misafir=${guest.engine.state}`);

  const gap = Math.hypot(
    host.engine.players[1].x - guest.engine.players[1].x,
    host.engine.players[1].y - guest.engine.players[1].y);
  check('dirilişten sonra misafirin karakteri host ile aynı yerde',
    gap < 80, `${gap.toFixed(0)}px fark`);

  /* Ve tekrar oynanabiliyor */
  const gi = guest.engine.inputs[1];
  gi.right = true;
  const x0 = host.engine.players[1].x;
  await runRealtime([host, guest], 1200);
  gi.right = false;
  check('DİRİLİŞTEN SONRA MİSAFİR YİNE HAREKET EDEBİLİYOR',
    host.engine.players[1].x - x0 > 40,
    `${(host.engine.players[1].x - x0).toFixed(0)}px`);

  host.session.destroy(); guest.session.destroy();
  host.engine.stop(); guest.engine.stop();
}

/* ==========================================================================
   12. BAĞLANTI TİTREMESİ — kendi soketimiz koptuğunda

   Ölçülen hata: tek bir "peerOnline" bayrağı vardı ve KENDİ soketimiz
   koptuğunda da "yoldaşın bağlantısı koptu" deniyordu. Geri geldiğimizde
   onu tekrar açacak bir şey yoktu — sunucu "rejoined" olayını karşı tarafa
   yolluyor, bize değil. Bağlantısı bir saniye titreyen oyuncu sonsuza dek
   duraklamış ekranda kalıyordu.
   ========================================================================== */
{
  const hostNet = new FakeNet('host', 25), guestNet = new FakeNet('guest', 25);
  hostNet.peer = guestNet; guestNet.peer = hostNet;
  const host = buildSide('host', hostNet), guest = buildSide('guest', guestNet);

  await runRealtime([host, guest], 500);
  check('başlangıçta oyun akıyor', guest.engine.state === 'playing', guest.engine.state);

  /* Misafirin KENDİ bağlantısı titriyor */
  guestNet._deliver('status', { status: 'reconnecting' });
  await runRealtime([host, guest], 300);
  check('kendi bağlantısı kopunca oyun duruyor',
    guest.engine.state === 'paused', guest.engine.state);
  check('sebep doğru bildiriliyor (yoldaş değil, kendi hattı)',
    guest.session.selfOnline === false && guest.session.peerOnline === true,
    `self=${guest.session.selfOnline} peer=${guest.session.peerOnline}`);

  /* Geri geldi */
  guestNet._deliver('status', { status: 'online' });
  await runRealtime([host, guest], 500);
  check('KENDİ BAĞLANTISI DÖNÜNCE OYUN DEVAM EDİYOR',
    guest.engine.state === 'playing', guest.engine.state);

  /* Ve gerçekten oynanabiliyor */
  const gi = guest.engine.inputs[1];
  gi.right = true;
  const x0 = host.engine.players[1].x;
  await runRealtime([host, guest], 1000);
  gi.right = false;
  check('bağlantı döndükten sonra misafir yine hareket ediyor',
    host.engine.players[1].x - x0 > 40,
    `${(host.engine.players[1].x - x0).toFixed(0)}px`);

  /* Salon özeti yoldaşın gerçek durumunu taşımalı */
  guestNet._deliver(MSG.LOBBY, { lobby: { host: { connected: false }, guest: { connected: true } } });
  await runRealtime([host, guest], 300);
  check('salon özeti yoldaşın kopukluğunu bildiriyor',
    guest.session.peerOnline === false, `peer=${guest.session.peerOnline}`);

  guestNet._deliver(MSG.LOBBY, { lobby: { host: { connected: true }, guest: { connected: true } } });
  await runRealtime([host, guest], 400);
  check('salon özeti yoldaş dönünce oyunu açıyor',
    guest.engine.state === 'playing' && guest.session.peerOnline === true,
    `${guest.engine.state} peer=${guest.session.peerOnline}`);

  host.session.destroy(); guest.session.destroy();
  host.engine.stop(); guest.engine.stop();
}

/* ==========================================================================
   Rapor
   ========================================================================== */
console.log('\n=== CO-OP ENTEGRASYON TESTİ ===');
console.table(results);
if (failures === 0) console.log(`\n✔ ${results.length} kontrolün tamamı geçti.\n`);
else { console.log(`\n✘ ${failures}/${results.length} kontrol başarısız.\n`); process.exitCode = 1; }
