/* ==========================================================================
   CANLI CO-OP TESTİ — gerçek sunucu, gerçek WebSocket, gerçek motorlar

       npm run test:live

   Neden bu test var: `coop-integration-test.mjs` zincirin tamamını kuruyor
   ama taşıma katmanı SAHTE. Mesajı doğrudan karşı tarafın işleyicisine
   veriyor. Gerçekte araya şunlar giriyor:

       CoopSession → NetClient → encode() → WebSocket → sunucu
       → hız sınırı → relay() → WebSocket → decode() → NetClient → CoopSession

   Misafirin "hayalet mod" hatası tam bu aralıkta yaşıyordu: sahte taşımayla
   her şey geçiyor, tarayıcıda misafirin girdisi host'a hiç ulaşmıyordu.

   Bu test o aralığı da kapsıyor: alt süreçte GERÇEK sunucuyu başlatır,
   iki GERÇEK NetClient bağlar, iki GERÇEK GameEngine'i CoopSession ile
   bağlar ve misafirin karakterinin HOST'un dünyasında hareket edip
   etmediğine bakar.
   ========================================================================== */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8901;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

if (typeof WebSocket === 'undefined') {
  console.error('\nBu test Node 22+ gerektiriyor (global WebSocket).\n');
  process.exit(1);
}

/* ---------- Tarayıcı taklidi ----------
   Motor ve NetClient'ın dokunduğu her şey. sessionStorage bilerek BOŞ:
   iki istemci tek süreçte koştuğu için ortak bir depo, misafirin host'un
   token'ıyla RESUME göndermesine yol açardı — tarayıcıda ayrı sekmeler. */
function fakeCtx() {
  const noop = () => {}; const grad = { addColorStop: noop };
  const c = {
    canvas: { width: 900, height: 560 },
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
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  location: { protocol: 'http:', hostname: '127.0.0.1', port: String(PORT) }
};
globalThis.document = {
  createElement: () => ({ id: '', style: {}, width: 900, height: 560, getContext: () => fakeCtx() }),
  addEventListener: () => {}, removeEventListener: () => {}
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { GameEngine } = await import('../src/game/engine.js');
const { CoopSession } = await import('../src/net/session.js');
const { NetClient } = await import('../src/net/client.js');
const { MSG, packInput, unpackInput } = await import('../server/protocol.js');

/* ---------- İskelet ---------- */
const results = [];
let failures = 0;
function check(name, cond, detail = '') {
  results.push({ test: name, sonuç: cond ? '✔' : '✘', not: cond ? '' : String(detail).slice(0, 60) });
  if (!cond) failures++;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const container = () => ({ appendChild: () => {}, getBoundingClientRect: () => ({ width: 900, height: 560, x: 0, y: 0 }) });

/* ---------- Sunucuyu başlat ---------- */
const server = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe']
});
const serverErrors = [];
server.stderr.on('data', d => serverErrors.push(d.toString()));
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('sunucu açılmadı')), 8000);
  /* Hazır işareti: açılış logundaki adres satırı. Log metnine bağlı
     olduğu için tek bir kelimeye değil, port numarasına bakıyoruz. */
  server.stdout.on('data', (d) => {
    if (d.toString().includes(`:${PORT}`)) { clearTimeout(t); resolve(); }
  });
});
const cleanupServer = () => { try { server.kill(); } catch { /* yoksay */ } };
process.on('exit', cleanupServer);

/* ---------- gameView.js ne yapıyorsa aynısı ---------- */
function buildSide(net, levelIndex = 0) {
  const log = { story: [], levelComplete: 0, netPause: [] };
  const session = new CoopSession(net, { onNetPause: (p) => log.netPause.push(p) });
  const engine = new GameEngine(container(), {
    onHud: () => {}, onToast: () => {}, onDeath: () => {}, onBossStart: () => {}, onPause: () => {},
    onStory: (i) => log.story.push(i),
    onLevelComplete: () => { log.levelComplete++; },
    onGameComplete: () => {},
    onFrame: () => session.applyIncoming(),
    onInputTick: (inp) => session.sendInputTick(inp)
  }, {
    mode: 'net',
    netMode: session.isHost ? 'host' : 'guest',
    localIndex: session.localIndex,
    names: ['a', 'b']
  });
  engine.loadLevel(levelIndex);
  engine.entities.enemies.length = 0;
  engine.running = true;
  session.attachEngine(engine);
  return { session, engine, log, net };
}

