/* ==========================================================================
   İstemci Ağ Katmanı

   Tek sorumluluğu: sunucuyla konuşmak. Oyun mantığı, sinematik, çizim —
   hiçbiri buraya sızmaz. Dışarıya olay tabanlı bir arayüz veriyor.

       const net = new NetClient();
       net.on('lobby', s => ...);
       await net.connect();
       await net.createRoom(config);      // host
       await net.joinRoom('ABCDE', ad);   // misafir
       net.send(MSG.INPUT, { bits });

   Kendiliğinden hallettikleri:
     · Kopunca üstel geri çekilmeyle yeniden bağlanma
     · Yeniden bağlanınca token ile odaya geri girme (oyun kaldığı yerden)
     · Heartbeat + RTT ölçümü
     · Bağlantı yokken gönderilen mesajları sessizce düşürme
       (input/snapshot kuyruğa alınmamalı — bayat veri zararlıdır)
   ========================================================================== */

import { MSG, NET, PROTOCOL_VERSION, encode, decode } from '../../server/protocol.js';

export { MSG, NET, packInput, unpackInput, PHASE, ROLE } from '../../server/protocol.js';

const STORAGE_KEY = 'qol.session';

/** Sunucu adresini çöz: env → aynı origin → yerel geliştirme */
export function resolveWsUrl() {
  const fromEnv = import.meta.env?.VITE_WS_URL;
  if (fromEnv) return fromEnv;

  const { protocol, hostname, port } = window.location;
  const scheme = protocol === 'https:' ? 'wss:' : 'ws:';

  /* Vite geliştirmede (5173/5174/…) oyun sunucusu ayrı portta (8787).
     Üretimde ikisi aynı origin olduğu için port devralınır.
     Not: Vite 5173 doluysa 5174'e kayar — sabit port listesine güvenme. */
  const isViteDev = import.meta.env?.DEV === true
    || /^517\d$/.test(port)
    || port === '4173'
    || port === '3000';
  const targetPort = isViteDev ? '8787' : port;

  return `${scheme}//${hostname}${targetPort ? ':' + targetPort : ''}/ws`;
}

export class NetClient {
  constructor(opts = {}) {
    this.url = opts.url || null;
    this.ws = null;

    this.status = 'idle';      // idle | connecting | online | reconnecting | closed
    this.room = null;
    this.role = null;
    this.playerId = null;
    this.token = null;
    this.config = null;
    this.rtt = 0;

    this._handlers = new Map();
    this._pendingResume = null;
    this._attempt = 0;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._wantOpen = false;
    this._closedByUs = false;
  }

