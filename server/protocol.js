/* ==========================================================================
   Ağ Protokolü — sunucu ve istemcinin PAYLAŞTIĞI tek kaynak

   Bu dosya hem Node tarafında hem tarayıcıda import edilir. Bu yüzden içinde
   Node'a veya DOM'a özgü hiçbir şey olamaz — sadece saf veri ve saf fonksiyon.

   Yetki modeli: HOST-AUTHORITATIVE.
   Sunucu oyunu simüle ETMEZ. Yaptığı iş oda eşleştirme, varlık takibi ve
   mesaj aktarımıdır. Fizik host'un tarayıcısında döner, misafir input yollar
   ve anlık görüntü alır. İki kişilik özel bir oyun için hile riski konu dışı,
   buna karşılık kazanılan basitlik çok büyük.
   ========================================================================== */

export const PROTOCOL_VERSION = 1;

/* ---------- Mesaj tipleri ---------- */

export const MSG = {
  /* İstemci → Sunucu */
  CREATE:  'create',    // { config }              host oda açar
  JOIN:    'join',      // { room, name }          misafir katılır
  RESUME:  'resume',    // { room, token }         kopan bağlantıyı geri al
  READY:   'ready',     // { ready }               bekleme salonu hazır durumu
  START:   'start',     // {}                      host oyunu başlatır
  INPUT:   'input',     // { seq, bits, t }        misafir → host
  SNAP:    'snap',      // { tick, t, data }       host → misafir
  SCENE:   'scene',     // { id, time, phase }     host → misafir (sinematik senkronu)
  CHOICE:  'choice',    // { id }                  misafir → host (teklif cevabı)
  HALT:    'halt',      // { on }                  misafir → host (duraklattım / devam ettim)
  CHAT:    'chat',      // { text }                oda içi gerçek zamanlı sohbet
  PING:    'ping',      // { ts }
  BYE:     'bye',       // {}

  /* Sunucu → İstemci */
  CREATED: 'created',   // { room, role, playerId, token }
  JOINED:  'joined',    // { room, role, playerId, token, config }
  RESUMED: 'resumed',   // { room, role, playerId, config, phase }
  PEER:    'peer',      // { event: 'joined'|'left'|'dropped'|'rejoined', name }
  LOBBY:   'lobby',     // { host, guest, phase }
  PONG:    'pong',      // { ts, now }
  ERROR:   'error'      // { code, message }
};

/* ---------- Hata kodları ---------- */

export const ERR = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL:      'ROOM_FULL',
  BAD_TOKEN:      'BAD_TOKEN',
  NOT_HOST:       'NOT_HOST',
  BAD_MESSAGE:    'BAD_MESSAGE',
  RATE_LIMITED:   'RATE_LIMITED',
  VERSION:        'VERSION_MISMATCH'
};

export const ERR_TEXT = {
  [ERR.ROOM_NOT_FOUND]: 'Oda bulunamadı. Linkin doğru olduğundan emin ol.',
  [ERR.ROOM_FULL]:      'Bu odada zaten iki kişi var.',
  [ERR.BAD_TOKEN]:      'Oturum geçersiz. Bağlantıya yeniden tıkla.',
  [ERR.NOT_HOST]:       'Bunu sadece oyunu kuran kişi yapabilir.',
  [ERR.BAD_MESSAGE]:    'Anlaşılamayan mesaj.',
  [ERR.RATE_LIMITED]:   'Çok hızlı mesaj gönderiliyor.',
  [ERR.VERSION]:        'Sürüm uyuşmazlığı. Sayfayı yenile.'
};

/* ---------- Oda evreleri ---------- */

export const PHASE = {
  LOBBY:  'lobby',      // iki taraf bekleme salonunda
  INTRO:  'intro',      // açılış sinematiği oynuyor
  GAME:   'game',       // bölümler oynanıyor
  OUTRO:  'outro',      // final sinematiği + teklif
  DONE:   'done'
};

/* ---------- Roller ---------- */

export const ROLE = { HOST: 'host', GUEST: 'guest' };

