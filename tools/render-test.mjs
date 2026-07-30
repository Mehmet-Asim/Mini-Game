/* ==========================================================================
   Çizim Katmanı Testi — başsız

       npm run test:render

   Neden var: co-op testleri motoru döndürüyor ama çizimi hiç denetlemiyordu.
   Onlardaki DOM taklidi her çağrıyı sessizce yutuyor — createRadialGradient
   NaN yarıçapla çağrılsa bile "tamam" diyor. Gerçek tarayıcı ise istisna
   atıyor ve o karenin GERİ KALANI hiç çizilmiyor: parçacıklar, ışıklar,
   ekran dışı yoldaş oku, hepsi kayboluyor.

   Tam olarak bu oldu: anlık görüntü mermilerin yalnızca konumunu taşıyordu,
   misafirde `size` ve `color` tanımsız kalıyordu ve büyücü ilk büyüsünü
   atınca misafirin ekranı o kareden itibaren bozuluyordu. Testler yeşildi.

   Bu yüzden buradaki tuval taklidi TİTİZ: sayısal argümanların sonlu,
   renklerin geçerli olduğunu doğruluyor ve ihlalde istisna atıyor.

   Kapsam:
     · üç bölümün tamamı, oynanış sırasında hatasız çiziliyor mu
     · boss dövüşünün her fazı hatasız çiziliyor mu
     · MİSAFİRİN ekranı — anlık görüntüden kurulmuş dünya hatasız mı
     · misafirde yoldaşın animasyonları gerçekten ilerliyor mu
     · co-op uzaklaşmasında kadraj kenarları hâlâ kapsanıyor mu
   ========================================================================== */

/* --------------------------------------------------------------------------
   TEKRARLANABİLİRLİK

   Düşman ve boss kararları Math.random() kullanıyor. Testi olduğu gibi
   bırakırsak her koşuda başka bir dövüş oynanıyor: bir çalıştırmada
   ejderha yorgunluk fazına giriyor, ötekinde 23 saniye boyunca hiç
   girmiyor ve test sebepsiz kırmızıya dönüyor. Sabit tohumla aynı dövüş
   her seferinde tekrar ediyor; bir hata yakalandığında da aynı şekilde
   yeniden üretilebiliyor.
   -------------------------------------------------------------------------- */
