/* ==========================================================================
   Co-op Oturumu — ağ ile oyunu birbirine bağlayan katman

   GameEngine ağdan habersizdir, NetClient oyundan habersizdir. İkisini
   burada birleştiriyoruz. Bu ayrımı korumak önemli: motoru tek başına test
   edebiliyoruz (tools/coop-test.mjs), ağı tek başına test edebiliyoruz
   (tools/server-test.mjs), ikisinin birleşimini ayrıca (tools/net-sim-test.mjs).

   Görev dağılımı:

     HOST                                  MİSAFİR
     ────────────────────────────────      ────────────────────────────────
     dünyayı simüle eder                   yalnızca kendi karakterini tahmin eder
     20 Hz anlık görüntü yayınlar          30 Hz tuş durumu yollar
     misafirin tuşlarını uygular           gelen görüntüleri tamponlar
     sahne saatini yayınlar                sahne saatine kilitlenir
     teklif cevabını alır                  teklif cevabını verir
   ========================================================================== */

import { MSG, NET, PHASE, packInput } from './client.js';
import { unpackInput } from '../../server/protocol.js';
import { serializeSnapshot, applySnapshot, reconcileLocal, SnapshotBuffer } from './snapshot.js';

export class CoopSession {
  constructor(net, { onPeerState, onNetPause } = {}) {
    this.net = net;
    /* Host duraklattığı için mi duruyoruz? Misafire sebebini söylemek
       şart: sebepsiz donan ekran "oyun bozuldu" gibi hissettiriyor. */
    this.onNetPause = onNetPause;
    this.isHost = net.isHost;
    this.localIndex = net.isHost ? 0 : 1;
    this.remoteIndex = net.isHost ? 1 : 0;

    this.engine = null;
    this.director = null;
    this.onPeerState = onPeerState;

    this.tick = 0;
    this.inputSeq = 0;
    this.buffer = new SnapshotBuffer();
    this.lastSentPresses = { jump: 0, attack: 0, shoot: 0 };
    /* Gönderilmiş ama henüz host tarafından onaylanmamış girdiler.
       Her kayıt: { seq, x, y } — o girdiyi yollarken neredeydim. */
    this.pendingInputs = [];
    /* Son gönderilen girdi bitleri — kayıp paketleri kurtarmak için */
    this._lastBits = [];

    this.peerOnline = true;
    this.lastSnapshotAt = 0;
    this.stats = { sent: 0, received: 0, bytes: 0, drift: 0 };
    this.phase = null;
    this.levelIndex = 0;

    this._timers = [];
    this._offs = [];
    this._bind();
  }

  /* ---------- Motor bağlama ---------- */

  attachEngine(engine) {
    this.engine = engine;
    this.buffer.clear();
    /* Misafirin YEREL duraklatması host'a bildirilir. Host'unki zaten
       anlık görüntüdeki `st` ile gidiyor. */
    engine.onHalt = (on, source) => { if (source === 'local') this.sendHalt(on); };
    if (this.isHost) {
      this._startHostLoop();
      this.setPhase(PHASE.GAME, engine.levelIndex ?? 0);
    } else this._startGuestLoop();
  }

  detachEngine() {
    this._clearTimers();
    this.engine = null;
  }

  /** Sinematik yönetmenini bağla — sahne saati senkronu için */
  attachDirector(director) {
    this.director = director;
    this._clearTimer('scene');
    if (this.isHost && director) {
      const sid = director.scene?.id || '';
      if (sid === 'intro') this.setPhase(PHASE.INTRO);
      else if (sid.startsWith('outro')) this.setPhase(PHASE.OUTRO);

      this._every('scene', 1000 / NET.SCENE_SYNC_HZ, () => {
        if (!this.director) return;
        this.net.send(MSG.SCENE, {
          id: this.director.scene.id,
          time: Math.round(this.director.time * 1000) / 1000,
          waiting: this.director.awaitingChoice ? 1 : 0,
          phase: this.phase || undefined,
          levelIndex: this.levelIndex
        });
      });
    }
  }

