/* ==========================================================================
   Input Manager
   Klavye + dokunmatik. Zıplama için buffer, yön için analog benzeri eksen.
   ========================================================================== */

const JUMP_BUFFER_TIME = 0.13; // saniye

/* Ağ girdisi kuyruğunun üst sınırı. ~8 kare = 130 ms tampon; üstü
   gecikmeyi büyütmekten başka işe yaramıyor. */
const MAX_INPUT_QUEUE = 12;

/* Tüketime başlamadan önce biriktirilecek girdi sayısı — dalgalanma tamponu.
   3 kare ≈ 50 ms; ağ dalgalanmasını yutmaya yetiyor, gecikmesi fark edilmiyor. */
const PRIME_DEPTH = 3;

/* --------------------------------------------------------------------------
   Tuş şemaları

   'primary'   → yön tuşları + WASD, boşluk, J/K/L        (tek oyuncu, host)
   'secondary' → sadece WASD, F/G/H                        (aynı klavyede 2. oyuncu)
   'arrows'    → sadece yön tuşları, Ctrl/Shift/Enter      ('secondary' ile eşleşir)

   İkinci şema ağ olmadan co-op test etmek için var: netcode'u beklemeden
   iki karakteri aynı klavyede oynatıp bölüm tasarımını denemek gerekiyordu.
   Yayında ikinci oyuncu kendi cihazından 'primary' kullanır.
   -------------------------------------------------------------------------- */

const SCHEMES = {
  primary: {
    left:   ['ArrowLeft', 'KeyA'],
    right:  ['ArrowRight', 'KeyD'],
    down:   ['ArrowDown', 'KeyS'],
    jump:   ['ArrowUp', 'KeyW', 'Space'],
    attack: ['KeyJ', 'ShiftLeft'],
    shoot:  ['KeyK'],
    block:  ['KeyL', 'ShiftRight'],
    pause:  ['Escape', 'KeyP']
  },
  secondary: {
    left:   ['KeyA'],
    right:  ['KeyD'],
    down:   ['KeyS'],
    jump:   ['KeyW'],
    attack: ['KeyF'],
    shoot:  ['KeyG'],
    block:  ['KeyH'],
    pause:  []
  },
  arrows: {
    left:   ['ArrowLeft'],
    right:  ['ArrowRight'],
    down:   ['ArrowDown'],
    jump:   ['ArrowUp'],
    attack: ['ControlRight', 'Enter'],
    shoot:  ['Numpad0', 'Slash'],
    block:  ['ShiftRight'],
    pause:  ['Escape']
  }
};

/** Tuşları eylemlere çeviren ters tablo */
function buildLookup(scheme) {
  const map = new Map();
  for (const [action, keys] of Object.entries(scheme)) {
    for (const k of keys) map.set(k, action);
  }
  return map;
}

