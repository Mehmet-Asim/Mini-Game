/* ==========================================================================
   Quest of Legends — Oda Sunucusu

       npm i ws            (zorunlu)
       npm i ioredis       (opsiyonel, üretimde)
       npm run server

   Ortam değişkenleri:
       PORT        varsayılan 8787
       REDIS_URL   tanımlıysa Redis, değilse bellek
       SERVE_DIST  '1' ise dist/ klasörünü de servis eder (tek servis dağıtımı)

   Sunucu OYUNU SİMÜLE ETMEZ. Üç işi var:
     1. Oda eşleştirme ve yaşam döngüsü
     2. Varlık takibi (kim bağlı, kim düştü)
     3. Mesaj aktarımı (host ↔ misafir)

   Fizik host'un tarayıcısında döner. Bu yüzden sunucu son derece ince ve
   ölçeklenmesi kolay: oda başına neredeyse hiç CPU harcamıyor.
   ========================================================================== */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';

import {
  MSG, ERR, ERR_TEXT, PHASE, ROLE, NET,
  PROTOCOL_VERSION, encode, decode
} from './protocol.js';
import { createStore } from './store.js';
import { RoomManager, lobbyView } from './rooms.js';

const PORT = Number(process.env.PORT || 8787);
/* Windows'ta `SERVE_DIST=1 node ...` npm script'i çalışmaz (cmd.exe),
   bu yüzden bayrak olarak da kabul ediyoruz. */
const SERVE_DIST = process.env.SERVE_DIST === '1' || process.argv.includes('--serve-dist');
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const INSTANCE = randomUUID();

let WebSocketServer;
try {
  ({ WebSocketServer } = await import('ws'));
} catch {
  console.error('\n"ws" paketi kurulu değil. Kurmak için:\n\n    npm i ws\n');
  process.exit(1);
}

/* --------------------------------------------------------------------------
   Statik dosya servisi (opsiyonel)
   -------------------------------------------------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.jpg':  'image/jpeg',
  '.woff2': 'font/woff2'
};

async function serveStatic(req, res) {
  const dist = join(ROOT, 'dist');
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';

  /* Dizin dışına çıkma denemelerini engelle */
  const target = normalize(join(dist, path));
  if (!target.startsWith(dist)) { res.writeHead(403).end('Forbidden'); return; }

  try {
    const s = await stat(target);
    if (!s.isFile()) throw new Error('not a file');
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target)] || 'application/octet-stream',
      'cache-control': path === '/index.html' ? 'no-cache' : 'public, max-age=31536000'
    });
    res.end(body);
  } catch {
    /* SPA: bilinmeyen yolları index.html'e düşür (hash yönlendirme için) */
    try {
      const body = await readFile(join(dist, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
}

/* --------------------------------------------------------------------------
   Kurulum
   -------------------------------------------------------------------------- */

const store = await createStore({ redisUrl: process.env.REDIS_URL, instanceId: INSTANCE });
const rooms = new RoomManager(store);

/** code → Set<connection> — bu instance'a bağlı canlı soketler */
const local = new Map();

/* Başka bir instance'tan gelen aktarımlar */
await store.subscribe((code, msg) => {
  fanout(code, msg, null, /* fromRemote */ true);
});

const httpServer = createServer(async (req, res) => {
  if (req.url === '/health') {
    const s = await store.stats();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, instance: INSTANCE, protocol: PROTOCOL_VERSION, store: s }));
    return;
  }
  if (SERVE_DIST) return serveStatic(req, res);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Quest of Legends oda sunucusu çalışıyor. WebSocket: /ws');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: NET.MAX_MSG_BYTES });

/* --------------------------------------------------------------------------
   Bağlantı
   -------------------------------------------------------------------------- */

wss.on('connection', (ws) => {
  const conn = {
    ws,
    code: null,
    seatId: null,
    role: null,
    alive: true,
    /* Basit jeton kovası: saniyede ~120 mesaj. Input 30 Hz + snapshot 20 Hz +
       heartbeat, normalde 60'ı geçmez. Kötü niyet ya da döngü hatası bunu aşar. */
    tokens: 120,
    lastRefill: Date.now(),
    lastChatAt: 0
  };

  ws.on('pong', () => { conn.alive = true; });

  ws.on('message', (raw) => {
    if (!rateOk(conn)) return fail(conn, ERR.RATE_LIMITED);
    const m = decode(raw);
    if (!m) return fail(conn, ERR.BAD_MESSAGE);
    /* Aynı bağlantının mesajları SIRAYLA işlenir. handle() async olduğu
       için RESUME tamamlanmadan JOIN araya girebiliyor ve "oda dolu"
       yarışı doğuyordu (sayfa yenilemede misafir odaya giremiyordu). */
    conn.mq = (conn.mq || Promise.resolve()).then(async () => {
      try {
        await handle(conn, m);
      } catch (e) {
        console.error('[ws] işleme hatası:', e);
        fail(conn, ERR.BAD_MESSAGE, e.message);
      }
    });
  });

  ws.on('close', () => onClose(conn));
  ws.on('error', () => onClose(conn));
});

/* Ölü bağlantıları temizle */
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws._qolDead) { ws.terminate(); continue; }
    ws._qolDead = true;
    try { ws.ping(); } catch { /* zaten kapanmış */ }
  }
}, NET.HEARTBEAT_MS * 2);
wss.on('connection', (ws) => { ws._qolDead = false; ws.on('pong', () => { ws._qolDead = false; }); });