let _seed = 0x2f6e2b1 >>> 0;
Math.random = () => {
  _seed = (_seed + 0x6D2B79F5) >>> 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* --------------------------------------------------------------------------
   Titiz tuval taklidi
   -------------------------------------------------------------------------- */

const problems = [];
let drawCalls = 0;

function fail(msg) {
  if (problems.length < 40) problems.push(msg);
  throw new Error(msg);
}

/** Sayısal argümanların hepsi sonlu mu? */
function nums(name, args) {
  for (let i = 0; i < args.length; i++) {
    const v = args[i];
    if (typeof v === 'number' && !Number.isFinite(v)) {
      fail(`${name}() ${i}. argüman sonlu değil: ${v}`);
    }
  }
}

/** Renk/stil değeri çizilebilir mi? */
function checkStyle(prop, v) {
  if (v && typeof v === 'object') return;                // gradyan
  if (typeof v !== 'string') fail(`${prop} bir renk değil: ${typeof v} ${v}`);
  if (/NaN|undefined|Infinity/.test(v)) fail(`${prop} bozuk renk içeriyor: "${v}"`);
}

function strictCtx(width = 800, height = 500) {
  const gradient = {
    addColorStop(offset, color) {
      nums('addColorStop', [offset]);
      if (offset < 0 || offset > 1) fail(`addColorStop uzaklığı 0..1 dışında: ${offset}`);
      checkStyle('addColorStop rengi', color);
      return this;
    }
  };

  const ctx = {
    canvas: { width, height },
    createLinearGradient(...a) {
      nums('createLinearGradient', a);
      return gradient;
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      nums('createRadialGradient', [x0, y0, r0, x1, y1, r1]);
      /* Tarayıcı negatif yarıçapta IndexSizeError atar */
      if (r0 < 0 || r1 < 0) fail(`createRadialGradient negatif yarıçap: ${r0}, ${r1}`);
      return gradient;
    },
    createPattern: () => null,
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => {},
    setLineDash(arr) { nums('setLineDash', arr || []); }
  };

  for (const m of [
    'save', 'restore', 'beginPath', 'closePath', 'fill', 'stroke', 'clip',
    'translate', 'scale', 'rotate', 'setTransform', 'transform', 'resetTransform',
    'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo',
    'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'clearRect',
    'drawImage', 'fillText', 'strokeText'
  ]) {
    ctx[m] = (...a) => { drawCalls++; nums(m, a); };
  }

  /* Sayısal ve renk özelliklerini atama anında denetle */
  const guarded = {
    fillStyle: checkStyle, strokeStyle: checkStyle, shadowColor: checkStyle,
    globalAlpha: (p, v) => {
      nums(p, [v]);
      if (v < 0 || v > 1) fail(`${p} 0..1 dışında: ${v}`);
    },
    lineWidth: (p, v) => {
      nums(p, [v]);
      if (v < 0) fail(`${p} negatif: ${v}`);
    },
    shadowBlur: (p, v) => nums(p, [v]),
    lineDashOffset: (p, v) => nums(p, [v])
  };

  const store = {
    fillStyle: '#000', strokeStyle: '#000', shadowColor: '#000',
    globalAlpha: 1, lineWidth: 1, shadowBlur: 0, lineDashOffset: 0,
    globalCompositeOperation: 'source-over', lineCap: 'butt', lineJoin: 'miter',
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
    imageSmoothingEnabled: true, filter: 'none'
  };

  return new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return store[prop];
    },
    set(target, prop, value) {
      const check = guarded[prop];
      if (check) check(prop, value);
      store[prop] = value;
      return true;
    }
  });
}

/* --------------------------------------------------------------------------
   DOM taklidi
   -------------------------------------------------------------------------- */

const sharedCtx = strictCtx();

globalThis.window = {
  devicePixelRatio: 1,
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  innerWidth: 800,
  innerHeight: 500
};
globalThis.document = {
  createElement: () => ({
    id: '', style: {}, width: 800, height: 500,
    getContext: () => sharedCtx
  })
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

function fakeContainer() {
  return {
    appendChild: () => {},
    getBoundingClientRect: () => ({ width: 800, height: 500, x: 0, y: 0 })
  };
}

const { GameEngine } = await import('../src/game/engine.js');
const { Projectile, Arrow } = await import('../src/game/entities.js');
const { serializeSnapshot, applySnapshot } = await import('../src/net/snapshot.js');
const { LEVELS } = await import('../src/game/levels.js');

/* --------------------------------------------------------------------------
   İskelet
   -------------------------------------------------------------------------- */

const results = [];
let failures = 0;

function check(name, cond, detail = '') {
  results.push({ test: name, sonuç: cond ? '✔' : '✘', not: cond ? '' : String(detail).slice(0, 70) });
  if (!cond) failures++;
}

const DT = 1 / 60;

function makeEngine(opts = {}, levelIndex = 0) {
  const eng = new GameEngine(fakeContainer(), {
    onHud: () => {}, onToast: () => {}, onStory: () => {},
    onDeath: () => {}, onLevelComplete: () => {}, onGameComplete: () => {},
    onBossStart: () => {}, onPause: () => {}
  }, opts);
  eng.loadLevel(levelIndex);
  return eng;
}

/** Motoru döndür ve HER karede çiz — çizim hatası anında yakalanır */
function runAndRender(eng, frames, drive) {
  for (let i = 0; i < frames; i++) {
    if (drive) drive(i, eng);
    eng._step(DT);
    eng.renderer.render(eng._renderState(), DT);
  }
}

function tryRun(label, fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return `${label}: ${err.message}`;
  }
}

/* --------------------------------------------------------------------------
   1. Üç bölüm de oynanırken hatasız çiziliyor mu
   -------------------------------------------------------------------------- */