export class Input {
  constructor(schemeName = 'primary') {
    this.scheme = SCHEMES[schemeName] ? schemeName : 'primary';
    this._lookup = buildLookup(SCHEMES[this.scheme]);
    this.left = false;
    this.right = false;
    this.down = false;
    this.jumpHeld = false;
    this.attackHeld = false;
    this.shootHeld = false;
    this.blockHeld = false;

    this._jumpBuffer = 0;
    this._attackBuffer = 0;
    this._shootBuffer = 0;
    this._pausePressed = false;

    this._touchLeft = false;
    this._touchRight = false;

    /* Basış sayaçları — ağ için.
       Misafirin motoru kendi karakterini tahmin ederken zıplama tamponunu
       TÜKETİYOR. Aynı basışı host'a da göndermemiz gerek; tüketilmiş bir
       tamponu okuyamayız. Bu yüzden basışları ayrıca sayıyoruz ve ağ katmanı
       "son gönderimden beri sayı arttı mı?" diye bakıyor. */
    this.presses = { jump: 0, attack: 0, shoot: 0 };

    this.onKeyDown = (e) => {
      /* Yazı yazarken tuşları çalma — ama SADECE yazı alanlarında.
         Burada `button` da listedeydi ve şu hataya yol açıyordu: oyuncu
         duraklat ya da sohbet butonuna bir kez tıklıyor, buton odakta
         kalıyor ve o andan sonra HİÇBİR TUŞ çalışmıyor. Karakter tamamen
         kilitleniyor, sebebi de görünmüyor. Buton zaten Enter/Boşluk'u
         kendisi ele alır; oyun tuşlarını ondan saklamamız gerekmiyor. */
      const target = e.target;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const action = this._lookup.get(e.code);
      if (!action) return;
      switch (action) {
        case 'left':  this.left = true; break;
        case 'right': this.right = true; break;
        case 'down':  this.down = true; e.preventDefault(); break;
        case 'jump':
          if (!this.jumpHeld) { this._jumpBuffer = JUMP_BUFFER_TIME; this.presses.jump++; }
          this.jumpHeld = true;
          e.preventDefault();
          break;
        case 'attack':
          if (!this.attackHeld) { this._attackBuffer = JUMP_BUFFER_TIME; this.presses.attack++; }
          this.attackHeld = true;
          break;
        case 'shoot':
          if (!this.shootHeld) { this._shootBuffer = JUMP_BUFFER_TIME; this.presses.shoot++; }
          this.shootHeld = true;
          break;
        case 'block': this.blockHeld = true; break;
        case 'pause': this._pausePressed = true; break;
      }
    };

    this.onKeyUp = (e) => {
      const action = this._lookup.get(e.code);
      if (!action) return;
      switch (action) {
        case 'left':   this.left = false; break;
        case 'right':  this.right = false; break;
        case 'down':   this.down = false; break;
        case 'jump':   this.jumpHeld = false; break;
        case 'attack': this.attackHeld = false; break;
        case 'shoot':  this.shootHeld = false; break;
        case 'block':  this.blockHeld = false; break;
      }
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /** Dokunmatik butonları bağla */
  bindTouch({ leftBtn, rightBtn, jumpBtn, attackBtn, shootBtn, blockBtn }) {
    const press = (el, down, up) => {
      if (!el) return;
      const d = (e) => { e.preventDefault(); down(); };
      const u = (e) => { e.preventDefault(); up(); };
      el.addEventListener('touchstart', d, { passive: false });
      el.addEventListener('touchend', u, { passive: false });
      el.addEventListener('touchcancel', u, { passive: false });
      el.addEventListener('mousedown', d);
      el.addEventListener('mouseup', u);
      el.addEventListener('mouseleave', u);
    };

    press(leftBtn, () => { this._touchLeft = true; this.left = true; }, () => { this._touchLeft = false; this.left = false; });
    press(rightBtn, () => { this._touchRight = true; this.right = true; }, () => { this._touchRight = false; this.right = false; });
    /* presses sayaçları BURADA DA artmalı: ağ katmanı kenar tetiklerini bu
       sayaçlardan çıkarıyor. Artmayınca dokunmatik misafirin zıplama/saldırı/ok
       basışları host'a hiç gitmiyordu — karakter yerinde sekip takılıyordu. */
    press(jumpBtn,
      () => { this._jumpBuffer = JUMP_BUFFER_TIME; this.jumpHeld = true; this.presses.jump++; },
      () => { this.jumpHeld = false; });
    press(attackBtn,
      () => { this._attackBuffer = JUMP_BUFFER_TIME; this.attackHeld = true; this.presses.attack++; },
      () => { this.attackHeld = false; });
    press(shootBtn,
      () => { this._shootBuffer = JUMP_BUFFER_TIME; this.shootHeld = true; this.presses.shoot++; },
      () => { this.shootHeld = false; });
    press(blockBtn,
      () => { this.blockHeld = true; },
      () => { this.blockHeld = false; });
  }

  /** -1, 0 veya 1 */
  get axis() {
    return (this.right ? 1 : 0) - (this.left ? 1 : 0);
  }

  /** Zıplama isteği var mı? Tüketir. */
  consumeJump() {
    if (this._jumpBuffer > 0) { this._jumpBuffer = 0; return true; }
    return false;
  }

  consumeAttack() {
    if (this._attackBuffer > 0) { this._attackBuffer = 0; return true; }
    return false;
  }

  consumeShoot() {
    if (this._shootBuffer > 0) { this._shootBuffer = 0; return true; }
    return false;
  }

  consumePause() {
    if (this._pausePressed) { this._pausePressed = false; return true; }
    return false;
  }

  update(dt) {
    if (this._jumpBuffer > 0) this._jumpBuffer -= dt;
    if (this._attackBuffer > 0) this._attackBuffer -= dt;
    if (this._shootBuffer > 0) this._shootBuffer -= dt;
  }

  reset() {
    this.left = this.right = this.down = false;
    this.jumpHeld = this.attackHeld = this.shootHeld = this.blockHeld = false;
    this._jumpBuffer = this._attackBuffer = this._shootBuffer = 0;
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}

/* ==========================================================================
   Uzak Girdi

   Klavyeye değil AĞA bağlı bir Input. Player.update() ikisini de ayırt
   edemez — aynı arayüzü sağlıyor. Host, misafirin tuşlarını bunun içine
   yazıyor ve simülasyon hiçbir şeyin farkında olmadan dönmeye devam ediyor.

   Kenar tetikleri (zıpla/saldır/at) ağ üstünden BİT olarak geliyor çünkü
   "bu karede basıldı" bilgisi kaybolursa zıplama isteği düşüyor ve karakter
   gecikmeli oynuyor.
   ========================================================================== */

export class RemoteInput {
  constructor() {
    this.left = false;
    this.right = false;
    this.down = false;
    this.jumpHeld = false;
    this.attackHeld = false;
    this.shootHeld = false;
    this.blockHeld = false;

    this._jumpBuffer = 0;
    this._attackBuffer = 0;
    this._shootBuffer = 0;

    this.lastSeq = -1;
    this.lastAppliedAt = 0;
    /* Tüketilmeyi bekleyen girdiler — adım başına bir tane */
    this.queue = [];
    this.starved = 0;      // kuyruk kaç kez boş kaldı (teşhis)
    this.primed = false;   // tampon dolana kadar tüketim başlamaz
    this.targetDepth = PRIME_DEPTH;   // açlık tekrarlarsa derinleşir
    this.recovered = 0;               // yedeklilikten kurtarılan girdi sayısı
    this._lastState = null;           // boşluk doldurmak için son bilinen tuş durumu
  }

  /**
   * Ağdan gelen girdiyi KUYRUĞA al.
   *
   * Doğrudan uygulamıyoruz. Sebebi uzlaştırma:
   *
   *   Misafir her simülasyon adımında bir girdi üretip yolluyor. Host da
   *   adım başına TAM BİR TANE tüketirse, "N-1 girdi işlenmiş" durumu iki
   *   tarafta da aynı simülasyon anına denk gelir ve konumlar birebir
   *   kıyaslanabilir.
   *
   *   Gelir gelmez uygulasaydık (ilk sürüm böyleydi) ağ dalgalanması
   *   yüzünden bir host karesinde iki girdi birden işlenebiliyor, adım
   *   sayısı girdi sayısından geri kalıyordu. Uzlaştırma da bunu gerçek
   *   sapma sanıp karakteri düzeltmeye çalışıyordu.
   *
   * Kuyruk aynı zamanda küçük bir dalgalanma tamponu görevi görüyor.
   */
  apply(state, seq = 0, backfill = null) {
    /* Sıra dışı gelen paketi yok say — yeniden bağlanmada eski paket
       sonradan düşebiliyor */
    if (seq !== 0 && seq <= this.lastSeq) return;

    /* ------------------------------------------------------------------
       KAYIP GİRDİYİ GERİ DOLDUR

       Her paket kendinden önceki birkaç girdiyi de taşıyor. Bir paket
       kaybolduğunda o girdi yok olmuyor; bir sonrakinin içinde geliyor.

       Bu olmadan kayıp girdi = host'un misafirden bir adım geride kalması
       demekti ve fark kalıcı olarak birikiyordu (%5 kayıpta 65px'e kadar).
       ------------------------------------------------------------------ */
    if (this.lastSeq >= 0 && seq > this.lastSeq + 1) {
      let filler = this._lastState;
      for (let s = this.lastSeq + 1; s < seq; s++) {
        const miss = backfill ? backfill[seq - s - 1] : undefined;   // 0 = seq-1 ...
        if (miss !== undefined) { this.recovered++; filler = miss; }
        /* Yedeklilik yetişmediyse SON BİLİNEN tuşu tekrarla.
           Boşluğu atlamak, host'un misafirden daha AZ adım atması demek;
           adım sayıları ayrıldığı anda iki dünya kalıcı olarak kayıyor.
           Bir-iki karelik yanlış tuş, kalıcı kaymadan çok daha ucuz. */
        this.queue.push({ seq: s, state: miss !== undefined ? miss : (filler || {}) });
      }
    }
    this._lastState = state;

    this.lastSeq = seq;
    this.lastAppliedAt = Date.now();

    this.queue.push({ seq, state });
    /* Aşırı birikme = misafir bizden hızlı ya da ağ tıkandı.
       En eskiyi at; geçmişi kovalamanın anlamı yok. */
    if (this.queue.length > MAX_INPUT_QUEUE) this.queue.shift();
  }

  /**
   * Sabit adım başına BİR girdi tüket.
   * @returns tüketilen kayıt ya da kuyruk boşsa null (son durum korunur)
   */
  consumeTick() {
    /* ------------------------------------------------------------------
       DALGALANMA TAMPONU

       Misafir saniyede 60 girdi üretiyor, host saniyede 60 adım atıyor.
       Oranlar eşit olduğu için kuyruk hep 0-1 civarında geziniyor ve en
       ufak gecikme dalgalanmasında BOŞALIYOR. Boş kalan adımda host yine
       de fizik işletiyor — misafir ise o adımı hiç atmıyor. Her boş adım
       iki simülasyon arasına kalıcı bir kare farkı koyuyor ve bu fark
       birikiyor.

       Çözüm: tüketmeye başlamadan önce kuyruğu birkaç girdiyle doldur.
       Bedeli ~3 kare (50 ms) gecikme, karşılığı iki tarafın aynı adım
       sayısında kalması — uzlaştırmanın doğru çalışması buna bağlı.
       ------------------------------------------------------------------ */
    if (!this.primed) {
      if (this.queue.length < this.targetDepth) { this.starved++; return null; }
      this.primed = true;
    }

    /* NOT: kuyruk şiştiğinde girdi ATMIYORUZ. Atmak, host'un o girdiyi hiç
       işlememesi demek; misafir işlediği için iki simülasyon kalıcı olarak
       ayrılıyor. Şişkinlik yalnızca birkaç karelik fazladan gecikme
       demek — kalıcı kaymadan çok daha ucuz. */

    const item = this.queue.shift();
    if (!item) {
      /* Tampon tükendi. Son durumu koruyup devam ediyoruz — bu adımda
         host bir kare "fazladan" simüle etmiş oluyor ve iki taraf arasına
         kalıcı bir fark giriyor. Uzlaştırma bunu düzeltiyor ama ucuz
         değil; o yüzden tekrarlarsa TAMPONU DERİNLEŞTİRİYORUZ.

         Burada `primed`'ı sıfırlamıyoruz: sıfırlamak, bir açlığın
         arkasından hedef derinlik kadar daha aç adım getiriyor ve sorunu
         dört katına çıkarıyordu. */
      this.starved++;
      this.targetDepth = Math.min(MAX_INPUT_QUEUE - 2, this.targetDepth + 1);
      return null;
    }
    this._set(item.state);
    return item;
  }

  _set(state) {
    this.left = !!state.left;
    this.right = !!state.right;
    this.down = !!state.down;
    this.jumpHeld = !!state.jumpHeld;
    this.attackHeld = !!state.attackHeld;
    this.shootHeld = !!state.shootHeld;
    this.blockHeld = !!state.blockHeld;

    if (state.jumpEdge)   this._jumpBuffer = JUMP_BUFFER_TIME;
    if (state.attackEdge) this._attackBuffer = JUMP_BUFFER_TIME;
    if (state.shootEdge)  this._shootBuffer = JUMP_BUFFER_TIME;
  }

  get axis() { return (this.right ? 1 : 0) - (this.left ? 1 : 0); }

  consumeJump()   { if (this._jumpBuffer > 0)   { this._jumpBuffer = 0;   return true; } return false; }
  consumeAttack() { if (this._attackBuffer > 0) { this._attackBuffer = 0; return true; } return false; }
  consumeShoot()  { if (this._shootBuffer > 0)  { this._shootBuffer = 0;  return true; } return false; }
  consumePause()  { return false; }

  update(dt) {
    if (this._jumpBuffer > 0) this._jumpBuffer -= dt;
    if (this._attackBuffer > 0) this._attackBuffer -= dt;
    if (this._shootBuffer > 0) this._shootBuffer -= dt;
  }

  reset() {
    this.left = this.right = this.down = false;
    this.jumpHeld = this.attackHeld = this.shootHeld = this.blockHeld = false;
    this._jumpBuffer = this._attackBuffer = this._shootBuffer = 0;
  }

  destroy() {}
  bindTouch() {}

  /** Bağlantı koptuysa tuşları bırak — karakter duvara yaslanıp kalmasın */
  checkStale(ms = 1500) {
    if (this.lastAppliedAt && Date.now() - this.lastAppliedAt > ms) {
      this.left = this.right = false;
      this.jumpHeld = this.attackHeld = this.shootHeld = this.blockHeld = false;
    }
  }
}
