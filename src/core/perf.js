/* ==========================================================================
   Kare Ölçer

   NEDEN VAR: "biraz takılıyor" bir sayı değil. Hangi tarafta, ne kadar,
   ne sıklıkta takıldığını bilmeden yapılan iyileştirme tahmine dayanıyor —
   ve iki farklı bilgisayarda oynanan bir oyunda tahmin işe yaramıyor.
   Host'ta rahat görünen kare, misafirin telefonunda dört katı pahalı
   olabiliyor (maliyet piksel sayısıyla, yani dpr'nin KARESİYLE büyüyor).

   Panelde (F3) gösterilen sayılar buradan geliyor.

   ORTALAMA DEĞİL YÜZDELİK ölçüyoruz. Takılma tanım gereği nadir bir olay;
   ortalamanın içinde kayboluyor. Saniyede bir kez gelen 40 ms'lik kare
   ortalamayı 16.7'den 17.1'e çıkarıyor — grafikte hiçbir şey görünmüyor,
   oyuncu ise her saniye bir tökezleme hissediyor. p95 ve "uzun kare"
   sayacı o tökezlemeyi doğrudan gösteriyor.
   ========================================================================== */

/* 3 saniyelik pencere: takılmanın geçici mi sürekli mi olduğunu görmeye
   yetiyor, panel 4 Hz tazelendiği için de her okumada taze veri düşüyor. */
const WINDOW = 180;

export class FrameMeter {
  constructor(size = WINDOW) {
    this.size = size;
    this.frame = new Float32Array(size);   // kareler arası geçen süre (ms)
    this.draw = new Float32Array(size);    // o karede çizime harcanan (ms)
    this.n = 0;                            // toplam örnek (dolana kadar)
    this.i = 0;                            // yazma imleci
    this._scratch = new Float32Array(size);
  }

  /**
   * @param frameMs  bir önceki kareden bu yana geçen gerçek süre
   * @param drawMs   bu karede renderer.render() içinde geçen süre
   */
  push(frameMs, drawMs) {
    this.frame[this.i] = frameMs;
    this.draw[this.i] = drawMs;
    this.i = (this.i + 1) % this.size;
    if (this.n < this.size) this.n++;
  }

  reset() { this.n = 0; this.i = 0; }

  /** Sıralı kopya üzerinden yüzdelik — pencere küçük, maliyeti yok. */
  _pct(src, p) {
    if (this.n === 0) return 0;
    const s = this._scratch.subarray(0, this.n);
    s.set(src.subarray(0, this.n));
    s.sort();
    return s[Math.min(this.n - 1, Math.floor(this.n * p))];
  }

  /** Pencerede kaç kare bu eşiği aştı */
  _over(src, ms) {
    let c = 0;
    for (let k = 0; k < this.n; k++) if (src[k] > ms) c++;
    return c;
  }

  /**
   * Panelin okuduğu özet.
   * `fps` gerçekleşen kare hızı — hedeflenen değil, ölçülen.
   */
  read() {
    const med = this._pct(this.frame, 0.5);
    return {
      samples: this.n,
      fps: med > 0 ? 1000 / med : 0,
      frameMedian: med,
      frameP95: this._pct(this.frame, 0.95),
      frameMax: this._pct(this.frame, 0.999),
      drawMedian: this._pct(this.draw, 0.5),
      drawP95: this._pct(this.draw, 0.95),
      /* 20 ms = 50 fps'in altı (fark edilir), 33 ms = kare atlaması */
      janky: this._over(this.frame, 20),
      severe: this._over(this.frame, 33)
    };
  }
}