for (let li = 0; li < LEVELS.length; li++) {
  const err = tryRun(`bölüm ${li + 1}`, () => {
    const eng = makeEngine({ mode: 'local' }, li);
    runAndRender(eng, 420, (i) => {
      /* İki karakteri de gezdirip saldırt: kılıç, yay, siper, zıplama */
      for (const inp of eng.inputs) {
        inp.right = i % 180 < 130;
        inp.left = i % 180 >= 130;
        if (i % 26 === 0) { inp._attackBuffer = 0.13; inp.attackHeld = true; }
        if (i % 26 === 6) inp.attackHeld = false;
        if (i % 40 === 0) inp._shootBuffer = 0.13;
        if (i % 55 === 0) inp._jumpBuffer = 0.13;
        inp.blockHeld = i % 200 > 170;
      }
      if (i === 40) for (const p of eng.players) p.hasShield = true;
    });
    eng.stop();
  });
  check(`bölüm ${li + 1} oynanış çizimi temiz`, !err, err);
}

/* --------------------------------------------------------------------------
   2. Boss dövüşünün tüm fazları
   -------------------------------------------------------------------------- */
{
  const seenStates = new Set();
  const err = tryRun('boss', () => {
    const eng = makeEngine({ mode: 'local' }, 2);
    const def = LEVELS[2].boss;
    /* Oyuncuları arenaya taşı, kalkanı ver, boss'u tetikle */
    for (const p of eng.players) {
      p.x = def.triggerX + 40;
      p.y = 440;
      p.hasShield = true;
    }
    runAndRender(eng, 2200, (i) => {
      if (eng.boss) {
        seenStates.add(eng.boss.state);
        /* Fazları hızlandırmak için düzenli hasar ver */
        if (i % 300 === 0 && eng.boss.vulnerable) eng.boss.takeHit(eng._ctx());
      }
      for (const inp of eng.inputs) {
        inp.right = i % 90 < 45;
        inp.left = i % 90 >= 45;
        inp.blockHeld = i % 150 > 120;
        if (i % 30 === 0) inp._attackBuffer = 0.13;
        if (i % 34 === 0) inp._shootBuffer = 0.13;
      }
    });
    eng.stop();
  });
  check('boss dövüşü çizimi temiz', !err, err);
  check('boss birden çok faz gösterdi', seenStates.size >= 4, [...seenStates].join(','));
  check('boss telegraf fazına giriyor', seenStates.has('telegraph'), [...seenStates].join(','));
}

/* --------------------------------------------------------------------------
   3. MİSAFİRİN EKRANI — asıl regresyon testi

   Anlık görüntüden kurulmuş dünya çizilebilir olmak zorunda. Mermi ve ok
   listeleri host'ta gerçek sınıflarken misafirde düz nesneye dönüşüyor;
   görsel alanlar (size, color, angle) eksik kalırsa çizim çöker.
   -------------------------------------------------------------------------- */
{
  const host = makeEngine({ mode: 'net', netMode: 'host', localIndex: 0 }, 2);
  const guest = makeEngine({ mode: 'net', netMode: 'guest', localIndex: 1 }, 2);

  /* Her mermi türünden en az bir örnek + havada ve saplanmış ok */
  host.entities.projectiles.push(
    new Projectile({ x: 400, y: 300, vx: 120, vy: -40, color: '#a76bff', size: 7, kind: 0 }),
    new Projectile({ x: 460, y: 280, vx: -90, vy: 30, color: '#ff7a2a', size: 9, kind: 1, fromBoss: true }),
    new Projectile({ x: 520, y: 260, vx: 20, vy: 140, color: '#ff5a20', size: 8, kind: 2, fromBoss: true })
  );
  host.entities.projectiles[0].deflect(1);

  const flying = new Arrow({ x: 380, y: 320, vx: 640, vy: -40, dir: 1 });
  const stuck = new Arrow({ x: 300, y: 400, vx: 600, vy: 120, dir: 1 });
  stuck.stuck = true;
  stuck.stuckTimer = 0.4;
  stuck.vx = stuck.vy = 0;
  host.entities.arrows.push(flying, stuck);

  const snap = serializeSnapshot(host, 1);

  const projErr = tryRun('mermi/ok aktarımı', () => {
    applySnapshot(guest, snap, 1);
  });
  check('anlık görüntü misafire uygulanabiliyor', !projErr, projErr);

  const gp = guest.entities.projectiles;
  check('mermi sayısı korundu', gp.length === 3, gp.length);
  check('mermi boyutu misafirde kuruldu',
    gp.every(p => Number.isFinite(p.size) && p.size > 0),
    gp.map(p => p.size).join(','));
  check('mermi rengi misafirde kuruldu',
    gp.every(p => typeof p.color === 'string' && p.color.startsWith('#')),
    gp.map(p => p.color).join(','));
  check('sektirilen mermi misafirde de altın',
    gp[0].deflected && gp[0].color === '#ffd76b',
    `${gp[0].deflected} ${gp[0].color}`);

  const ga = guest.entities.arrows;
  check('ok açısı misafirde tanımlı',
    ga.every(a => Number.isFinite(a.angle)),
    ga.map(a => a.angle).join(','));
  check('saplanmış ok bilgisi taşındı',
    ga[1].stuck && Number.isFinite(ga[1].stuckTimer),
    `${ga[1].stuck} ${ga[1].stuckTimer}`);

  const drawErr = tryRun('misafir çizimi', () => {
    guest.renderer.render(guest._renderState(), DT);
  });
  check('MİSAFİR ekranı hatasız çiziliyor', !drawErr, drawErr);

  host.stop();
  guest.stop();
}

