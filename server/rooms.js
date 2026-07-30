/* ==========================================================================
   Oda Yaşam Döngüsü

   Bilerek WebSocket'ten habersiz yazıldı: burada hiç soket yok, sadece saf
   veri işlemleri. Böylece odaların tüm mantığı soket açmadan test edilebiliyor
   (bkz. tools/server-test.mjs).

   Bir odanın hayatı:
     create  → LOBBY  → (guest join) → LOBBY → start → INTRO → GAME → OUTRO → DONE
                  ↑                                        ↓
                  └──────────── kopma / yeniden bağlanma ──┘
   ========================================================================== */

import { PHASE, ROLE, ERR, makeRoomCode, isValidRoomCode, NET } from './protocol.js';

let _counter = 0;
const uid = (p) => `${p}${(++_counter).toString(36)}${Date.now().toString(36).slice(-4)}`;

function newSeat(name, role) {
  return {
    id: uid('p'),
    token: uid('t') + uid('k'),
    name: (name || '').slice(0, 24),
    role,
    connected: true,
    lastSeen: Date.now(),
    ready: false,
    droppedAt: null
  };
}

export class RoomManager {
  constructor(store, { log = console } = {}) {
    this.store = store;
    this.log = log;
  }

  /* ---------- Oluşturma ---------- */

  async create(config = {}) {
    /* Çakışma olasılığı 31^5 ≈ 28M'de bir ama yine de kontrol ediyoruz */
    let code = null;
    for (let i = 0; i < 8; i++) {
      const candidate = makeRoomCode(5);
      if (!(await this.store.get(candidate))) { code = candidate; break; }
    }
    if (!code) return { error: 'CODE_EXHAUSTED' };

    const room = {
      code,
      createdAt: Date.now(),
      phase: PHASE.LOBBY,
      config: sanitizeConfig(config),
      host: newSeat(config.heroName, ROLE.HOST),
      guest: null,
      levelIndex: 0,
      startedAt: null
    };

    await this.store.set(code, room);
    return { room, seat: room.host };
  }

  /* ---------- Katılma ---------- */

  async join(code, name) {
    if (!isValidRoomCode(code)) return { error: ERR.ROOM_NOT_FOUND };
    const room = await this.store.get(code);
    if (!room) return { error: ERR.ROOM_NOT_FOUND };

    /* Koltuk doluysa ama karşı taraf düşmüşse ve süre dolmuşsa devral.
       Aksi halde "bağlantım koptu, tekrar tıkladım" senaryosu ROOM_FULL
       hatasıyla duvara toslardı. */
    if (room.guest) {
      const stale = !room.guest.connected &&
        room.guest.droppedAt &&
        (Date.now() - room.guest.droppedAt) > NET.RECONNECT_MS;
      if (!stale) return { error: ERR.ROOM_FULL };
    }

    room.guest = newSeat(name || room.config.targetName, ROLE.GUEST);
    await this.store.set(code, room);
    return { room, seat: room.guest };
  }

  /* ---------- Kopan bağlantıyı geri alma ---------- */

  async resume(code, token) {
    const room = await this.store.get(code);
    if (!room) return { error: ERR.ROOM_NOT_FOUND };

    const seat =
      room.host?.token === token ? room.host :
      room.guest?.token === token ? room.guest : null;

    if (!seat) return { error: ERR.BAD_TOKEN };

    seat.connected = true;
    seat.lastSeen = Date.now();
    seat.droppedAt = null;
    await this.store.set(code, room);
    return { room, seat, resumed: true };
  }

  /* ---------- Durum değişiklikleri ---------- */

  async setReady(code, seatId, ready) {
    const room = await this.store.get(code);
    if (!room) return null;
    const seat = seatById(room, seatId);
    if (!seat) return null;
    seat.ready = !!ready;
    await this.store.set(code, room);
    return room;
  }

  async start(code, seatId) {
    const room = await this.store.get(code);
    if (!room) return { error: ERR.ROOM_NOT_FOUND };
    if (room.host?.id !== seatId) return { error: ERR.NOT_HOST };
    if (!room.guest) return { error: 'NO_GUEST' };

    room.phase = PHASE.INTRO;
    room.startedAt = Date.now();
    await this.store.set(code, room);
    return { room };
  }

  async setPhase(code, phase, extra = {}) {
    const room = await this.store.get(code);
    if (!room) return null;
    room.phase = phase;
    if (extra.levelIndex !== undefined) room.levelIndex = extra.levelIndex;
    await this.store.set(code, room);
    return room;
  }

  /* ---------- Varlık ---------- */

  async heartbeat(code, seatId) {
    const room = await this.store.get(code);
    if (!room) return null;
    const seat = seatById(room, seatId);
    if (!seat) return null;
    seat.lastSeen = Date.now();
    seat.connected = true;
    await this.store.touch(code);
    return room;
  }

  async markDropped(code, seatId) {
    const room = await this.store.get(code);
    if (!room) return null;
    const seat = seatById(room, seatId);
    if (!seat) return null;
    seat.connected = false;
    seat.droppedAt = Date.now();
    seat.ready = false;
    await this.store.set(code, room);
    return room;
  }

  /**
   * Odayı kapat.
   * Host çıkarsa oda biter — misafirin tek başına devam etmesinin anlamı yok,
   * çünkü simülasyonu host yürütüyor.
   */
  async close(code) {
    await this.store.del(code);
  }

  async get(code) { return this.store.get(code); }
}

/* ---------- Yardımcılar ---------- */

function seatById(room, id) {
  if (room.host?.id === id) return room.host;
  if (room.guest?.id === id) return room.guest;
  return null;
}

/** Config'i temizle — istemciden gelen her şey şüphelidir */
function sanitizeConfig(c = {}) {
  const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  return {
    heroName:     str(c.heroName, 24) || 'Kahraman',
    targetName:   str(c.targetName, 24) || 'Yolcu',
    proposalText: str(c.proposalText, 140) || 'Benimle çıkar mısın?',
    messages: Array.isArray(c.messages)
      ? c.messages.slice(0, 3).map(m => str(m, 200)).filter(Boolean)
      : []
  };
}

/** Bekleme salonunda gösterilecek güvenli özet — token'lar ASLA çıkmaz */
export function lobbyView(room) {
  if (!room) return null;
  return {
    code: room.code,
    phase: room.phase,
    levelIndex: room.levelIndex,
    config: room.config,
    host: room.host && {
      id: room.host.id, name: room.host.name,
      connected: room.host.connected, ready: room.host.ready
    },
    guest: room.guest && {
      id: room.guest.id, name: room.guest.name,
      connected: room.guest.connected, ready: room.guest.ready
    }
  };
}

export { sanitizeConfig };