  /**
   * Oda evresini host üzerinden sunucuya yaz.
   * Yeniden bağlanan oyuncu RESUMED.phase ile doğru yere dönebilsin.
   */
  setPhase(phase, levelIndex) {
    if (!phase) return;
    this.phase = phase;
    if (levelIndex !== undefined) this.levelIndex = levelIndex;
    if (!this.isHost) return;
    this.net.send(MSG.SCENE, {
      id: this.director?.scene?.id || '',
      time: this.director ? Math.round(this.director.time * 1000) / 1000 : 0,
      waiting: this.director?.awaitingChoice ? 1 : 0,
      phase,
      levelIndex: this.levelIndex
    });
  }

  detachDirector() {
    this.director = null;
    this._clearTimer('scene');
  }

  /* ---------- Ağ olayları ---------- */

  _bind() {
    /* Misafirden gelen tuşlar → host'un motoruna */
    this._offs.push(this.net.on(MSG.INPUT, (m) => {
      if (!this.isHost || !this.engine) return;
      this.stats.received++;
      this.engine.applyRemoteInput(this.remoteIndex, unpackInput(m.bits || 0), m.seq || 0,
        Array.isArray(m.bk) ? m.bk.map(b => unpackInput(b || 0)) : null);
    }));

    /* Host'tan gelen anlık görüntü → misafirin tamponuna */
    this._offs.push(this.net.on(MSG.SNAP, (m) => {
      if (this.isHost || !m.d) return;
      this.stats.received++;
      this.lastSnapshotAt = performance.now();

      /* UZLAŞTIRMA burada, tamponlamadan ÖNCE ve anlık görüntü başına
         BİR KEZ yapılır. Tamponun içindeki harmanlanmış kareyle her karede
         uzlaşmak, tahmini geri sürükleyip karakteri kilitliyordu. */
      if (this.engine) {
        /* Teşhis için: host'tan hiç onay gelmiyorsa misafirin girdisi
           host'a ulaşmıyor demektir. Panel bunu tek satırda gösteriyor. */
        if (m.d.ak?.seq) this.engine.remoteAckSeen = m.d.ak.seq;
        const err = reconcileLocal(this.engine, m.d, this.localIndex, this.pendingInputs);
        if (err !== null) this.stats.drift = err;
      }

      this.buffer.push(m.d);
    }));

    /* Sahne saati → misafirin yönetmenine */
    this._offs.push(this.net.on(MSG.SCENE, (m) => {
      if (this.isHost || !this.director) return;
      if (m.id && this.director.scene.id !== m.id) return;   // sahne değişimi ayrı yolla gelir
      if (m.phase) this.phase = m.phase;
      if (m.levelIndex !== undefined) this.levelIndex = m.levelIndex;
      this.director.syncTo(m.time, 0.2, !!m.waiting);
    }));

    /* --------------------------------------------------------------------
       Misafir duraklattı → host da dursun

       Tek yönlü duraklatma adaletsizdi: misafir menüyü ya da hatıra
       kartını açtığında host oynamaya devam ediyor, misafirin donmuş
       karakteri sahada savunmasız kalıyor ve ORTAK candan kaybettiriyordu.
       -------------------------------------------------------------------- */
    this._offs.push(this.net.on(MSG.HALT, (m) => {
      if (!this.isHost || !this.engine) return;
      if (m.on) this.engine.pause('net');
      else this.engine.resume('net');
    }));

    /* Bağlantı durumu */
    this._offs.push(this.net.on(MSG.PEER, (m) => {
      if (m.event === 'dropped' || m.event === 'left') this._setPeerOnline(false);
      if (m.event === 'rejoined' || m.event === 'joined') this._setPeerOnline(true);
    }));

    this._offs.push(this.net.on('status', ({ status }) => {
      if (status !== 'online') this._setPeerOnline(false);
    }));
  }

  _setPeerOnline(v) {
    if (this.peerOnline === v) return;
    this.peerOnline = v;
    /* Yoldaş düştüğünde oyunu duraklat — tek başına devam etmek anlamsız,
       kapıların yarısı iki kişi istiyor. */
    if (this.engine) {
      if (!v) this.engine.pause('net');
      else this.engine.resume('net');
    }
    this.onPeerState?.(v);
  }

  /* ---------- Host: anlık görüntü yayını ---------- */