/* --------------------------------------------------------------------------
   3b. MİSAFİR ve BOSS

   Ejderhanın yapay zekâsı yalnızca host'ta koşuyor, ama nesnenin misafirde
   de var olması gerekiyor. Eskiden misafir hiç Dragon yaratmıyordu:
   arena kilidi açılmıyor, can çubuğu görünmüyor ve ekranda ejderha
   olmadığı için oyuncu görünmez bir şeyle dövüşüyordu.
   -------------------------------------------------------------------------- */
{
  /* Önceki testlerin Math.random tüketimi bu dövüşü kaydırabiliyordu.
     Boss senkron kontrolünü sabit tohumla yalıtıyoruz. */
  _seed = 0x2f6e2b1 >>> 0;

  const host = makeEngine({ mode: 'net', netMode: 'host', localIndex: 0 }, 2);
  const guest = makeEngine({ mode: 'net', netMode: 'guest', localIndex: 1 }, 2);
  const def = LEVELS[2].boss;

  for (const eng of [host, guest]) {
    for (const p of eng.players) { p.x = def.triggerX + 40; p.y = 440; p.hasShield = true; }
  }
  /* Host'ta boss'u tetikle ve birkaç saniye döndür */
  for (let i = 0; i < 240; i++) host._step(DT);
  check('host boss\'u tetikledi', !!host.boss, 'boss yok');

  const applyErr = tryRun('boss aktarımı', () => {
    applySnapshot(guest, serializeSnapshot(host, 3), 1);
  });
  check('boss anlık görüntüsü misafire uygulanabiliyor', !applyErr, applyErr);
  check('MİSAFİR ejderhayı yarattı', !!guest.boss, 'misafirde boss yok');
  check('misafirde arena kilidi devreye girdi',
    guest.level.minX === def.arenaMinX, guest.level.minX);
  check('misafirde boss canı doğru', guest.boss && guest.boss.hp === host.boss.hp,
    `${guest.boss?.hp} / ${host.boss?.hp}`);

  /* Telegraph + savunmasızlık misafire geçiyor mu */
  let sawTelegraph = false, sawVulnerable = false;
  const loopErr = tryRun('misafir boss çizimi', () => {
    for (let i = 0; i < 1400; i++) {
      if (host.boss && i % 260 === 0 && host.boss.vulnerable) host.boss.takeHit(host._ctx());
      host._step(DT);
      if (i % 3 === 0) applySnapshot(guest, serializeSnapshot(host, 100 + i), 1);
      guest._step(DT);
      guest.renderer.render(guest._renderState(), DT);
      if (guest.boss?.state === 'telegraph') sawTelegraph = true;
      if (guest.boss?.vulnerable) sawVulnerable = true;
    }
  });
  check('misafirde boss dövüşü hatasız çiziliyor', !loopErr, loopErr);
  check('misafir hazırlık fazını görüyor', sawTelegraph, 'telegraph görülmedi');
  check('misafir savunmasız anı görüyor', sawVulnerable, 'tired görülmedi');

  host.stop();
  guest.stop();
}