  /* ---------- Olaylar ---------- */

  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) { this._handlers.get(type)?.delete(fn); }

  _emit(type, payload) {
    for (const fn of (this._handlers.get(type) || [])) {
      try { fn(payload); } catch (e) { console.error(`[net] "${type}" işleyicisi hata verdi`, e); }
    }
    for (const fn of (this._handlers.get('*') || [])) {
      try { fn(type, payload); } catch { /* yoksay */ }
    }
  }

  _setStatus(s, detail) {
    if (this.status === s) return;
    this.status = s;
    this._emit('status', { status: s, ...detail });
  }

  /* ---------- Bağlantı ---------- */

  connect(url) {
    this.url = url || this.url || resolveWsUrl();
    this._wantOpen = true;
    this._closedByUs = false;

    return new Promise((resolve, reject) => {
      let settled = false;
      this._setStatus(this._attempt > 0 ? 'reconnecting' : 'connecting');

      let ws;
      try { ws = new WebSocket(this.url); }
      catch (e) { reject(e); return; }
      this.ws = ws;

      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };
      const timer = setTimeout(() => {
        this._wantOpen = false;
        try { ws.close(); } catch { /* yoksay */ }
        finish(reject, new Error('bağlantı zaman aşımı'));
      }, 8000);

      ws.onopen = () => {
        this._attempt = 0;
        this._setStatus('online');
        this._startPing();
        /* Kopmadan önce bir odadaysak sessizce geri gir */
        const s = loadSession();
        if (s && s.room && s.token && !this.room) {
          this._pendingResume = s.room;
          this._sendRaw(encode(MSG.RESUME, { room: s.room, token: s.token }));
        } else if (this.room && this.token) {
          this._pendingResume = this.room;
          this._sendRaw(encode(MSG.RESUME, { room: this.room, token: this.token }));
        }
        finish(resolve, this);
      };

      ws.onmessage = (ev) => this._onMessage(ev.data);

      ws.onclose = () => {
        this._stopPing();
        if (this._closedByUs || !this._wantOpen) { this._setStatus('closed'); return; }
        this._setStatus('reconnecting');
        this._scheduleReconnect();
        finish(reject, new Error('bağlantı kapandı'));
      };

      ws.onerror = () => {
        /* onclose zaten arkasından gelir; burada sadece log */
      };
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    /* Üstel geri çekilme, 15 sn tavan, %20 rastgele sapma
       (iki istemci aynı anda dönüp sunucuyu dövmesin) */
    const base = Math.min(15000, 400 * Math.pow(1.7, this._attempt));
    const delay = base * (0.8 + Math.random() * 0.4);
    this._attempt++;
    this._emit('reconnect-scheduled', { attempt: this._attempt, delay });
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }

  close() {
    this._wantOpen = false;
    this._closedByUs = true;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    this._stopPing();
    try { this._sendRaw(encode(MSG.BYE, {})); } catch { /* yoksay */ }
    try { this.ws?.close(); } catch { /* yoksay */ }
    this.ws = null;
    this._setStatus('closed');
  }

  /* ---------- Oda işlemleri ---------- */

  createRoom(config) {
    return this._request(MSG.CREATE, { config, v: PROTOCOL_VERSION }, MSG.CREATED);
  }

  joinRoom(code, name) {
    return this._request(MSG.JOIN, { room: String(code || '').toUpperCase(), name, v: PROTOCOL_VERSION }, MSG.JOINED);
  }

  /** Bağlantı açılırken token'la RESUME gönderildiyse sonucunu bekle.
      Sayfa yenilenen misafir önce koltuğunu geri almalı; hemen JOIN
      gönderilirse kendi koltuğuna "oda dolu" diye toslar. */
  waitResume(timeoutMs = 4000) {
    if (!this._pendingResume) return Promise.resolve(this.room ? { room: this.room } : null);
    return new Promise((resolve) => {
      const offOk = this.on(MSG.RESUMED, (m) => { cleanup(); resolve(m); });
      const offErr = this.on(MSG.ERROR, () => { cleanup(); resolve(null); });
      const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); offOk(); offErr(); };
    });
  }

  setReady(ready) { this.send(MSG.READY, { ready }); }
  startGame()     { this.send(MSG.START, {}); }

  /** Cevabı beklenen istek — ya sonuç ya hata döner */
  _request(type, payload, expect, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const offOk = this.on(expect, (m) => { cleanup(); resolve(m); });
      const offErr = this.on(MSG.ERROR, (m) => {
        if (m._forResume) return; /* açılıştaki RESUME'un hatası, bizim değil */
        cleanup(); reject(Object.assign(new Error(m.message || m.code), { code: m.code }));
      });
      const timer = setTimeout(() => { cleanup(); reject(new Error('Sunucu yanıt vermedi')); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); offOk(); offErr(); };
      if (!this.send(type, payload)) { cleanup(); reject(new Error('Bağlantı yok')); }
    });
  }

  /* ---------- Gönderim ---------- */

  send(type, payload = {}) {
    return this._sendRaw(encode(type, payload));
  }

  _sendRaw(raw) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try { this.ws.send(raw); return true; }
    catch { return false; }
  }

  /* ---------- Alım ---------- */

  _onMessage(raw) {
    const m = decode(raw);
    if (!m) return;

    switch (m.t) {
      case MSG.CREATED:
      case MSG.JOINED:
      case MSG.RESUMED:
        this._pendingResume = null;
        this.room = m.room;
        this.role = m.role;
        this.playerId = m.playerId;
        if (m.token) this.token = m.token;
        if (m.config) this.config = m.config;
        saveSession({ room: this.room, token: this.token, role: this.role });
        break;

      case MSG.PONG:
        this.rtt = Date.now() - m.ts;
        break;

      case MSG.ERROR:
        /* Bağlantı açılışında gönderilen RESUME'un hatası, o sırada cevap
           bekleyen CREATE/JOIN isteğine bulaşmasın: bayat oturum yüzünden
           "sunucuya ulaşılamadı" görünüyordu. */
        if (this._pendingResume &&
            (m.code === 'ROOM_NOT_FOUND' || m.code === 'BAD_TOKEN' || m.code === 'HOST_GONE')) {
          m._forResume = true;
        }
        this._pendingResume = null;
        /* Oda yoksa saklanan oturum bayat demektir — temizle ki
           sonsuz "geri girmeye çalış → hata" döngüsüne girmeyelim */
        if (m.code === 'ROOM_NOT_FOUND' || m.code === 'BAD_TOKEN' || m.code === 'HOST_GONE') {
          clearSession();
          this.room = null; this.token = null;
        }
        break;
    }

    this._emit(m.t, m);
  }

  /* ---------- Canlılık ---------- */

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      this.send(MSG.PING, { ts: Date.now() });
    }, NET.HEARTBEAT_MS);
  }

  _stopPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  get isHost()  { return this.role === 'host'; }
  get isGuest() { return this.role === 'guest'; }
  get online()  { return this.status === 'online'; }
}

/* ---------- Oturum saklama ----------
   sessionStorage kullanıyoruz: sekme kapanınca gitsin. localStorage olsaydı
   haftalar sonra açılan sekme ölü bir odaya girmeye çalışırdı. */

function saveSession(s) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* gizli sekme */ }
}

export function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}

export function clearSession() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* yoksay */ }
}