  _startHostLoop() {
    this._every('snap', 1000 / NET.SNAPSHOT_HZ, () => {
      if (!this.engine || !this.peerOnline) return;
      const snap = serializeSnapshot(this.engine, ++this.tick);
      const ok = this.net.send(MSG.SNAP, { d: snap, k: this.tick });
      if (ok) this.stats.sent++;
    });
  }

  /* ---------- Misafir: tuş yayını + görüntü uygulama ---------- */

  /**
   * Misafirin girdisini yolla — motorun HER SABİT ADIMINDA çağrılır.
   *
   * Zamanlayıcıyla değil simülasyon adımıyla tetiklenmesi kritik: host'un
   * işlediği girdi dizisi, misafirin kendi tahmininde kullandığı diziyle
   * birebir aynı olmalı. Aksi halde her yön değişiminde iki taraf ayrışıyor.
   */
  sendInputTick(inp) {
    if (this.isHost || !this.engine || !inp) return;
    this._emitInput(inp);
  }

  _startGuestLoop() {
    /* Yedek zamanlayıcı: motor durmuşsa (duraklatma, sahne geçişi) bile
       host'un elinde güncel tuş durumu bulunsun. Adım tetiklemesi
       çalışırken bu neredeyse hiç iş yapmaz. */
    this._every('input', 1000 / NET.INPUT_HZ, () => {
      if (!this.engine || this.engine.state === 'playing') return;
      const inp = this.engine.inputs[this.localIndex];
      if (inp) this._emitInput(inp);
    });
  }

  _emitInput(inp) {
    if (!this.engine) return;
    {
      /* Basış sayaçlarıyla kenar tetiği çıkar (bkz. Input.presses) */
      const p = inp.presses || { jump: 0, attack: 0, shoot: 0 };
      const state = {
        left: inp.left, right: inp.right, down: inp.down,
        jumpHeld: inp.jumpHeld, attackHeld: inp.attackHeld,
        shootHeld: inp.shootHeld, blockHeld: inp.blockHeld,
        jumpEdge:   p.jump   > this.lastSentPresses.jump,
        attackEdge: p.attack > this.lastSentPresses.attack,
        shootEdge:  p.shoot  > this.lastSentPresses.shoot
      };
      this.lastSentPresses = { jump: p.jump, attack: p.attack, shoot: p.shoot };

      const seq = ++this.inputSeq;

      /* Bu girdiyi yollarken NEREDEYDİM — uzlaştırma bunu kullanacak.
         (bkz. snapshot.js → reconcileLocal) */
      const me = this.engine.players[this.localIndex];
      if (me) {
        this.pendingInputs.push({ seq, x: me.x, y: me.y });
        if (this.pendingInputs.length > 120) this.pendingInputs.shift();
      }

      const bits = packInput(state);
      /* Yedeklilik: son iki girdinin bitleri de gidiyor. Bir paket
         kaybolursa girdi kaybolmuyor, bir sonrakinin içinde geliyor. */
      const ok = this.net.send(MSG.INPUT, { seq, bits, bk: this._lastBits.slice(0, 2) });
      this._lastBits.unshift(bits);
      if (this._lastBits.length > 3) this._lastBits.pop();
      if (ok) this.stats.sent++;
    }
  }

  /**
   * Misafirin her KARE çağırması gereken fonksiyon.
   * Tampondan 100 ms geçmişi örnekler ve dünyaya uygular.
   */
  applyIncoming(now = performance.now()) {
    if (this.isHost || !this.engine) return;
    const snap = this.buffer.sample(now);
    if (!snap) return;
    applySnapshot(this.engine, snap, this.localIndex);
    this._applyHostState(snap.st);
  }