/* --------------------------------------------------------------------------
   4. Misafirde yoldaşın animasyonları ilerliyor mu

   Yoldaşın fiziği misafirde çalışmaz. Eskiden `update()` hiç çağrılmadığı
   için runCycle ve attackTimer da hiç kımıldamıyordu: yoldaş donmuş
   bacaklarla kayıyor, kılıç savurduğu hiç görünmüyordu.
   -------------------------------------------------------------------------- */
{
  const host = makeEngine({ mode: 'net', netMode: 'host', localIndex: 0 }, 0);
  const guest = makeEngine({ mode: 'net', netMode: 'guest', localIndex: 1 }, 0);

  /* Host'ta 0. oyuncu koşuyor ve tam paket anında kılıç savuruyor */
  for (let i = 0; i < 40; i++) {
    host.inputs[0].right = true;
    if (i === 36) host.inputs[0]._attackBuffer = 0.13;
    host._step(DT);
  }
  check('host tarafında kılıç savruluyor', host.players[0].attackTimer > 0, host.players[0].attackTimer);

  applySnapshot(guest, serializeSnapshot(host, 2), 1);
  check('yoldaşın kılıcı misafire ulaştı',
    guest.players[0].attackTimer > 0, guest.players[0].attackTimer);

  const before = {
    run: guest.players[0].runCycle,
    anim: guest.players[0].animTime,
    atk: guest.players[0].attackTimer
  };
  for (let i = 0; i < 8; i++) guest._step(DT);

  check('yoldaşın koşu döngüsü ilerliyor',
    guest.players[0].runCycle > before.run,
    `${before.run} → ${guest.players[0].runCycle}`);
  check('yoldaşın animasyon saati ilerliyor',
    guest.players[0].animTime > before.anim);
  check('yoldaşın savurması yerel olarak akıyor',
    guest.players[0].attackTimer < before.atk,
    `${before.atk} → ${guest.players[0].attackTimer}`);

  const err = tryRun('yoldaş çizimi', () => {
    guest.renderer.render(guest._renderState(), DT);
  });
  check('yoldaş savururken çizim temiz', !err, err);

  host.stop();
  guest.stop();
}

