/* ==========================================================================
   Camera
   Yumuşak takip + bakış öngörüsü (lookahead) + ekran sarsıntısı + zoom punch
   ========================================================================== */

export class Camera {
  constructor(viewW, viewH) {
    this.w = viewW;
    this.h = viewH;
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;

    this.lookahead = 0;        // mevcut öngörü ofseti
    this.lookaheadTarget = 0;

    this.shake = 0;            // sarsıntı gücü (px)
    this.shakeDecay = 4.5;
    this.shakeX = 0;
    this.shakeY = 0;

    /* --------------------------------------------------------------------
       İki ayrı zoom

       `zoomBase`  → kadraj kararı. Solo'da 1, co-op'ta iki oyuncuyu
                     sığdırmak için 1'in altına düşebilir.
       `punch`     → vuruş anındaki ani sıçrama. ÜSTÜNE eklenir.

       Eskiden tek bir `zoom` alanı vardı ve punchZoom onu doğrudan 1.04'e
       yazıyordu. Co-op'ta followGroup her karede zoomTarget'ı yeniden
       hesapladığı için darbe zoomu bir kare sonra 0.7'ye geri sıçrıyor,
       oyuncu bunu titreme olarak görüyordu. Ayırınca ikisi birbirine
       karışmıyor.
       -------------------------------------------------------------------- */
    this.zoomBase = 1;
    this.zoomTarget = 1;
    this.punch = 0;

    this.bounds = { minX: 0, maxX: 99999, minY: -99999, maxY: 99999 };
  }

  /** Çizimde kullanılan nihai ölçek */
  get zoom() { return Math.max(0.05, this.zoomBase + this.punch); }

  /* Zoom 1'in altına düşünce ekranda dünyanın DAHA FAZLASI görünür.
     Kırpma ve sınır hesapları bu genişliği kullanmak zorunda; yoksa
     co-op uzaklaşmasında zemin ve düşmanlar kenarlarda yok oluyor. */
  get viewW() { return this.w / this.zoom; }
  get viewH() { return this.h / this.zoom; }

  /* Zoom ekran merkezinden ölçeklendiği için görünür pencere, ekran
     koordinatlarında merkezden ±yarım genişlik kadar uzanır. */
  get screenLeft() { return (this.w - this.viewW) / 2; }
  get screenTop() { return (this.h - this.viewH) / 2; }
  get screenRight() { return this.screenLeft + this.viewW; }
  get screenBottom() { return this.screenTop + this.viewH; }

  resize(w, h) { this.w = w; this.h = h; }

  setBounds(minX, maxX, minY, maxY) {
    this.bounds = { minX, maxX, minY, maxY };
  }

  /** Anında hedefe atla (bölüm başlangıcı / respawn) */
  snapTo(px, py, facing = 1) {
    this.lookahead = facing * 90;
    this.lookaheadTarget = this.lookahead;
    this.punch = 0;
    this.x = this._clampX(px + this.lookahead - this.w / 2);
    this.y = this._clampY(py - this.h * 0.58);
    this.shake = 0;
  }

  follow(px, py, facing, dt) {
    // Yön değiştirince kamera hafifçe önü gösterir
    this.lookaheadTarget = facing * 90;
    this.lookahead += (this.lookaheadTarget - this.lookahead) * Math.min(1, dt * 3.5);

    const tx = px + this.lookahead - this.w / 2;
    const ty = py - this.h * 0.58;

    // Yatayda daha hızlı, dikeyde daha yumuşak takip (zıplamada kamera zıplamasın)
    this.x += (tx - this.x) * Math.min(1, dt * 6.5);
    this.y += (ty - this.y) * Math.min(1, dt * 3.2);

    this.x = this._clampX(this.x);
    this.y = this._clampY(this.y);
  }

