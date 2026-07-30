/* ==========================================================================
   Sunucu Uçtan Uca Testi

       npm i ws
       npm run test:server

   Gerçek bir sunucu başlatır, gerçek WebSocket istemcileri bağlar ve oda
   akışının tamamını sırayla doğrular. Tarayıcı açmadan Faz 2'nin çalıştığını
   garanti eden şey bu.

   Kapsam:
     · oda oluşturma / katılma / bekleme salonu yayını
     · host ↔ misafir mesaj aktarımı (ve gönderene geri dönmemesi)
     · hazır durumu, oyunu başlatma, host olmayanın başlatamaması
     · dolu odaya katılma, olmayan odaya katılma
     · bağlantı kopması → token ile geri girme (oda ve evre korunuyor mu)
     · ping/pong
   ========================================================================== */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let WebSocket;
try {
  ({ default: WebSocket } = await import('ws'));
} catch {
  console.error('\n"ws" kurulu değil:\n\n    npm i ws\n');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8899;
const URL = `ws://127.0.0.1:${PORT}/ws`;

const results = [];
let failures = 0;

function check(name, cond, detail = '') {
  results.push({ test: name, sonuç: cond ? '✔' : '✘', not: cond ? '' : detail });
  if (!cond) failures++;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* --------------------------------------------------------------------------
   Test istemcisi
   -------------------------------------------------------------------------- */

class TestClient {
  constructor(label) {
    this.label = label;
    this.inbox = [];
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        try { this.inbox.push(JSON.parse(raw.toString())); } catch { /* yoksay */ }
      });
    });
  }

  send(t, payload = {}) { this.ws.send(JSON.stringify({ t, ...payload })); }

  /** Belirli tipte mesaj gelene kadar bekle */
  async wait(type, ms = 3000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const i = this.inbox.findIndex(m => m.t === type);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await sleep(15);
    }
    return null;
  }

  /** Bu tipte mesaj GELMEDİĞİNİ doğrula */
  async expectSilence(type, ms = 400) {
    await sleep(ms);
    return !this.inbox.some(m => m.t === type);
  }

  clear() { this.inbox.length = 0; }
  kill()  { try { this.ws.terminate(); } catch { /* yoksay */ } }
  close() { try { this.ws.close(); } catch { /* yoksay */ } }
}

/* --------------------------------------------------------------------------
   Sunucuyu başlat
   -------------------------------------------------------------------------- */

console.log('[test] sunucu başlatılıyor...');
const server = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), REDIS_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

/* Dinlemeye başlamasını bekle */
{
  const deadline = Date.now() + 8000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) { up = true; break; }
    } catch { /* henüz ayakta değil */ }
    await sleep(120);
  }
  if (!up) {
    console.error('[test] sunucu ayağa kalkmadı.\n' + serverLog);
    server.kill();
    process.exit(1);
  }
}

