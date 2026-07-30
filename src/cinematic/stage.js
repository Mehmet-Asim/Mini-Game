/* ==========================================================================
   Sahne Kompozitörü

   Sanal çözünürlük: 1280x720. Tüm sanat bu koordinat sisteminde çizilir,
   ekran boyutu ne olursa olsun. Kadraja "cover" ile oturur — kenarlardan
   taşabilir ama asla siyah bant olmaz.

   Kamera sanal uzayda gezer. Her katmanın kendi parallax katsayısı vardır:
     0.0 → kamerayla hiç hareket etmez (gökyüzü)
     1.0 → kamerayla birebir hareket eder (ön plan)

   Bu dosya katmanın PROSEDÜREL mi GÖRSEL mi olduğunu bilmez ve umursamaz.
   ========================================================================== */

export const VW = 1280;
export const VH = 720;

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.w = VW;
    this.h = VH;
    this.scale = 1;
    this.originX = 0;
    this.originY = 0;
  }

  resize(cssW, cssH) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.w = cssW;
    this.h = cssH;
    this.canvas.width = Math.max(1, Math.floor(cssW * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssH * dpr));
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';

    // "cover": sanal kadraj ekranı tamamen doldurur
    this.scale = Math.max(cssW / VW, cssH / VH);
    this.originX = (cssW - VW * this.scale) / 2;
    this.originY = (cssH - VH * this.scale) / 2;
  }

  /** Ekran pikselinden sanal koordinata (tıklama testi için) */
  toVirtual(px, py) {
    return {
      x: (px - this.originX) / this.scale,
      y: (py - this.originY) / this.scale
    };
  }

  /** Kare başlangıcı — ekranı temizle ve sanal uzaya geç */
  begin(clearColor = '#05070d') {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = clearColor;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  /**
   * Bir katman için ctx'i hazırla.
   * cam: { x, y, zoom, shakeX, shakeY }
   * Çağıran ctx.restore() ile kapatmalı → pushLayer/popLayer ikilisi.
   */
  pushLayer(cam, parallax = 1, extra = null) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Ekran → sanal uzay
    ctx.translate(this.originX, this.originY);
    ctx.scale(this.scale, this.scale);

    // Kamera sarsıntısı (parallax'tan bağımsız, tüm katmanlara eşit uygulanır)
    ctx.translate(cam.shakeX || 0, cam.shakeY || 0);

    // Zoom — kadraj merkezinden
    const z = cam.zoom ?? 1;
    if (z !== 1) {
      ctx.translate(VW / 2, VH / 2);
      ctx.scale(z, z);
      ctx.translate(-VW / 2, -VH / 2);
    }

    // Parallax kaydırma
    /* Yarım sanal piksele kilitlemek 640x360 kaynakların 2x büyütülürken
       kamera hareketinde parlamasını azaltır. */
    const px = Math.round((cam.x || 0) * parallax * 2) / 2;
    const py = Math.round((cam.y || 0) * parallax * 2) / 2;
    ctx.translate(-px, -py);

    if (extra) {
      if (extra.offsetX || extra.offsetY) ctx.translate(extra.offsetX || 0, extra.offsetY || 0);
      if (extra.scale && extra.scale !== 1) {
        ctx.translate(VW / 2, VH / 2);
        ctx.scale(extra.scale, extra.scale);
        ctx.translate(-VW / 2, -VH / 2);
      }
      if (extra.opacity !== undefined) ctx.globalAlpha = extra.opacity;
      if (extra.blend) ctx.globalCompositeOperation = extra.blend;
    }

    return ctx;
  }

  popLayer() {
    this.ctx.restore();
  }

  /** Kamera/parallax olmadan, doğrudan sanal kadraja çiz (vinyet, fade, letterbox) */
  pushScreen() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.originX, this.originY);
    ctx.scale(this.scale, this.scale);
    return ctx;
  }

  /** Kadraj dışı alanı kırp — cover modunda taşan katmanlar için */
  clipFrame(ctx) {
    ctx.beginPath();
    ctx.rect(0, 0, VW, VH);
    ctx.clip();
  }

  /* ---------- Ortak post-process ---------- */

  vignette(strength = 0.62) {
    const ctx = this.pushScreen();
    const g = ctx.createRadialGradient(
      VW / 2, VH / 2, Math.min(VW, VH) * 0.34,
      VW / 2, VH / 2, Math.max(VW, VH) * 0.76
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.6, `rgba(0,0,0,${strength * 0.4})`);
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }

  /** Renk tabakası — sahne ambiyansı (gün batımı sıcaklığı, gece maviliği) */
  tint(color) {
    if (!color) return;
    const ctx = this.pushScreen();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }

  /** Siyaha/beyaza kararma */
  fade(alpha, color = '0,0,0') {
    if (alpha <= 0.001) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = `rgba(${color}, ${Math.min(1, alpha)})`;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  /** Sinematik siyah bantlar */
  letterbox(amount = 1) {
    if (amount <= 0.001) return;
    const barH = VH * 0.075 * amount;
    const ctx = this.pushScreen();
    ctx.fillStyle = '#000';
    // Kadrajın dışına da taşsın diye geniş çiz
    ctx.fillRect(-VW, -VH, VW * 3, VH + barH);
    ctx.fillRect(-VW, VH - barH, VW * 3, VH * 2);
    ctx.restore();
  }

  /** Çok hafif film grain — yağlı boya görsellere geçtiğimizde de işe yarar */
  grain(time, strength = 0.02) {
    const ctx = this.pushScreen();
    ctx.globalAlpha = strength;
    ctx.fillStyle = '#000';
    const off = (Math.floor(time * 24) % 3);
    for (let y = off; y < VH; y += 3) ctx.fillRect(0, y, VW, 1);
    ctx.restore();
  }
}