/* --------------------------------------------------------------------------
   Mesaj işleme
   -------------------------------------------------------------------------- */

async function handle(conn, m) {
  switch (m.t) {

    case MSG.CREATE: {
      if (m.v && m.v !== PROTOCOL_VERSION) return fail(conn, ERR.VERSION);
      const { room, seat, error } = await rooms.create(m.config || {});
      if (error) return fail(conn, error);
      attach(conn, room.code, seat);
      send(conn, MSG.CREATED, {
        room: room.code, role: ROLE.HOST, playerId: seat.id, token: seat.token,
        config: room.config, v: PROTOCOL_VERSION
      });
      broadcastLobby(room.code);
      break;
    }

    case MSG.JOIN: {
      if (m.v && m.v !== PROTOCOL_VERSION) return fail(conn, ERR.VERSION);
      const joinCode = String(m.room || '').toUpperCase();

      /* Bu bağlantı RESUME ile aynı odaya zaten oturmuşsa (sayfa yenileme
         yarışı) JOIN'i ROOM_FULL diye reddetme — mevcut koltuğu onayla. */
      if (conn.code === joinCode && conn.seatId) {
        const existing = await rooms.get(joinCode);
        const seatHere = existing &&
          (existing.host?.id === conn.seatId ? existing.host
            : existing.guest?.id === conn.seatId ? existing.guest : null);
        if (seatHere) {
          send(conn, MSG.JOINED, {
            room: existing.code, role: seatHere.role, playerId: seatHere.id,
            token: seatHere.token, config: existing.config,
            phase: existing.phase, v: PROTOCOL_VERSION
          });
          break;
        }
      }

      const { room, seat, error } = await rooms.join(joinCode, m.name);
      if (error) return fail(conn, error);
      attach(conn, room.code, seat);
      send(conn, MSG.JOINED, {
        room: room.code, role: ROLE.GUEST, playerId: seat.id, token: seat.token,
        config: room.config, phase: room.phase, v: PROTOCOL_VERSION
      });
      relay(room.code, encode(MSG.PEER, { event: 'joined', name: seat.name, role: ROLE.GUEST }), conn.seatId);
      broadcastLobby(room.code);
      break;
    }

    case MSG.RESUME: {
      const { room, seat, error } = await rooms.resume(String(m.room || '').toUpperCase(), m.token);
      if (error) return fail(conn, error);
      attach(conn, room.code, seat);
      send(conn, MSG.RESUMED, {
        room: room.code, role: seat.role, playerId: seat.id,
        config: room.config, phase: room.phase, levelIndex: room.levelIndex
      });
      relay(room.code, encode(MSG.PEER, { event: 'rejoined', name: seat.name, role: seat.role }), conn.seatId);
      broadcastLobby(room.code);
      break;
    }

    case MSG.READY: {
      if (!conn.code) return;
      await rooms.setReady(conn.code, conn.seatId, m.ready);
      broadcastLobby(conn.code);
      break;
    }

    case MSG.START: {
      if (!conn.code) return;
      const { room, error } = await rooms.start(conn.code, conn.seatId);
      if (error) return fail(conn, error);
      /* Başlangıç herkese gider — host da kendi ekranını buna göre çevirir */
      fanout(conn.code, encode(MSG.LOBBY, { lobby: lobbyView(room), started: true }), null);
      break;
    }

    case MSG.CHAT: {
      if (!conn.code) return;
      const now = Date.now();
      if (now - conn.lastChatAt < NET.CHAT_COOLDOWN_MS) return;
      const text = cleanChat(m.text);
      if (!text) return;
      conn.lastChatAt = now;
      /* Sohbet gönderen dahil iki ekrana da sunucudan döner. Böylece sıra,
         zaman ve gönderen bilgisi iki tarafta aynı ve güvenilir kalır. */
      fanout(conn.code, encode(MSG.CHAT, {
        text,
        from: conn.role,
        ts: now
      }), null);
      break;
    }

    /* --- Saf aktarım: sunucu içeriğe bakmaz --- */
    case MSG.INPUT:
    case MSG.SNAP:
    case MSG.SCENE:
    case MSG.HALT:
    case MSG.CHOICE: {
      if (!conn.code) return;
      /* `t` alanını yayılımdan ÇIKARMAK şart: `{ ...m, t: undefined }` yazınca
         spread encode'un koyduğu tipi eziyor, mesaj tipsiz gidiyor ve karşı
         taraf onu çözemeden atıyordu. */
      const { t: _type, ...rest } = m;
      relay(conn.code, encode(m.t, { ...rest, from: conn.role }), conn.seatId);
      /* Evre bilgisini oda kaydında güncel tut — yeniden bağlanan doğru yere dönsün */
      if (m.t === MSG.SCENE && conn.role === ROLE.HOST && m.phase) {
        rooms.setPhase(conn.code, m.phase, { levelIndex: m.levelIndex });
      }
      break;
    }

    case MSG.PING: {
      send(conn, MSG.PONG, { ts: m.ts, now: Date.now() });
      if (conn.code) rooms.heartbeat(conn.code, conn.seatId);
      break;
    }

    case MSG.BYE: {
      onClose(conn, /* explicit */ true);
      break;
    }

    default:
      fail(conn, ERR.BAD_MESSAGE, `bilinmeyen tip: ${m.t}`);
  }
}