try {
  /* ---------- 1. Sağlık ---------- */
  {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`).then(r => r.json());
    check('sağlık uç noktası', r.ok === true && r.protocol === 1, JSON.stringify(r));
    check('depo bellek moduna düştü', r.store?.kind === 'memory', JSON.stringify(r.store));
  }

  /* ---------- 2. Oda oluşturma ---------- */
  const host = new TestClient('host');
  await host.connect();
  host.send('create', { config: { heroName: 'Mehmet', targetName: 'Yolcu', proposalText: 'Soru?' }, v: 1 });
  const created = await host.wait('created');
  check('host oda oluşturdu', !!created?.room, JSON.stringify(created));
  check('host rolü doğru', created?.role === 'host');
  check('token verildi', typeof created?.token === 'string' && created.token.length > 8);
  const code = created.room;

  /* ---------- 3. Olmayan odaya katılma ---------- */
  {
    const stray = new TestClient('stray');
    await stray.connect();
    stray.send('join', { room: 'ZZZZZ', name: 'Hayalet', v: 1 });
    const err = await stray.wait('error');
    check('olmayan odaya katılma reddedildi', err?.code === 'ROOM_NOT_FOUND', JSON.stringify(err));
    stray.close();
  }

  /* ---------- 4. Misafir katılıyor ---------- */
  host.clear();
  let guest = new TestClient('guest');
  await guest.connect();
  guest.send('join', { room: code, name: 'Ayşe', v: 1 });
  const joined = await guest.wait('joined');
  check('misafir katıldı', joined?.room === code && joined?.role === 'guest', JSON.stringify(joined));
  check('config misafire iletildi', joined?.config?.heroName === 'Mehmet');

  const peerMsg = await host.wait('peer');
  check('host katılımdan haberdar edildi', peerMsg?.event === 'joined', JSON.stringify(peerMsg));

  const lobby = await host.wait('lobby');
  check('bekleme salonu iki koltuğu da gösteriyor',
    !!lobby?.lobby?.host && !!lobby?.lobby?.guest, JSON.stringify(lobby?.lobby));
  check('token bekleme salonu verisinde SIZMIYOR',
    !JSON.stringify(lobby.lobby).includes(created.token), 'token sızdı!');

  /* ---------- 5. Dolu oda ---------- */
  {
    const third = new TestClient('third');
    await third.connect();
    third.send('join', { room: code, name: 'Fazlalık', v: 1 });
    const err = await third.wait('error');
    check('üçüncü kişi reddedildi', err?.code === 'ROOM_FULL', JSON.stringify(err));
    third.close();
  }

  /* ---------- 6. Hazır durumu ---------- */
  host.clear();
  guest.send('ready', { ready: true });
  const readyLobby = await host.wait('lobby');
  check('hazır durumu karşı tarafa yansıdı',
    readyLobby?.lobby?.guest?.ready === true, JSON.stringify(readyLobby?.lobby?.guest));

  /* ---------- 7. Aktarım: misafir → host ---------- */
  host.clear(); guest.clear();
  guest.send('input', { seq: 7, bits: 42 });
  const relayed = await host.wait('input');
  check('input host\'a ulaştı', relayed?.bits === 42 && relayed?.seq === 7, JSON.stringify(relayed));
  check('aktarımda gönderen rolü işaretlendi', relayed?.from === 'guest', JSON.stringify(relayed));
  check('input göndericiye geri dönmedi', await guest.expectSilence('input'));

  /* ---------- 8. Aktarım: host → misafir ---------- */
  host.clear(); guest.clear();
  host.send('snap', { tick: 3, data: { x: 100 } });
  const snap = await guest.wait('snap');
  check('snapshot misafire ulaştı', snap?.tick === 3 && snap?.data?.x === 100, JSON.stringify(snap));

  /* ---------- 9. Sinematik senkron mesajı ---------- */
  host.clear(); guest.clear();
  host.send('scene', { id: 'intro', time: 4.5, phase: 'intro' });
  const scene = await guest.wait('scene');
  check('sahne saati misafire ulaştı', scene?.id === 'intro' && scene?.time === 4.5, JSON.stringify(scene));

  /* ---------- 10. Teklif cevabı ---------- */
  host.clear(); guest.clear();
  guest.send('choice', { id: 'yes' });
  const choice = await host.wait('choice');
  check('teklif cevabı host\'a ulaştı', choice?.id === 'yes', JSON.stringify(choice));

  /* ---------- 10b. Oda içi sohbet ---------- */
  host.clear(); guest.clear();
  guest.send('chat', { text: '  Selam\n  yolcu  ' });
  const chatAtHost = await host.wait('chat');
  const chatAtGuest = await guest.wait('chat');
  check('sohbet mesajı iki tarafa ulaştı',
    chatAtHost?.text === 'Selam yolcu' && chatAtGuest?.text === 'Selam yolcu');
  check('sohbet gönderen rolü sunucuda doğrulandı',
    chatAtHost?.from === 'guest' && chatAtGuest?.from === 'guest');
  check('sohbet mesajına sunucu zamanı eklendi',
    Number.isFinite(chatAtHost?.ts) && chatAtHost.ts > 0);

  /* ---------- 11. Misafir oyunu başlatamaz ---------- */
  guest.clear();
  guest.send('start', {});
  const notHost = await guest.wait('error');
  check('misafir oyunu başlatamıyor', notHost?.code === 'NOT_HOST', JSON.stringify(notHost));

  /* ---------- 12. Host başlatıyor ---------- */
  host.clear(); guest.clear();
  host.send('start', {});
  const startedH = await host.wait('lobby');
  const startedG = await guest.wait('lobby');
  check('başlangıç host\'a bildirildi', startedH?.started === true, JSON.stringify(startedH));
  check('başlangıç misafire bildirildi', startedG?.started === true, JSON.stringify(startedG));
  check('oda evresi intro oldu', startedH?.lobby?.phase === 'intro', startedH?.lobby?.phase);

  /* Host SCENE ile evreyi ilerletir (oyun / outro) — reconnect doğru yere dönsün */
  host.clear(); guest.clear();
  host.send('scene', { id: '', time: 0, phase: 'game', levelIndex: 1 });
  await Promise.race([
    host.wait('scene', 1500).catch(() => null),
    guest.wait('scene', 1500).catch(() => null)
  ]);
  guest.kill();
  const droppedForPhase = await host.wait('peer', 4000);
  check('evre testi için kopma bildirildi', droppedForPhase?.event === 'dropped', JSON.stringify(droppedForPhase));
  const guestPhase = new TestClient('guest-phase');
  await guestPhase.connect();
  guestPhase.send('resume', { room: code, token: joined.token });
  const resumedGame = await guestPhase.wait('resumed');
  check('SCENE sonrası oda evresi game oldu', resumedGame?.phase === 'game', resumedGame?.phase);
  check('SCENE levelIndex odaya yazıldı', resumedGame?.levelIndex === 1, resumedGame?.levelIndex);
  /* Testin geri kalanı için misafiri yeniden oturt */
  guest = guestPhase;
  await host.wait('peer', 3000);

  /* ---------- 13. Ping / RTT ---------- */
  host.clear();
  const t0 = Date.now();
  host.send('ping', { ts: t0 });
  const pong = await host.wait('pong');
  check('ping yanıtlandı', pong?.ts === t0, JSON.stringify(pong));

  /* ---------- 14. Kopma → token ile geri dönme ---------- */
  host.clear();
  guest.kill();                       // sert kopma: close mesajı yok
  const dropped = await host.wait('peer', 4000);
  check('kopma host\'a bildirildi', dropped?.event === 'dropped', JSON.stringify(dropped));

  const guest2 = new TestClient('guest-again');
  await guest2.connect();
  guest2.send('resume', { room: code, token: joined.token });
  const resumed = await guest2.wait('resumed');
  check('misafir token ile geri döndü', resumed?.room === code && resumed?.role === 'guest', JSON.stringify(resumed));
  check('geri dönüşte evre korundu', resumed?.phase === 'game', resumed?.phase);

  const rejoin = await host.wait('peer', 3000);
  check('geri dönüş host\'a bildirildi', rejoin?.event === 'rejoined', JSON.stringify(rejoin));

  /* ---------- 14b. Sayfa yenileme yarışı: RESUME + JOIN art arda ----------
     Tarayıcı yenilenince istemci bağlantı açılır açılmaz RESUME, hemen
     ardından JOIN gönderir. Sunucu bunları SIRAYLA işlemeli ve koltuğu
     zaten geri almış bağlantının JOIN'i "oda dolu" diye reddedilmemeli. */
  {
    host.clear();
    guest2.kill();
    await host.wait('peer', 4000);
    const reloader = new TestClient('guest-reload');
    await reloader.connect();
    reloader.send('resume', { room: code, token: joined.token });
    reloader.send('join', { room: code, name: 'Ayşe', v: 1 });
    const resumedR = await reloader.wait('resumed');
    const joinedR = await reloader.wait('joined');
    const errR = reloader.inbox.find(m => m.t === 'error');
    check('yenileme yarışında koltuk token ile geri alındı', resumedR?.room === code, JSON.stringify(resumedR));
    check('yenileme yarışında JOIN dolu odaya toslamadı',
      joinedR?.room === code && joinedR?.role === 'guest' && !errR,
      JSON.stringify(errR || joinedR));
    reloader.close();
    await host.wait('peer', 3000);
  }

  /* ---------- 15. Geçersiz token ---------- */
  {
    const faker = new TestClient('faker');
    await faker.connect();
    faker.send('resume', { room: code, token: 'sahte-token' });
    const err = await faker.wait('error');
    check('geçersiz token reddedildi', err?.code === 'BAD_TOKEN', JSON.stringify(err));
    faker.close();
  }

  /* ---------- 16. Bozuk mesaj sunucuyu düşürmüyor ---------- */
  {
    host.clear();
    host.ws.send('bu json değil');
    const err = await host.wait('error');
    check('bozuk mesaj yakalandı', err?.code === 'BAD_MESSAGE', JSON.stringify(err));
    host.clear();
    host.send('ping', { ts: 1 });
    check('sunucu bozuk mesajdan sonra ayakta', !!(await host.wait('pong')));
  }

  host.close();
  guest2.close();
  await sleep(200);

} catch (e) {
  check('test çalışması istisnasız tamamlandı', false, e.stack || e.message);
}

/* --------------------------------------------------------------------------
   Rapor
   -------------------------------------------------------------------------- */

server.kill('SIGTERM');
await sleep(300);
server.kill('SIGKILL');

console.log('\n=== SUNUCU TESTİ ===');
console.table(results);

if (failures === 0) {
  console.log(`\n✔ ${results.length} kontrolün tamamı geçti.\n`);
} else {
  console.log(`\n✘ ${failures}/${results.length} kontrol başarısız.\n`);
  if (serverLog.trim()) console.log('--- sunucu çıktısı ---\n' + serverLog);
  process.exitCode = 1;
}