  /**
   * İki oyuncuyu birden kadraja al.
   *
   * Co-op'ta tek oyuncuyu takip etmek işe yaramıyor: kamera kimi takip
   * ederse etsin diğeri ekran dışında kalıyor ve "nereye gitti?" sorusu
   * oynanışı bozuyor. Bunun yerine kamera iki oyuncunun ORTASINA gider ve
   * aradaki mesafe ekranı aşarsa yumuşakça uzaklaşır.
   *
   * points: [{ x, y }] — canlı oyuncuların merkezleri
   */
  followGroup(points, dt, opts = {}) {
    if (!points.length) return;
    if (points.length === 1) {
      this.follow(points[0].x, points[0].y, opts.facing ?? 1, dt);
      this.zoomTarget = 1;
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    /* Kenar payı: oyuncular kadrajın kenarına yapışmasın */
    const padX = opts.padX ?? 260;
    const padY = opts.padY ?? 200;
    const needW = (maxX - minX) + padX * 2;
    const needH = (maxY - minY) + padY * 2;

    /* Sığmıyorsa uzaklaş. 0.62 alt sınırı: daha fazla küçültmek
       karakterleri okunamaz hale getiriyor, onun yerine "yoldaşın orada"
       oku devreye giriyor (bkz. engine._offscreenMarkers). */
    const fit = Math.min(this.w / needW, this.h / needH, 1);
    this.zoomTarget = Math.max(opts.minZoom ?? 0.62, fit);

    /* Ölçekleme ekran MERKEZİNDEN yapıldığı için merkeze oturtma hesabı
       zoom'dan bağımsızdır: dünya noktası cx, offsetX = cx - w/2 iken
       ekranın tam ortasına düşer. Eski formül görünen genişliği hesaba
       katmaya çalışıyordu ve co-op uzaklaşmasında çifti ekranın yarım
       genişliği kadar sağa kaydırıyordu. */
    const tx = cx - this.w / 2;
    const ty = cy - this.h * 0.56;

    this.lookaheadTarget = 0;
    this.lookahead += (0 - this.lookahead) * Math.min(1, dt * 3);

    this.x += (tx - this.x) * Math.min(1, dt * 5.5);
    this.y += (ty - this.y) * Math.min(1, dt * 3.2);

    this.x = this._clampX(this.x);
    this.y = this._clampY(this.y);
  }

  update(dt) {
    if (this.shake > 0.05) {
      this.shake = Math.max(0, this.shake - this.shake * this.shakeDecay * dt);
      const a = Math.random() * Math.PI * 2;
      this.shakeX = Math.cos(a) * this.shake;
      this.shakeY = Math.sin(a) * this.shake;
    } else {
      this.shake = 0;
      this.shakeX = this.shakeY = 0;
    }
    this.zoomBase += (this.zoomTarget - this.zoomBase) * Math.min(1, dt * 6);
    /* Darbe zoomu kendi başına söner — kadraj kararına karışmaz */
    if (this.punch !== 0) {
      this.punch -= this.punch * Math.min(1, dt * 9);
      if (Math.abs(this.punch) < 0.0015) this.punch = 0;
    }
  }

  addShake(amount) {
    this.shake = Math.min(48, this.shake + amount);
  }

  punchZoom(amount = 0.04) {
    this.punch = Math.max(this.punch, amount);
  }

  /** Çizim için nihai ofset */
  get offsetX() { return this.x + this.shakeX; }
  get offsetY() { return this.y + this.shakeY; }

  worldToScreenX(wx) { return wx - this.offsetX; }
  worldToScreenY(wy) { return wy - this.offsetY; }

  /** Görünürlük testi — zoom'a duyarlı */
  isVisible(wx, wy, pad = 120) {
    const sx = wx - this.offsetX;
    const sy = wy - this.offsetY;
    return sx > this.screenLeft - pad && sx < this.screenRight + pad &&
           sy > this.screenTop - pad && sy < this.screenBottom + pad;
  }

  /* Sınır kelepçesi görünen pencereye göre hesaplanır. Zoom 1'in altındayken
     ekran `viewW` kadar dünya gösterir; eski hesap `w` kullandığı için
     co-op uzaklaşmasında kamera bölümün dışındaki boşluğu gösteriyordu. */
  _clampX(v) {
    const lo = this.bounds.minX - this.screenLeft;
    const hi = this.bounds.maxX - this.screenLeft - this.viewW;
    return Math.max(lo, Math.min(v, Math.max(lo, hi)));
  }
  _clampY(v) {
    const lo = this.bounds.minY - this.screenTop;
    const hi = this.bounds.maxY - this.screenTop - this.viewH;
    return Math.max(lo, Math.min(v, Math.max(lo, hi)));
  }
}