function cleanChat(value) {
  if (typeof value !== 'string') return '';
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...normalized].slice(0, NET.CHAT_MAX_CHARS).join('');
}

/* --------------------------------------------------------------------------
   Bağlantı defteri
   -------------------------------------------------------------------------- */

function attach(conn, code, seat) {
  detach(conn);
  conn.code = code;
  conn.seatId = seat.id;
  conn.role = seat.role;
  if (!local.has(code)) local.set(code, new Set());
  local.get(code).add(conn);
}

function detach(conn) {
  if (!conn.code) return;
  const set = local.get(conn.code);
  if (set) {
    set.delete(conn);
    if (set.size === 0) local.delete(conn.code);
  }
}

async function onClose(conn, explicit = false) {
  const { code, seatId, role } = conn;
  detach(conn);
  if (!code) return;

  const room = await rooms.markDropped(code, seatId);
  if (!room) return;

  relay(code, encode(MSG.PEER, { event: explicit ? 'left' : 'dropped', role }), seatId);
  broadcastLobby(code);

  /* Host kalıcı olarak giderse oda anlamsız — simülasyonu o yürütüyor.
     Ama hemen silmiyoruz: RECONNECT_MS içinde dönebilir. */
  if (role === ROLE.HOST) {
    setTimeout(async () => {
      const r = await rooms.get(code);
      if (r && r.host && !r.host.connected) {
        relay(code, encode(MSG.ERROR, { code: 'HOST_GONE', message: 'Oyunu kuran kişi ayrıldı.' }), null);
        await rooms.close(code);
      }
    }, NET.RECONNECT_MS).unref?.();
  }
}