/* --------------------------------------------------------------------------
   5. Kamera: zoom'a duyarlı kırpma ve kadraj
   -------------------------------------------------------------------------- */
{
  const { Camera } = await import('../src/core/camera.js');
  const cam = new Camera(800, 500);
  cam.setBounds(0, 4000, -260, 1000);

  /* Uzaklaşmış kamera: ekranda dünyanın daha fazlası görünür */
  cam.zoomTarget = 0.62;
  for (let i = 0; i < 200; i++) cam.update(DT);
  check('zoom hedefe ulaştı', Math.abs(cam.zoom - 0.62) < 0.01, cam.zoom);
  check('görünen alan ekrandan geniş', cam.viewW > cam.w + 100, `${cam.viewW} / ${cam.w}`);

  cam.x = 1000; cam.y = 100;
  /* Ekranın sol kenarının hemen dışındaki bir nesne, uzaklaşmış kamerada
     GÖRÜNÜR olmalı. Eski hesap bunu kırpıyor ve zemin kayboluyordu. */
  const edgeX = cam.offsetX + cam.screenLeft + 20;
  check('uzaklaşmada sol kenar hâlâ kapsanıyor',
    cam.isVisible(edgeX, cam.offsetY + 250, 0), `screenLeft=${cam.screenLeft.toFixed(0)}`);
  check('gerçekten uzaktaki nesne kırpılıyor',
    !cam.isVisible(cam.offsetX + cam.screenLeft - 400, cam.offsetY + 250, 0));

  /* İki oyuncuyu kadraja alırken orta nokta ekranın ortasına gelmeli */
  const cam2 = new Camera(800, 500);
  cam2.setBounds(0, 6000, -1000, 2000);
  const pts = [{ x: 2600, y: 400 }, { x: 3400, y: 400 }];
  for (let i = 0; i < 600; i++) { cam2.followGroup(pts, DT); cam2.update(DT); }
  const midScreen = 3000 - cam2.offsetX;
  check('co-op kadrajı çifti ortalıyor',
    Math.abs(midScreen - cam2.w / 2) < 12,
    `orta ekranda ${midScreen.toFixed(0)}px, beklenen ${cam2.w / 2}`);
  check('co-op kadrajı uzaklaştı', cam2.zoom < 1, cam2.zoom);

  /* Darbe zoomu kadraj kararını bozmamalı */
  const beforeBase = cam2.zoomBase;
  cam2.punchZoom(0.06);
  check('darbe zoomu ölçeği anında büyütüyor', cam2.zoom > beforeBase, `${beforeBase} → ${cam2.zoom}`);
  check('darbe zoomu kadraj ölçeğine dokunmuyor',
    Math.abs(cam2.zoomBase - beforeBase) < 1e-9, `${beforeBase} → ${cam2.zoomBase}`);
  for (let i = 0; i < 120; i++) { cam2.followGroup(pts, DT); cam2.update(DT); }
  check('darbe zoomu sönüyor', Math.abs(cam2.punch) < 0.002, cam2.punch);
  check('sönme sonrası kadraj korundu', Math.abs(cam2.zoomBase - beforeBase) < 0.01, cam2.zoomBase);
}

/* --------------------------------------------------------------------------
   6. Sınır: uzaklaşmış kamera bölümün dışını göstermemeli
   -------------------------------------------------------------------------- */
{
  const { Camera } = await import('../src/core/camera.js');
  const cam = new Camera(800, 500);
  cam.setBounds(0, 2000, -260, 900);
  cam.zoomBase = cam.zoomTarget = 0.62;
  cam.x = cam._clampX(99999);
  const rightEdgeWorld = cam.offsetX + cam.screenRight;
  check('sağ sınır aşılmıyor', rightEdgeWorld <= 2000 + 1, rightEdgeWorld.toFixed(0));
  cam.x = cam._clampX(-99999);
  const leftEdgeWorld = cam.offsetX + cam.screenLeft;
  check('sol sınır aşılmıyor', leftEdgeWorld >= -1, leftEdgeWorld.toFixed(0));
}