/* --------------------------------------------------------------------------
   Input bit maskesi

   Misafirin tuş durumu saniyede 30 kez gönderiliyor. JSON'da
   { left:true, right:false, ... } yazmak yerine tek bir sayıya paketliyoruz:
   ~60 bayt yerine ~1 bayt. Mobil bağlantıda fark ediyor.
   -------------------------------------------------------------------------- */

export const BIT = {
  LEFT:   1 << 0,
  RIGHT:  1 << 1,
  DOWN:   1 << 2,
  JUMP:   1 << 3,
  ATTACK: 1 << 4,
  SHOOT:  1 << 5,
  BLOCK:  1 << 6,
  /* "Bu karede basıldı" kenar tetikleri — buffer mantığı ağ üstünden
     korunsun diye ayrı bit olarak taşınıyor */
  JUMP_EDGE:   1 << 7,
  ATTACK_EDGE: 1 << 8,
  SHOOT_EDGE:  1 << 9
};

export function packInput(i) {
  let b = 0;
  if (i.left)   b |= BIT.LEFT;
  if (i.right)  b |= BIT.RIGHT;
  if (i.down)   b |= BIT.DOWN;
  if (i.jumpHeld)   b |= BIT.JUMP;
  if (i.attackHeld) b |= BIT.ATTACK;
  if (i.shootHeld)  b |= BIT.SHOOT;
  if (i.blockHeld)  b |= BIT.BLOCK;
  if (i.jumpEdge)   b |= BIT.JUMP_EDGE;
  if (i.attackEdge) b |= BIT.ATTACK_EDGE;
  if (i.shootEdge)  b |= BIT.SHOOT_EDGE;
  return b;
}

export function unpackInput(b, into = {}) {
  into.left       = !!(b & BIT.LEFT);
  into.right      = !!(b & BIT.RIGHT);
  into.down       = !!(b & BIT.DOWN);
  into.jumpHeld   = !!(b & BIT.JUMP);
  into.attackHeld = !!(b & BIT.ATTACK);
  into.shootHeld  = !!(b & BIT.SHOOT);
  into.blockHeld  = !!(b & BIT.BLOCK);
  into.jumpEdge   = !!(b & BIT.JUMP_EDGE);
  into.attackEdge = !!(b & BIT.ATTACK_EDGE);
  into.shootEdge  = !!(b & BIT.SHOOT_EDGE);
  return into;
}

/* --------------------------------------------------------------------------
   Oda kodu

   Karışabilecek karakterler yok: 0/O, 1/I/L. Telefonda sesli okunabilsin diye.
   -------------------------------------------------------------------------- */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode(len = 5, rnd = Math.random) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)];
  return s;
}

export function isValidRoomCode(code) {
  return typeof code === 'string'
    && code.length >= 4 && code.length <= 8
    && [...code].every(c => CODE_ALPHABET.includes(c));
}

/* ---------- Çerçeveleme ---------- */

export function encode(type, payload = {}) {
  return JSON.stringify({ t: type, ...payload });
}

export function decode(raw) {
  try {
    const m = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    if (!m || typeof m.t !== 'string') return null;
    return m;
  } catch {
    return null;
  }
}

/* ---------- Ayarlar (iki taraf da aynı sayıları kullansın) ---------- */

export const NET = {
  SNAPSHOT_HZ:      20,     // host → misafir anlık görüntü sıklığı
  INPUT_HZ:         30,     // misafir → host tuş durumu sıklığı
  SCENE_SYNC_HZ:    4,      // sinematik saat yayını
  HEARTBEAT_MS:     5000,   // istemci canlılık işareti
  PRESENCE_TTL_MS:  20000,  // bu süre işaret gelmezse düşmüş sayılır
  ROOM_TTL_MS:      2 * 60 * 60 * 1000,   // 2 saat
  RECONNECT_MS:     30000,  // kopan taraf bu süre içinde dönerse devam
  INTERP_DELAY_MS:  100,    // misafir bu kadar geçmişi oynatır (yumuşaklık için)
  CHAT_MAX_CHARS:   240,
  CHAT_COOLDOWN_MS: 500,
  MAX_MSG_BYTES:    64 * 1024
};