/* --------------------------------------------------------------------------
   Gönderim
   -------------------------------------------------------------------------- */

function send(conn, type, payload) {
  if (conn.ws.readyState !== 1) return;
  conn.ws.send(encode(type, payload));
}

function sendRaw(conn, raw) {
  if (conn.ws.readyState !== 1) return;
  conn.ws.send(raw);
}

/** Odadaki HERKESE (gönderen hariç istenirse) */
function fanout(code, raw, exceptSeatId, fromRemote = false) {
  const set = local.get(code);
  if (set) {
    for (const c of set) {
      if (exceptSeatId && c.seatId === exceptSeatId) continue;
      sendRaw(c, raw);
    }
  }
  /* Diğer instance'lara da ilet (Redis pub/sub); uzaktan gelen mesajı
     tekrar yayınlamıyoruz, yoksa sonsuz döngü olur */
  if (!fromRemote) store.publish(code, raw).catch(() => {});
}

/** Gönderen hariç herkese — yani karşı tarafa */
function relay(code, raw, fromSeatId) {
  fanout(code, raw, fromSeatId);
}

async function broadcastLobby(code) {
  const room = await rooms.get(code);
  if (!room) return;
  fanout(code, encode(MSG.LOBBY, { lobby: lobbyView(room) }), null);
}

function fail(conn, code, message) {
  send(conn, MSG.ERROR, { code, message: message || ERR_TEXT[code] || code });
}

function rateOk(conn) {
  const now = Date.now();
  const dt = now - conn.lastRefill;
  if (dt > 0) {
    conn.tokens = Math.min(120, conn.tokens + (dt / 1000) * 120);
    conn.lastRefill = now;
  }
  if (conn.tokens < 1) return false;
  conn.tokens -= 1;
  return true;
}

/* --------------------------------------------------------------------------
   Başlat / kapat
   -------------------------------------------------------------------------- */

/* Bu makinenin dışarıdan erişilebilir adresleri.
   Sunucuda çalışırken "localhost" hiçbir işe yaramıyor; hangi adresi
   tarayıcıya yazacağını her seferinde aramak yerine burada yazdırıyoruz. */
function externalAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' && ni.family !== 4) continue;
      if (ni.internal) continue;
      out.push({ name, address: ni.address });
    }
  }
  return out;
}

httpServer.listen(PORT, () => {
  console.log(`[server] depo: ${store.kind}  ·  protokol v${PROTOCOL_VERSION}${SERVE_DIST ? '  ·  dist/ servis ediliyor' : ''}`);
  console.log(`[server] yerel:    http://localhost:${PORT}`);
  for (const { name, address } of externalAddresses()) {
    console.log(`[server] ${name}: http://${address}:${PORT}`);
  }
  if (SERVE_DIST) {
    console.log(`[server] kurulum: yukarıdaki adrese /#setup ekle`);
  } else {
    console.log('[server] NOT: istemci ayrı çalışıyor (npm run dev). Tek adresten');
    console.log('[server]      yayınlamak için: node server/index.js --serve-dist');
  }
});

async function shutdown() {
  console.log('\n[server] kapanıyor...');
  clearInterval(heartbeat);
  for (const ws of wss.clients) { try { ws.close(1001, 'server shutdown'); } catch { /* yoksay */ } }
  wss.close();
  httpServer.close();
  await store.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { httpServer, wss, rooms, store };