const DT = 1 / 60;
function stepSide(side, dt) {
  side.engine.cb.onFrame?.(dt);
  side.engine._step(dt);
}
/** Gerçek saate kilitli koşum — CoopSession setInterval kullanıyor */
async function runRealtime(sides, ms, onTick) {
  let acc = 0, last = Date.now();
  const t0 = last;
  while (Date.now() - t0 < ms) {
    const now = Date.now();
    acc += (now - last) / 1000;
    last = now;
    while (acc >= DT) { for (const s of sides) stepSide(s, DT); acc -= DT; }
    onTick?.(Date.now() - t0);
    await sleep(2);
  }
}

try {
  /* ---------- Oda kur ---------- */
  const hostNet = new NetClient({ url: WS_URL });
  await hostNet.connect();
  const created = await hostNet.createRoom({ heroName: 'a', targetName: 'b', messages: ['bir', 'iki', 'üç'] });

  const guestNet = new NetClient({ url: WS_URL });
  await guestNet.connect();
  await guestNet.joinRoom(created.room, 'b');

  check('oda kuruldu ve misafir katıldı',
    hostNet.isHost && guestNet.isGuest && guestNet.room === created.room,
    `host=${hostNet.role} misafir=${guestNet.role}`);

  const host = buildSide(hostNet);
  const guest = buildSide(guestNet);

  /* ====================================================================
     1. GİRDİ GERÇEKTEN HOST'A ULAŞIYOR MU

     Kullanıcının gördüğü: misafir kendi ekranında yürüyor ama host'un
     ekranında doğuş noktasında duruyor, kalp toplamıyor, düşmanlar onu
     görmüyor. Yani host onu hiç simüle etmiyor.
     ==================================================================== */
  let inputPackets = 0;
  guestNet.on(MSG.INPUT, () => { inputPackets++; });   // geri dönmemeli
  const hostGotInput = [];
  hostNet.on(MSG.INPUT, (m) => { hostGotInput.push(m); });

  await runRealtime([host, guest], 600);   // bağlantı ısınsın

  const gi = guest.engine.inputs[1];
  gi.right = true;
  const hostStartX = host.engine.players[1].x;
  const guestStartX = guest.engine.players[1].x;
  let hostMaxX = hostStartX, guestMaxX = guestStartX;

  await runRealtime([host, guest], 2200, () => {
    hostMaxX = Math.max(hostMaxX, host.engine.players[1].x);
    guestMaxX = Math.max(guestMaxX, guest.engine.players[1].x);
  });
  gi.right = false;

  const hostMoved = hostMaxX - hostStartX;
  const guestMoved = guestMaxX - guestStartX;

  check('misafirin girdi paketleri SUNUCUDAN HOST\'A ULAŞIYOR',
    hostGotInput.length > 30, `${hostGotInput.length} paket`);
  check('paketin içinde tuş bitleri var',
    hostGotInput.some(m => (m.bits || 0) !== 0),
    `örnek=${JSON.stringify(hostGotInput[5] || null)}`);
  check('girdi gönderene geri dönmüyor',
    inputPackets === 0, `${inputPackets} paket geri geldi`);
  check('host misafirin girdisini motoruna işliyor',
    host.engine.inputs[1].lastSeq > 20, `lastSeq=${host.engine.inputs[1].lastSeq}`);

  check('MİSAFİRİN KARAKTERİ HOST\'UN DÜNYASINDA HAREKET EDİYOR',
    hostMoved > 60, `host tarafında ${hostMoved.toFixed(0)}px ilerledi`);
  check('misafir kendi ekranında da hareket ediyor',
    guestMoved > 60, `${guestMoved.toFixed(0)}px`);
  check('iki dünya birbirine yakın',
    Math.abs(hostMoved - guestMoved) < 100,
    `host=${hostMoved.toFixed(0)} misafir=${guestMoved.toFixed(0)}`);

  /* ====================================================================
     2. ETKİLEŞİM — kalp toplama

     "Kalp alamıyor" şikâyeti. Toplama kararı host'ta veriliyor; misafirin
     karakteri host'un dünyasında hareket etmiyorsa hiçbir kalbe değmiyor.
     ==================================================================== */
  const heart = host.engine.entities.hearts.find(h => !h.collected);
  if (heart) {
    /* İki tarafta da misafiri kalbin dibine koy — host yetkili, oradan
       toplanmalı ve sayaç İKİ ekranda da artmalı. */
    const before = host.engine.hearts;
    host.engine.players[1].x = heart.x - 6;
    host.engine.players[1].y = heart.y - 10;
    await runRealtime([host, guest], 700);
    check('MİSAFİRİN KARAKTERİ KALP TOPLAYABİLİYOR',
      host.engine.hearts > before, `${before} → ${host.engine.hearts}`);
    check('kalp sayacı misafirin ekranına da yansıyor',
      guest.engine.hearts === host.engine.hearts,
      `host=${host.engine.hearts} misafir=${guest.engine.hearts}`);
  }

  /* ====================================================================
     2b. MİSAFİRİN EYLEMLERİ — ok ve kılıç

     "Ok atamıyor" şikâyeti. Ok, yetkili dünyada host tarafından
     yaratılıyor; misafirin BASIŞ KENARI (`shootEdge`) host'a ulaşmazsa
     ok hiç var olmuyor. Basış sayaçları tam da bunun için var
     (bkz. Input.presses) ve şimdiye kadar uçtan uca sınanmamıştı.
     ==================================================================== */
  {
    host.engine.entities.arrows.length = 0;
    const gi2 = guest.engine.inputs[1];

    /* Klavyedeki keydown ne yapıyorsa aynısı */
    gi2.shootHeld = true;
    gi2._shootBuffer = 0.13;
    gi2.presses.shoot++;
    await runRealtime([host, guest], 500);
    gi2.shootHeld = false;
    await runRealtime([host, guest], 700);

    const mine = host.engine.entities.arrows.filter(a => a.ownerIndex === 1);
    check('MİSAFİR OK ATABİLİYOR (host\'un dünyasında ok var)',
      mine.length > 0, `${host.engine.entities.arrows.length} ok, misafirinki 0`);
    check('ok misafirin ekranına da geliyor',
      guest.engine.entities.arrows.length > 0,
      `${guest.engine.entities.arrows.length} ok`);

    /* Kılıç — saldırı zamanlayıcısı yarım saniyede sönüyor, bu yüzden
       sonunda bakmak yerine PENCERE BOYUNCA örnekliyoruz. (İlk sürümde
       sonunda baktım ve 0 gördüm: kodda değil ölçümde hata vardı.) */
    gi2.attackHeld = true;
    gi2._attackBuffer = 0.13;
    gi2.presses.attack++;
    let sawAttack = false;
    await runRealtime([host, guest], 900, () => {
      const p = host.engine.players[1];
      if ((p.attackTimer ?? 0) > 0 || p.state === 'attack') sawAttack = true;
    });
    gi2.attackHeld = false;
    check('misafirin kılıcı host tarafında işleniyor', sawAttack, 'hiç saldırı görülmedi');
  }

  /* ====================================================================
     2c. DÜŞMANLAR MİSAFİRİN EKRANINDA HAREKET EDİYOR MU

     Düşman yapay zekâsı yalnızca host'ta koşuyor; konumları anlık
     görüntüyle gidiyor. Misafirin ekranında donuk kalıp kalmadıklarını
     şimdiye kadar canlı hatta hiç ölçmemiştim.
     ==================================================================== */
  {
    host.engine.loadLevel(0);
    guest.engine.loadLevel(0);
    await runRealtime([host, guest], 900);

    const hostEnemies = host.engine.entities.enemies.length;
    const before = guest.engine.entities.enemies.map(e => ({ id: e.id, x: e.x, y: e.y }));
    await runRealtime([host, guest], 1500);

    const moved = guest.engine.entities.enemies.filter(e => {
      const b = before.find(o => o.id === e.id);
      return b && (Math.abs(e.x - b.x) > 2 || Math.abs(e.y - b.y) > 2);
    }).length;

    check('bölümde düşman var (test anlamlı)', hostEnemies > 0, `${hostEnemies} düşman`);
    check('DÜŞMANLAR MİSAFİRİN EKRANINDA HAREKET EDİYOR',
      moved > 0, `${before.length} düşmandan ${moved} tanesi kımıldadı`);

    /* Kimlikler eşleşiyor mu — global sayaçtan gelirken iki taraf farklı
       sayıda yükleme yapınca kayıyordu ve misafirin düşmanları kalıcı
       olarak siliniyordu. */
    const hostIds = host.engine.entities.enemies.map(e => e.id).sort().join(',');
    const guestIds = guest.engine.entities.enemies.map(e => e.id).sort().join(',');
    check('DÜŞMAN KİMLİKLERİ İKİ TARAFTA AYNI',
      hostIds === guestIds && hostIds.length > 0,
      `host=[${hostIds}] misafir=[${guestIds}]`);

    /* Konumlar iki dünyada da örtüşüyor mu.
       (Eşleşen düşman yoksa bu kontrol kendini doğrular; o yüzden
       eşleşme sayısını da şart koşuyoruz.) */
    let maxGap = 0, matched = 0;
    for (const he of host.engine.entities.enemies) {
      const ge = guest.engine.entities.enemies.find(e => e.id === he.id);
      if (!ge) continue;
      matched++;
      maxGap = Math.max(maxGap, Math.hypot(he.x - ge.x, he.y - ge.y));
    }
    check('düşman konumları iki ekranda örtüşüyor',
      matched === hostEnemies && maxGap < 60,
      `${matched}/${hostEnemies} eşleşti, en büyük fark ${maxGap.toFixed(0)}px`);
  }

  /* ====================================================================
     3. Anlık görüntü ters yönde akıyor mu
     ==================================================================== */
  const hi = host.engine.inputs[0];
  hi.right = true;
  const seenStart = guest.engine.players[0].x;
  let seenMax = seenStart;
  await runRealtime([host, guest], 1400, () => {
    seenMax = Math.max(seenMax, guest.engine.players[0].x);
  });
  hi.right = false;
  check('host\'un karakteri misafirin ekranında hareket ediyor',
    seenMax - seenStart > 50, `${(seenMax - seenStart).toFixed(0)}px`);

  /* ====================================================================
     4. Duraklatma ve hatıra — canlı hatta
     ==================================================================== */
  host.engine.storyUnlocked.push(0);
  await runRealtime([host, guest], 600);
  check('hatıra kartı canlı hatta misafire ulaşıyor',
    guest.log.story.length === 1, JSON.stringify(guest.log.story));

  host.engine.pause('local');
  await runRealtime([host, guest], 500);
  const guestPaused = guest.engine.state === 'paused';
  host.engine.resume('local');
  await runRealtime([host, guest], 700);
  check('host duraklatınca misafir de duruyor', guestPaused, guest.engine.state);
  check('host devam edince misafir de devam ediyor',
    guest.engine.state === 'playing', guest.engine.state);

  guest.engine.pause('local');
  await runRealtime([host, guest], 600);
  check('misafirin duraklatması canlı hatta host\'a geçiyor',
    host.engine.state === 'paused', host.engine.state);
  guest.engine.resume('local');
  await runRealtime([host, guest], 600);
  check('misafir devam edince host da devam ediyor',
    host.engine.state === 'playing', host.engine.state);

  check('sunucu hata vermedi', serverErrors.length === 0, serverErrors.join(' ').slice(0, 60));

  host.session.destroy(); guest.session.destroy();
  host.engine.stop(); guest.engine.stop();
  hostNet.close(); guestNet.close();
} catch (err) {
  check('test çöktü', false, err.message);
  console.error(err);
}

cleanupServer();

console.log('\n=== CANLI CO-OP TESTİ (gerçek sunucu) ===');
console.table(results);
if (failures === 0) console.log(`\n✔ ${results.length} kontrolün tamamı geçti.\n`);
else { console.log(`\n✘ ${failures}/${results.length} kontrol başarısız.\n`); process.exitCode = 1; }
process.exit(failures === 0 ? 0 : 1);