  /* --------------------------------------------------------------------
     Host'un durumunu misafire yansıt

     Buradaki üç kural pahalıya öğrenildi:

     1. DURAKLATMANIN SAHİBİ VAR. Host duraklattıysa misafir de durur;
        host devam edince misafir de devam eder. Ama misafirin KENDİ
        menüsü ağdan gelen sinyalle kapanmaz. Eski kod "paused değilsen
        uygula" diyordu; misafir bir kez duraklayınca bir daha asla
        çıkamıyor ve oyun onun için orada bitiyordu.

     2. DURUM DEĞİŞİMİNDE SAYAÇ SIFIRLANIR. `stateTimer` sıfırlanmazsa
        misafir bölüm sonu perdesine önceki durumdan devraldığı sayaçla
        giriyor ve portal animasyonunu hiç görmüyor.

     3. BİTMİŞ DURUMA GERİ DÖNÜLMEZ. Host 1.4 sn boyunca 'levelDone'
        yayınlamaya devam ediyor; misafir kendi geçişini tamamladıysa
        onu tekrar oraya sokmak perdeyi yeniden açar.
     -------------------------------------------------------------------- */
  _applyHostState(st) {
    const eng = this.engine;
    if (!st || !eng) return;

    if (st === 'paused') {
      if (eng.state !== 'paused') {
        eng.pause('net');
        const settling = this._resumedAt && performance.now() - this._resumedAt < 600;
        if (!settling) this.onNetPause?.(true);
      }
      return;
    }

    if (eng.state === 'paused') {
      eng.resume('net');                     // yerel duraklama kendini korur
      if (eng.state === 'paused') return;    // hâlâ duruyorsa sahibi misafir
      this.onNetPause?.(false);
    }

    /* Bölüm sonu perdesi misafirde KENDİ temposunda oynamalı.
       Host bu durumda sadece 1.4 sn kalıyor; misafir onu ~100 ms geç
       görüyor ve host 'idle'a döndüğü anda dışarı çekilirse geçişini
       hiç tamamlayamıyor. Ölçümde tam bu oldu: host bölüm sonunu 1 kez
       tetikledi, misafir HİÇ tetiklemedi ve sonraki bölüme geçemedi.
       Bu yüzden 'levelDone' bir kez girildi mi, misafir kendi
       animasyonunu bitirene kadar kilitli. */
    if (eng.state === 'levelDone' && !eng._levelDoneFired) return;

    if (st === eng.state) return;
    /* Tersi de doğru: bitirdikten sonra host'un hâlâ yolda olan eski
       'levelDone' paketleri perdeyi yeniden açmasın. */
    if (st === 'levelDone' && eng._levelDoneFired) return;

    eng.state = st;
    eng.stateTimer = 0;
  }

  /* ---------- Duraklatma bildirimi ---------- */

  /** Misafir kendi duraklatmasını host'a bildirir (menü, hatıra kartı). */
  sendHalt(on) {
    if (this.isHost) return;
    this.net.send(MSG.HALT, { on: on ? 1 : 0 });
    /* Kendi devam edişimizden sonra host'un "hâlâ duraklıyorum" diyen
       bir tur eski anlık görüntüsü gelecek. Kısa bir süre ağ kaynaklı
       duraklatma kaplamasını göstermiyoruz ki ekran boşuna yanıp
       sönmesin. */
    if (!on) this._resumedAt = performance.now();
  }

  /* ---------- Teklif cevabı ---------- */

  sendChoice(id) { this.net.send(MSG.CHOICE, { id }); }

  onChoice(fn) { return this.net.on(MSG.CHOICE, (m) => fn(m.id)); }

  /* ---------- Oda içi sohbet ---------- */

  sendChat(text) {
    const clean = String(text || '').trim();
    if (!clean) return false;
    return this.net.send(MSG.CHAT, { text: clean });
  }

  onChat(fn) {
    return this.net.on(MSG.CHAT, (m) => fn({
      text: String(m.text || ''),
      from: m.from,
      ts: Number(m.ts) || Date.now()
    }));
  }

  /* ---------- Zamanlayıcı yardımcıları ---------- */

  _every(name, ms, fn) {
    this._clearTimer(name);
    const id = setInterval(fn, ms);
    this._timers.push({ name, id });
  }

  _clearTimer(name) {
    for (let i = this._timers.length - 1; i >= 0; i--) {
      if (this._timers[i].name === name) {
        clearInterval(this._timers[i].id);
        this._timers.splice(i, 1);
      }
    }
  }

  _clearTimers() {
    for (const t of this._timers) clearInterval(t.id);
    this._timers.length = 0;
  }

  destroy() {
    this._clearTimers();
    for (const off of this._offs) off();
    this._offs.length = 0;
    this.engine = null;
    this.director = null;
  }
}
