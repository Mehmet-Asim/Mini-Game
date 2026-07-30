/* ==========================================================================
   Depolama Adaptörü — bellek ya da Redis

   TASARIM KARARI: Redis ZORUNLU DEĞİL.

   Yerelde geliştirirken Redis kurdurmak gereksiz bir engel. Sunucu tek işlem
   olarak çalıştığı sürece bellek deposu birebir aynı işi görüyor.
   REDIS_URL tanımlıysa Redis'e, tanımlı değilse belleğe düşer — kod tarafında
   hiçbir fark yok.

   Redis ne zaman gerekli:
     · Sunucu birden fazla instance ile çalışacaksa (iki oyuncu farklı
       instance'a düşerse bellek deposu onları birbirinden habersiz bırakır)
     · Sunucu yeniden başlatıldığında devam eden odalar kaybolmasın isteniyorsa

   Arayüz (her iki uygulama da bunu sağlar):
     get(code)        → oda nesnesi | null
     set(code, room)  → kaydet + TTL tazele
     del(code)        → sil
     touch(code)      → sadece TTL tazele
     publish(code, m) → aynı odaya bağlı diğer instance'lara ilet
     subscribe(cb)    → başka instance'tan gelen mesajları al
     close()
   ========================================================================== */

import { NET } from './protocol.js';

/* --------------------------------------------------------------------------
   Bellek deposu — varsayılan
   -------------------------------------------------------------------------- */

class MemoryStore {
  constructor() {
    this.rooms = new Map();      // code → { room, expiresAt }
    this.kind = 'memory';
    this._sweeper = setInterval(() => this._sweep(), 60_000);
    if (this._sweeper.unref) this._sweeper.unref();
  }

  async get(code) {
    const rec = this.rooms.get(code);
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) { this.rooms.delete(code); return null; }
    return rec.room;
  }

  async set(code, room) {
    this.rooms.set(code, { room, expiresAt: Date.now() + NET.ROOM_TTL_MS });
  }

  async del(code) { this.rooms.delete(code); }

  async touch(code) {
    const rec = this.rooms.get(code);
    if (rec) rec.expiresAt = Date.now() + NET.ROOM_TTL_MS;
  }

  /* Tek instance'ta yayına gerek yok — herkes zaten aynı bellekte */
  async publish() {}
  async subscribe() {}

  async close() { clearInterval(this._sweeper); }

  _sweep() {
    const now = Date.now();
    for (const [code, rec] of this.rooms) {
      if (rec.expiresAt <= now) this.rooms.delete(code);
    }
  }

  async stats() { return { kind: 'memory', rooms: this.rooms.size }; }
}

/* --------------------------------------------------------------------------
   Redis deposu
   -------------------------------------------------------------------------- */

class RedisStore {
  constructor(client, sub, instanceId) {
    this.r = client;
    this.sub = sub;
    this.instanceId = instanceId;
    this.kind = 'redis';
    this._handler = null;
    this.CHANNEL = 'qol:relay';
  }

  key(code) { return `qol:room:${code}`; }

  async get(code) {
    const raw = await this.r.get(this.key(code));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async set(code, room) {
    await this.r.set(this.key(code), JSON.stringify(room), 'PX', NET.ROOM_TTL_MS);
  }

  async del(code) { await this.r.del(this.key(code)); }

  async touch(code) { await this.r.pexpire(this.key(code), NET.ROOM_TTL_MS); }

  /* Çok instance'lı dağıtımda mesaj aktarımı.
     Kendi yayınımızı geri almamak için instanceId ile işaretliyoruz. */
  async publish(code, msg) {
    await this.r.publish(this.CHANNEL, JSON.stringify({ from: this.instanceId, code, msg }));
  }

  async subscribe(cb) {
    this._handler = cb;
    await this.sub.subscribe(this.CHANNEL);
    this.sub.on('message', (_ch, raw) => {
      try {
        const p = JSON.parse(raw);
        if (p.from === this.instanceId) return;      // kendi yankımız
        this._handler?.(p.code, p.msg);
      } catch { /* bozuk mesajı yut */ }
    });
  }

  async close() {
    try { await this.sub.quit(); } catch { /* zaten kapalı */ }
    try { await this.r.quit(); } catch { /* zaten kapalı */ }
  }

  async stats() {
    const keys = await this.r.keys('qol:room:*');
    return { kind: 'redis', rooms: keys.length };
  }
}

/* --------------------------------------------------------------------------
   Fabrika
   -------------------------------------------------------------------------- */

export async function createStore({ redisUrl, instanceId, log = console } = {}) {
  if (!redisUrl) {
    log.info?.('[store] bellek deposu (REDIS_URL tanımlı değil)');
    return new MemoryStore();
  }

  let Redis;
  try {
    ({ default: Redis } = await import('ioredis'));
  } catch {
    log.warn?.('[store] ioredis kurulu değil → belleğe düşülüyor. Kurmak için: npm i ioredis');
    return new MemoryStore();
  }

  try {
    const client = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
    const sub = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
    await client.connect();
    await sub.connect();
    log.info?.('[store] Redis bağlandı');
    return new RedisStore(client, sub, instanceId);
  } catch (e) {
    /* Redis erişilemiyorsa oyunu tamamen çökertmek yerine belleğe düş.
       Tek instance'ta oyun sorunsuz çalışmaya devam eder. */
    log.warn?.(`[store] Redis bağlanamadı (${e.message}) → belleğe düşülüyor`);
    return new MemoryStore();
  }
}

export { MemoryStore, RedisStore };