/* --------------------------------------------------------------------------
   7. Düşman hazırlık hareketleri

   Kurt artık çökmeden sıçramıyor, yarasa gerilmeden dalmıyor. İkisi de
   yeni durumlar; çizimde kullanılan alanların hepsi tanımlı kalmalı.

   Yarasa için ayrıca ESKİ BİR HATA sınanıyor: dalış bitince konumu
   `baseX + sin(animTime)` formülüne geri dönüyordu ve sinüs o an rastgele
   bir fazda olduğu için yarasa tek karede 150 pikselе kadar ışınlanıyordu.
   -------------------------------------------------------------------------- */
{
  const { Walker, Flyer, Caster } = await import('../src/game/entities.js');
  const eng = makeEngine({ mode: 'solo' }, 0);
  const ctx = eng._ctx();

  /* --- Kurt: çök → sıçra → toparlan --- */
  const wolf = new Walker({ x: 400, y: 500, minX: 200, maxX: 900 });
  eng.entities.enemies = [wolf];
  const player = eng.players[0];
  player.x = 470; player.y = 500;
  ctx.player = player;

  const seen = new Set();
  let wolfErr = null;
  for (let i = 0; i < 400 && !wolfErr; i++) {
    /* Oyuncu mesafesini koruyor: kurdun üstüne yapışmasını engellemek için
       her karede kurdun 80 px önüne yerleşiyor. Gerçek oyunda bu mesafeyi
       hasar ve geri savrulma sağlıyor. */
    player.x = wolf.x + 80;
    wolf.update(DT, ctx);
    if (wolf.windup > 0) seen.add('windup');
    if (wolf.leap > 0) seen.add('leap');
    if (wolf.recover > 0) seen.add('recover');
    wolfErr = tryRun('kurt çizimi', () => eng.renderer.render(eng._renderState(), DT));
  }
  check('kurt çökme hazırlığı yapıyor', seen.has('windup'), [...seen].join(','));
  check('kurt sıçrıyor', seen.has('leap'), [...seen].join(','));
  check('kurt inişte toparlanma penceresi veriyor', seen.has('recover'), [...seen].join(','));
  check('kurdun atak evreleri hatasız çiziliyor', !wolfErr, wolfErr);
  check('kurt devriye sınırları içinde kaldı',
    wolf.x >= wolf.minX - 1 && wolf.x + wolf.w <= wolf.maxX + 1, wolf.x.toFixed(0));

  /* --- Yarasa: gerilme, dalış ve YUMUŞAK dönüş --- */
  const bat = new Flyer({ x: 600, y: 300, rangeX: 150, amp: 46 });
  eng.entities.enemies = [bat];
  player.x = 620; player.y = 320;

  let maxStep = 0, sawWindup = false, sawDive = false, batErr = null;
  let prev = { x: bat.x, y: bat.y };
  for (let i = 0; i < 600 && !batErr; i++) {
    bat.update(DT, ctx);
    if (bat.windup > 0) sawWindup = true;
    if (bat.diving) sawDive = true;
    /* Bir karede atlanan mesafe: 320 px/sn dalış hızı = 5.3 px/kare.
       Işınlanma bunun kat kat üstünde olurdu. */
    maxStep = Math.max(maxStep, Math.hypot(bat.x - prev.x, bat.y - prev.y));
    prev = { x: bat.x, y: bat.y };
    batErr = tryRun('yarasa çizimi', () => eng.renderer.render(eng._renderState(), DT));
  }
  check('yarasa dalış öncesi geriliyor', sawWindup);
  check('yarasa dalış yapıyor', sawDive);
  check('yarasa dalıştan sonra ışınlanmıyor', maxStep < 12, `en büyük kare adımı ${maxStep.toFixed(1)}px`);
  check('yarasa çizimi hatasız', !batErr, batErr);

  /* --- Büyücü: şarj → atış → geri tepme --- */
  const mage = new Caster({ x: 300, y: 480, dir: 1 });
  eng.entities.enemies = [mage];
  eng.entities.projectiles = [];
  player.x = 520; player.y = 480;

  let sawCharge = false, sawRecoil = false, mageErr = null;
  for (let i = 0; i < 300 && !mageErr; i++) {
    mage.update(DT, ctx);
    if (mage.charging > 0.4) sawCharge = true;
    if (mage.recoil > 0) sawRecoil = true;
    mageErr = tryRun('büyücü çizimi', () => eng.renderer.render(eng._renderState(), DT));
  }
  check('büyücü şarj hareketi yapıyor', sawCharge);
  check('büyücü atıştan sonra geri tepiyor', sawRecoil);
  check('büyücü mermisini asadan çıkarıyor',
    eng.entities.projectiles.length > 0 &&
    eng.entities.projectiles.every(pr => pr.y < mage.y + 12),
    eng.entities.projectiles.map(pr => Math.round(pr.y)).join(','));
  check('büyücü çizimi hatasız', !mageErr, mageErr);

  eng.stop();
}

