/* ==========================================================================
   Co-op Motor Testi — başsız

       npm run test:coop

   Oyun motorunu tarayıcı olmadan çalıştırır. Minik bir DOM taklidi kuruyoruz
   (canvas, window, container) ve sonra motoru gerçek fizik adımlarıyla
   döndürüp iki karakterin davranışını ölçüyoruz.

   Neden değerli: co-op dönüşümü 800 satırlık bir motoru tek oyuncudan iki
   oyuncuya çevirdi. "Tarayıcıda bir bakarım" ile bu doğrulanamaz — plakanın
   tek kişiyle açılıp açılmadığını ancak kontrollü bir simülasyon söyler.

   Kapsam:
     · iki oyuncu ayrı noktalarda doğuyor mu
     · plaka yalnızca üstünde biri varken aktif mi
     · ÇİFT plakalı kapı tek oyuncuyla AÇILAMIYOR mu   ← co-op'un tüm anlamı
     · ortak asansör tek kişiyle kalkmıyor mu
     · yere serilme → yoldaş kaldırma döngüsü
     · ikisi de yerdeyse tur bitiyor mu
     · bölüm yalnızca İKİSİ de geçitteyken bitiyor mu
     · tek oyunculu mod hâlâ bozulmadan çalışıyor mu
   ========================================================================== */

/* --------------------------------------------------------------------------
   DOM taklidi — motor için gereken en küçük yüzey
   -------------------------------------------------------------------------- */

function fakeCtx() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const ctx = {
    canvas: { width: 800, height: 500 },
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => null,
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop
  };
  for (const m of [
    'save', 'restore', 'beginPath', 'closePath', 'fill', 'stroke', 'clip',
    'translate', 'scale', 'rotate', 'setTransform', 'transform', 'resetTransform',
    'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo',
    'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'clearRect',
    'drawImage', 'fillText', 'strokeText', 'setLineDash'
  ]) ctx[m] = noop;
  return ctx;
}