/* --------------------------------------------------------------------------
   8. Misafirde düşmanlar canlı mı

   Misafirde düşman `update()` çalışmıyor. Eskiden animasyon saatleri de
   hiç ilerlemiyordu: kurtlar bacakları kıpırdamadan kayıyor, yarasaların
   kanatları donuyor ve ölen düşman animasyonu oynamadan yok oluyordu.
   Hazırlık hareketleri de ağdan geçmediği için misafire uyarısız
   saldırılıyordu.
   -------------------------------------------------------------------------- */
{
  const host = makeEngine({ mode: 'net', netMode: 'host', localIndex: 0 }, 0);
  const guest = makeEngine({ mode: 'net', netMode: 'guest', localIndex: 1 }, 0);

  /* İki tarafta aynı düşman kimlikleri olsun */
  guest.entities.enemies.forEach((en, i) => {
    const h = host.entities.enemies[i];
    if (h) { en.id = h.id; en.x = h.x; en.y = h.y; }
  });

  applySnapshot(guest, serializeSnapshot(host, 1), 1);
  const ge = guest.entities.enemies[0];
  check('misafirde düşman var', !!ge, guest.entities.enemies.length);

  const beforeAnim = ge.animTime;
  for (let i = 0; i < 10; i++) guest._step(DT);
  check('misafirde düşman animasyon saati ilerliyor',
    ge.animTime > beforeAnim, `${beforeAnim.toFixed(2)} → ${ge.animTime.toFixed(2)}`);

  /* Kurdun hazırlığı ve yönü ağdan geçiyor mu */
  const hw = host.entities.enemies.find(en => en.type === 'walker');
  const gw = guest.entities.enemies.find(en => en.id === hw?.id);
  if (hw && gw) {
    hw.dir = -1;
    hw.windup = 0.5;
    hw.aggro = 0.9;
    applySnapshot(guest, serializeSnapshot(host, 2), 1);
    check('kurdun yönü misafire geçti', gw.dir === -1, gw.dir);
    check('kurdun hazırlığı misafire geçti', Math.abs(gw.windup - 0.5) < 0.02, gw.windup);
    check('kurdun öfkesi misafire geçti', Math.abs(gw.aggro - 0.9) < 0.02, gw.aggro);

    hw.windup = 0;
    hw.leap = 0.5;
    applySnapshot(guest, serializeSnapshot(host, 3), 1);
    check('kurdun sıçraması misafire geçti',
      gw.windup === 0 && Math.abs(gw.leap - 0.5) < 0.02, `${gw.windup} / ${gw.leap}`);

    hw.leap = 0;
    hw.recover = 0.2;
    applySnapshot(guest, serializeSnapshot(host, 4), 1);
    check('kurdun toparlanması misafire geçti',
      gw.leap === 0 && gw.recover > 0.1, `${gw.leap} / ${gw.recover}`);
  }

  /* Ölüm animasyonu misafirde OYNAMALI, düşman bir karede yok olmamalı */
  const victim = host.entities.enemies[0];
  const gVictim = guest.entities.enemies.find(en => en.id === victim.id);
  host.entities.enemies = host.entities.enemies.filter(en => en.id !== victim.id);
  applySnapshot(guest, serializeSnapshot(host, 5), 1);
  check('misafirde ölüm animasyonu başlıyor',
    !!gVictim && gVictim.dying && gVictim.alive, `${gVictim?.dying} / ${gVictim?.alive}`);

  const dieErr = tryRun('ölüm çizimi', () => guest.renderer.render(guest._renderState(), DT));
  check('ölen düşman hatasız çiziliyor', !dieErr, dieErr);

  for (let i = 0; i < 30; i++) guest._step(DT);
  check('animasyon bitince düşman listeden düşüyor',
    !guest.entities.enemies.some(en => en.id === victim.id));

  host.stop();
  guest.stop();
}

/* --------------------------------------------------------------------------
   Rapor
   -------------------------------------------------------------------------- */

console.log('\n=== ÇİZİM KATMANI TESTİ ===');
console.table(results);
console.log(`Çizim çağrısı: ${drawCalls.toLocaleString('tr-TR')}`);

if (failures === 0) {
  console.log(`\n✔ ${results.length} kontrolün tamamı geçti.\n`);
} else {
  console.log(`\n✘ ${failures}/${results.length} kontrol başarısız.\n`);
  for (const p of problems.slice(0, 10)) console.log(`   · ${p}`);
  process.exitCode = 1;
}