const listeners = new Map();
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener: (t, fn) => {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t).add(fn);
  },
  removeEventListener: (t, fn) => listeners.get(t)?.delete(fn),
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  innerWidth: 800,
  innerHeight: 500
};
globalThis.document = {
  createElement: () => ({
    id: '', style: {}, width: 800, height: 500,
    getContext: () => fakeCtx()
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
const { LEVELS } = await import('../src/game/levels.js');

/* --------------------------------------------------------------------------
   Test iskeleti
   -------------------------------------------------------------------------- */

const results = [];
let failures = 0;

function check(name, cond, detail = '') {
  results.push({ test: name, sonuç: cond ? '✔' : '✘', not: cond ? '' : String(detail).slice(0, 60) });
  if (!cond) failures++;
}

const DT = 1 / 60;

function makeEngine(mode = 'local', levelIndex = 0, quiet = true) {
  const eng = new GameEngine(fakeContainer(), {
    onHud: () => {}, onToast: () => {}, onStory: () => {},
    onDeath: () => {}, onLevelComplete: () => {}, onGameComplete: () => {},
    onBossStart: () => {}, onPause: () => {}
  }, { mode });
  eng.lives = 3;
  eng.loadLevel(levelIndex);
  /* Mekanizma testlerinde düşmanlar kapatılıyor: rastgele başlangıç
     fazları yüzünden bir yarasa oyuncuyu plakadan itebiliyor ve test
     kararsız hale geliyor. Ölçmek istediğimiz şey mekanizma, savaş değil. */
  if (quiet) { eng.entities.enemies.length = 0; eng.entities.projectiles.length = 0; }
  return eng;
}

/** N kare simüle et; her karede tuşları ayarlamak için hook */
function run(eng, frames, drive) {
  for (let i = 0; i < frames; i++) {
    if (drive) drive(i);
    eng._step(DT);
  }
}

/** Oyuncuyu bir noktaya ışınla (test kolaylığı — fizik yine çalışır) */
function place(p, x, y) {
  p.x = x; p.y = y; p.vx = 0; p.vy = 0;
  p.downed = false; p.dead = false;
}

/* --------------------------------------------------------------------------
   1. Doğuş
   -------------------------------------------------------------------------- */
{
  const eng = makeEngine('local', 0);
  check('iki oyuncu yaratıldı', eng.players.length === 2, eng.players.length);
  check('oyuncular ayrı noktalarda doğuyor',
    Math.abs(eng.players[0].x - eng.players[1].x) > 20,
    `${eng.players[0].x} / ${eng.players[1].x}`);
  check('ikisinin de girdisi var', eng.inputs.length === 2 && !!eng.inputs[1]);
  check('renk paletleri farklı',
    eng.players[0].palette.cape !== eng.players[1].palette.cape);
  eng.stop();
}

/* --------------------------------------------------------------------------
   2. Plaka davranışı (Bölüm 1)
   -------------------------------------------------------------------------- */
{
  const eng = makeEngine('local', 0);
  const [p1, p2] = eng.entities.plates;
  const gate = eng.entities.gates[0];

  check('bölüm 1 plakaları yüklendi', eng.entities.plates.length === 2, eng.entities.plates.length);
  check('bölüm 1 kapısı yüklendi', !!gate);

  run(eng, 10);
  check('kapı başlangıçta kapalı', gate.open < 0.1 && gate.solid, gate.open);
  check('plaka başlangıçta pasif', !p1.active);

  /* Tek oyuncu plakada → o plaka aktif, ama kapı iki plaka istiyor */
  place(eng.players[0], p1.x + 20, p1.y - 44);
  place(eng.players[1], 300, 300);
  run(eng, 60);
  check('üstünde biri varken plaka aktif', p1.active, `holders=${p1.holders}`);
  check('diğer plaka hâlâ pasif', !p2.active);
  check('tek plakayla kapı açılmıyor', gate.open < 0.2, gate.open);

  /* İkinci oyuncu diğer plakaya bassın */
  place(eng.players[1], p2.x + 20, p2.y - 44);
  run(eng, 150);
  check('iki plakayla kapı açıldı', gate.open > 0.9, gate.open);
  check('açık kapı katı değil', !gate.solid, gate.open);

  /* Kapı bir kez açıldıktan sonra AÇIK KALMALI — yoksa plakadan inip
     geçmeye çalışırken kapı yüzlerine kapanır ve bulmaca çözülemez olur. */
  place(eng.players[0], 300, 300);
  place(eng.players[1], 320, 300);
  run(eng, 180);
  check('açılan kapı açık kalıyor (kilitlendi)', gate.open > 0.9 && gate.latched, `open=${gate.open} latched=${gate.latched}`);
  eng.stop();
}

/* --------------------------------------------------------------------------
   3. EN ÖNEMLİ TEST — çift plakalı kapı tek kişiyle açılamamalı
   -------------------------------------------------------------------------- */
{
  const eng = makeEngine('local', 1);
  const gate = eng.entities.gates[0];
  const [q1, q2] = eng.entities.plates;

  check('bölüm 2 çift plakalı kapı var', gate.needs.length === 2, JSON.stringify(gate.needs));
  check('plakalar tek kişinin kapsayamayacağı kadar ayrı',
    Math.abs(q1.x - q2.x) > 60 || Math.abs(q1.y - q2.y) > 40,
    `dx=${Math.abs(q1.x - q2.x)} dy=${Math.abs(q1.y - q2.y)}`);

  /* Tek oyuncu birinci plakada, diğeri çok uzakta */
  place(eng.players[0], q1.x + 20, q1.y - 44);
  place(eng.players[1], 300, 300);
  run(eng, 120);
  check('TEK plakayla kapı AÇILMIYOR', gate.open < 0.2, gate.open);

  /* Aynı oyuncu iki plakaya birden basmaya çalışsın — imkânsız olmalı */
  place(eng.players[0], (q1.x + q2.x) / 2, q1.y - 44);
  run(eng, 60);
  check('bir oyuncu iki plakaya birden basamıyor',
    !(q1.active && q2.active), `q1=${q1.active} q2=${q2.active}`);

  /* İkisi de plakalara bassın */
  place(eng.players[0], q1.x + 20, q1.y - 44);
  place(eng.players[1], q2.x + 20, q2.y - 44);
  run(eng, 150);
  check('İKİ plakayla kapı açılıyor', gate.open > 0.9, gate.open);
  eng.stop();
}

/* --------------------------------------------------------------------------
   4. Ortak asansör
   -------------------------------------------------------------------------- */
{
  const eng = makeEngine('local', 0);
  const lift = eng.entities.coopLifts[0];
  check('bölüm 1 ortak asansörü var', !!lift);

  const y0 = lift.y;
  /* İkisini de asansörün SOL yarısına koy — sağ üstte platform var,
     oraya konursa oyuncu asansöre değil platforma iner. */
  place(eng.players[0], lift.x + 10, lift.y - 44);
  place(eng.players[1], 300, 300);
  run(eng, 120);
  check('tek kişiyle asansör kalkmıyor', Math.abs(lift.y - y0) < 4, `${y0} → ${lift.y}`);

  place(eng.players[1], lift.x + 55, lift.y - 44);
  run(eng, 120);
  check('iki kişiyle asansör kalkıyor', lift.y < y0 - 40, `${y0} → ${lift.y.toFixed(0)}`);

  /* Biri inince asansör geri iner */
  place(eng.players[1], 300, 300);
  run(eng, 420);
  check('biri inince asansör geri iniyor', lift.y > y0 - 30, `${lift.y.toFixed(0)} (taban ${y0})`);
  eng.stop();
}

/* --------------------------------------------------------------------------
   5. Yere serilme ve kaldırma
   -------------------------------------------------------------------------- */
{
  const eng = makeEngine('local', 0);
  const [a, b] = eng.players;

  eng.lives = 1;
  eng._takeDamage(a);
  check('can bitince oyuncu yere serildi (ölmedi)', a.downed && !a.dead, `downed=${a.downed} dead=${a.dead}`);
  check('yoldaş ayakta kaldı', !b.downed && !b.dead);
  check('tur devam ediyor', eng.state === 'playing', eng.state);

  /* Yoldaş uzakta → kaldırma ilerlemiyor */
  place(b, a.x + 400, a.y);
  b.downed = false;
  run(eng, 60);
  check('uzaktan kaldırma olmuyor', a.reviveProgress < 0.05, a.reviveProgress);

  /* Yoldaş yanına gelsin */
  b.x = a.x + 20; b.y = a.y;
  run(eng, Math.ceil(1.3 * 60), () => { b.x = a.x + 20; b.y = a.y; });
  check('yakındaki yoldaş kaldırdı', !a.downed, `revive=${a.reviveProgress}`);
  check('kaldırılan oyuncu dokunulmaz başlıyor', a.invuln > 0, a.invuln);
  eng.stop();
}

/* --------------------------------------------------------------------------
   6. İkisi de yerdeyse tur biter
   -------------------------------------------------------------------------- */
{
  const eng = makeEngine('local', 0);
  const [a, b] = eng.players;
  eng.lives = 1;
  eng._takeDamage(a);
  eng.lives = 1;
  eng._takeDamage(b);
  check('ikisi de yerdeyse tur bitiyor', eng.state === 'dying', eng.state);
  eng.stop();
}

/* --------------------------------------------------------------------------
   7. Bölüm sonu: ikisi de geçitte olmalı
   -------------------------------------------------------------------------- */
{
  const eng = makeEngine('local', 0);
  const portal = eng.entities.portal;
  const [a, b] = eng.players;

  place(a, portal.x, portal.y - 44);
  place(b, 300, 400);
  run(eng, 30);
  check('tek kişi geçitte → bölüm BİTMİYOR', eng.state === 'playing', eng.state);
  check('bekleme göstergesi doğru', eng.portalWaiting && eng.portalWaiting.at === 1, JSON.stringify(eng.portalWaiting));

  place(b, portal.x + 8, portal.y - 44);
  run(eng, 30);
  check('ikisi de geçitte → bölüm bitiyor', eng.state === 'levelDone', eng.state);
  eng.stop();
}

/* --------------------------------------------------------------------------
   8. Tek oyunculu mod bozulmadı mı
   -------------------------------------------------------------------------- */
{
  const eng = makeEngine('solo', 0);
  check('solo modda tek oyuncu', eng.players.length === 1, eng.players.length);
  check('solo modda co-op kapıları yüklenmiyor',
    eng.entities.gates.length === 0 && eng.entities.plates.length === 0,
    `${eng.entities.gates.length}/${eng.entities.plates.length}`);

  run(eng, 120, () => { eng.inputs[0].right = true; });
  check('solo oyuncu sağa yürüyor', eng.players[0].x > eng.level.def.startX, eng.players[0].x);
  check('solo oyun çalışır durumda', eng.state === 'playing', eng.state);

  /* Solo ölüm eski davranışta kalmalı: yere serilme YOK */
  eng.lives = 1;
  eng._takeDamage(eng.players[0]);
  check('solo modda yere serilme yok, doğrudan ölüm',
    !eng.players[0].downed && eng.state === 'dying',
    `downed=${eng.players[0].downed} state=${eng.state}`);
  eng.stop();
}

/* --------------------------------------------------------------------------
   9. Bölüm verisi tutarlılığı
   -------------------------------------------------------------------------- */
{
  const { GROUND_Y } = await import('../src/game/levels.js');
  const PLAYER_W = 26, PLAYER_H = 44;
  const bad = [];

  /* Bir nesnenin altında gerçekten basılacak bir yüzey var mı? */
  const surfaces = (def) => [
    ...def.ground.map(g => ({ x: g.x, w: g.w, y: GROUND_Y })),
    ...(def.platforms || []).map(p => ({ x: p.x, w: p.w, y: p.y }))
  ];

  const onSurface = (def, x, w, y) =>
    surfaces(def).some(s => Math.abs(s.y - (y + 12)) < 3 && x >= s.x - 2 && x + w <= s.x + s.w + 2);

  const nearSpike = (def, x, w) =>
    (def.spikes || []).some(s => x + w + 55 > s.x && x - 55 < s.x + s.w);

  /* Belirtilen dikey sütun boş mu? (kapı yüksekliği / asansör yolu) */
  const columnClear = (def, x, w, fromY, toY) => {
    const boxes = [
      ...(def.platforms || []),
      ...(def.oneWay || []),
      ...(def.crumble || []),
      ...(def.moving || []).map(m => ({
        x: m.x - (m.rangeX || 0), y: m.y - (m.rangeY || 0),
        w: (m.w || 110) + 2 * (m.rangeX || 0)
      }))
    ];
    return !boxes.some(b =>
      x + w > b.x - 6 && x < b.x + (b.w || 90) + 6 &&
      b.y > Math.min(fromY, toY) - 24 && b.y < Math.max(fromY, toY));
  };

  for (const def of LEVELS) {
    const plates = def.plates || [];
    const plateById = new Map(plates.map(p => [p.id, p]));

    for (const p of plates) {
      if (!onSurface(def, p.x, p.w || 76, p.y)) bad.push(`${def.name}/${p.id}: plaka havada duruyor`);
      if (nearSpike(def, p.x, p.w || 76)) bad.push(`${def.name}/${p.id}: plaka dikenin dibinde`);
      if (!columnClear(def, p.x, p.w || 76, p.y - PLAYER_H - 20, p.y - 4)) {
        bad.push(`${def.name}/${p.id}: plakanın üstünde platform var, oyuncu basamaz`);
      }
    }

    for (const g of def.gates || []) {
      for (const need of (Array.isArray(g.needs) ? g.needs : [g.needs])) {
        if (!plateById.has(need)) bad.push(`${def.name}: kapı olmayan plakayı bekliyor "${need}"`);
      }
      if (!onSurface(def, g.x, g.w || 22, g.y + (g.h || 120) - 12)) {
        bad.push(`${def.name}: kapı zemine oturmuyor (x=${g.x})`);
      }
      if (nearSpike(def, g.x, g.w || 22)) bad.push(`${def.name}: kapı dikenin dibinde (x=${g.x})`);

      /* Tek kişi iki plakaya birden basabiliyor mu? Karakter 26px geniş. */
      const needs = (Array.isArray(g.needs) ? g.needs : [g.needs]).map(n => plateById.get(n)).filter(Boolean);
      if (needs.length === 2) {
        const [a, b] = needs;
        const sameLevel = Math.abs(a.y - b.y) < PLAYER_H;
        const gap = Math.abs(a.x - b.x) - Math.max(a.w || 76, b.w || 76);
        if (sameLevel && gap < PLAYER_W) {
          bad.push(`${def.name}: iki plaka tek oyuncuyla kapsanabilir (boşluk ${gap}px)`);
        }
      }
    }

    for (const l of def.coopLifts || []) {
      const w = l.w || 120, rise = l.rise || 150;
      if (!onSurface(def, l.x, w, l.y + 6)) bad.push(`${def.name}: asansör zemine oturmuyor (x=${l.x})`);
      if (!columnClear(def, l.x, w, l.y - rise - PLAYER_H, l.y - 6)) {
        bad.push(`${def.name}: asansör yolunda platform var (x=${l.x}) — oyuncu ezilir`);
      }
    }
  }

  check('co-op yerleşimi geçerli', bad.length === 0, bad.join(' | '));

  const withCoop = LEVELS.filter(l => (l.gates || []).length > 0).length;
  check('her bölümde co-op kapısı var', withCoop === LEVELS.length, `${withCoop}/${LEVELS.length}`);
}

/* --------------------------------------------------------------------------
   10. Girdi paketleme (ağ katmanı)
   -------------------------------------------------------------------------- */
{
  const { packInput, unpackInput } = await import('../server/protocol.js');
  const original = {
    left: true, right: false, down: true,
    jumpHeld: true, attackHeld: false, shootHeld: true, blockHeld: false,
    jumpEdge: true, attackEdge: false, shootEdge: false
  };
  const bits = packInput(original);
  const back = unpackInput(bits);
  const same = Object.keys(original).every(k => original[k] === back[k]);
  check('girdi paketleme kayıpsız', same, `${bits} → ${JSON.stringify(back)}`);
  check('girdi tek sayıya sığıyor', bits < 1024, bits);
}

/* --------------------------------------------------------------------------
   11. Akış: teklif cevabı iki tarafı da aynı finale götürüyor mu

   Faz 4'ün en kırılgan yeri burası. Seçimi MİSAFİR yapıyor ama host'un
   sahnesi de aynı anda devam etmeli, aksi halde host sonsuza dek seçim
   ekranında donar. Host'un yönetmeni dışarıdan submitChoice ile
   sürülebiliyor mu, onu doğruluyoruz.
   -------------------------------------------------------------------------- */
{
  const { Director } = await import('../src/cinematic/director.js');
  const { SCENES, sceneAfterChoice } = await import('../src/cinematic/scenes/index.js');
  const config = { heroName: 'Mehmet', targetName: 'Ayşe', proposalText: 'Soru?' };
  const dt = 1 / 60;

  check('kabul → gün batımı sahnesi', sceneAfterChoice('yes') === 'outro-yes', sceneAfterChoice('yes'));
  check('ret → ejderha sahnesi', sceneAfterChoice('no') === 'outro-no', sceneAfterChoice('no'));

  /* Misafir tarafı: seçim yapabilir ve cevabı dışarı bildirir */
  let sent = null;
  const guestD = new Director(SCENES['outro-ask'], { config, onChoice: (id) => { sent = id; } });
  let guard = 0;
  while (!guestD.awaitingChoice && guard++ < 5000) guestD.update(dt);
  guestD.submitChoice('yes');
  check('misafir seçimi dışarı bildiriliyor', sent === 'yes', sent);

  /* Host tarafı: kendi seçim yapmaz, ağdan gelen cevapla sürülür */
  let hostEnded = null;
  const hostD = new Director(SCENES['outro-ask'], { config, onEnd: (i) => { hostEnded = i; } });
  guard = 0;
  while (!hostD.awaitingChoice && guard++ < 5000) hostD.update(dt);
  check('host da seçim anında bekliyor', hostD.awaitingChoice);

  hostD.submitChoice(sent);          // ağdan gelen cevap
  guard = 0;
  while (!hostEnded && guard++ < 5000) hostD.update(dt);
  check('host ağdan gelen cevapla devam ediyor', !!hostEnded, 'sahne bitmedi');
  check('iki taraf aynı finale gidiyor',
    hostEnded && sceneAfterChoice(hostEnded.choice) === sceneAfterChoice(sent),
    `${hostEnded?.choice} vs ${sent}`);

  /* Sahne saati senkronu — co-op'un sinematik ayağı */
  const a = new Director(SCENES['intro'], { config });
  const b = new Director(SCENES['intro'], { config });
  for (let i = 0; i < 300; i++) a.update(dt);
  b.syncTo(a.time);
  b.update(dt);
  check('uzak saat farkı büyükse ışınlanıyor', Math.abs(b.time - a.time) < 0.1,
    `a=${a.time.toFixed(2)} b=${b.time.toFixed(2)}`);

  const c = new Director(SCENES['intro'], { config });
  for (let i = 0; i < 300; i++) c.update(dt);
  c.syncTo(c.time + 0.35);           // tolerans üstü ama ışınlama altı
  check('küçük sapmada hız esnetiliyor (kesme yok)', c.speed > 1, c.speed);

  /* Sekme geri dönüşü: misafir seçim anının üstüne ışınlanınca kapıyı kaçırmamalı */
  const late = new Director(SCENES['outro-ask'], { config });
  const askT = SCENES['outro-ask'].choice.t;
  late.syncTo(askT + 3, 0.2, true);
  check('geç syncTo seçim ekranını açıyor', late.awaitingChoice);
  check('geç syncTo sahneyi bitirmiyor', !late.ended);
  check('geç syncTo zamanı soruda kilitliyor', late.time === askT, late.time);
}

/* --------------------------------------------------------------------------
   Rapor
   -------------------------------------------------------------------------- */

console.log('\n=== CO-OP MOTOR TESTİ ===');
console.table(results);

if (failures === 0) {
  console.log(`\n✔ ${results.length} kontrolün tamamı geçti.\n`);
} else {
  console.log(`\n✘ ${failures}/${results.length} kontrol başarısız.\n`);
  process.exitCode = 1;
}
