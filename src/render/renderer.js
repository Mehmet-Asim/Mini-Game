/* ==========================================================================
   Ana Render Hattı
   sıra: arka plan → dünya → varlıklar → oyuncu → parçacıklar → ışık → post
   ========================================================================== */

import { Background, THEMES } from './background.js';
import { drawKnight, drawWalker, drawFlyer, drawCaster, drawDragon } from './sprites.js';
import {
  drawSolids, drawMovingPlatform, drawCrumble, drawSpikes,
  drawHeart, drawLifeOrb, drawCheckpoint, drawPortal, drawProjectile, drawArrow,
  drawShieldPickup, drawTip, drawPlate, drawGate, drawCoopLift
} from './world.js';
import { clamp } from '../core/utils.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.bg = new Background('forest');
    this.time = 0;
    this.flash = 0;          // beyaz ekran flaşı
    this.flashColor = '255,255,255';
    this.dpr = 1;
  }

  resize(cssW, cssH) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = cssW;
    this.h = cssH;
  }

  setTheme(name) { this.bg.setTheme(name); }

  addFlash(amount = 0.5, color = '255,255,255') {
    this.flash = Math.max(this.flash, amount);
    this.flashColor = color;
  }

  render(state, dt) {
    const ctx = this.ctx;
    const { cam, level, player, entities, particles, boss, theme, tips, hitStop } = state;
    this.time += dt;
    this.bg.update(dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.6);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    /* ---- Zoom (punch) ---- */
    const z = cam.zoom;
    if (z !== 1) {
      ctx.translate(this.w / 2, this.h / 2);
      ctx.scale(z, z);
      ctx.translate(-this.w / 2, -this.h / 2);
    }

    /* ---- 1. Arka plan ----
       Zoom uzaklaştığında görünen alan ekrandan büyür. Arka planı sabit
       `this.w/this.h` ile çizmek kenarlarda boş şeritler bırakıyordu; onun
       yerine görünen pencerenin sol-üst köşesine kayıp o kadar alan
       boyuyoruz. Ufuk çizgisi bu sayede her zoom değerinde ekranın aynı
       yüzdesinde kalıyor. */
    ctx.save();
    ctx.translate(cam.screenLeft, cam.screenTop);
    this.bg.render(ctx, cam, cam.viewW, cam.viewH);
    ctx.restore();

    /* ---- 2. Dünya ---- */
    drawSolids(ctx, level, cam, theme, this.time);

    for (const mp of entities.movingPlatforms) {
      if (cam.isVisible(mp.x, mp.y, 200)) drawMovingPlatform(ctx, mp, cam, theme, this.time);
    }
    for (const cp of entities.crumbles) {
      if (cam.isVisible(cp.x, cp.y, 200)) drawCrumble(ctx, cp, cam, theme, this.time);
    }
    for (const sp of entities.spikes) {
      if (cam.isVisible(sp.x, sp.y, 120)) drawSpikes(ctx, sp, cam, theme);
    }

    /* ---- 2b. Co-op mekanizmaları ---- */
    const needed = (state.players || []).length || 1;
    for (const lift of (entities.coopLifts || [])) {
      if (cam.isVisible(lift.x, lift.y, 260)) drawCoopLift(ctx, lift, cam, theme, needed);
    }
    for (const pl of (entities.plates || [])) {
      if (cam.isVisible(pl.x, pl.y, 160)) drawPlate(ctx, pl, cam, this.time);
    }
    for (const g of (entities.gates || [])) {
      if (cam.isVisible(g.x, g.baseY, 260)) drawGate(ctx, g, cam, this.time);
    }
    for (const cp of entities.checkpoints) {
      if (cam.isVisible(cp.x, cp.y, 200)) drawCheckpoint(ctx, cp, cam, this.time);
    }

    if (entities.portal && cam.isVisible(entities.portal.x, entities.portal.y, 240)) {
      drawPortal(ctx, entities.portal, cam, this.time, particles);
    }

    /* ---- 3. Toplanabilirler ---- */
    for (const h of entities.hearts) {
      if (!h.collected && cam.isVisible(h.x, h.y, 80)) drawHeart(ctx, h, cam, this.time);
    }
    for (const o of entities.lifeOrbs) {
      if (!o.collected && cam.isVisible(o.x, o.y, 80)) drawLifeOrb(ctx, o, cam, this.time);
    }
    const sp = entities.shieldPickup;
    if (sp && !sp.collected && cam.isVisible(sp.x, sp.y, 140)) {
      drawShieldPickup(ctx, sp, cam, this.time);
    }

    /* ---- 4. İpuçları ---- */
    if (tips) {
      for (const t of tips) drawTip(ctx, t, cam, t.alpha);
    }

    /* ---- 5. Düşmanlar ---- */
    for (const e of entities.enemies) {
      if (!cam.isVisible(e.x, e.y, 160)) continue;
      if (e.type === 'walker') drawWalker(ctx, e, cam, this.time);
      else if (e.type === 'flyer') drawFlyer(ctx, e, cam);
      else if (e.type === 'caster') drawCaster(ctx, e, cam, this.time);
    }

    /* ---- 6. Boss ---- */
    if (boss && boss.alive) drawDragon(ctx, boss, cam, this.time);

    /* ---- 7. Mermiler ---- */
    for (const pr of entities.projectiles) {
      if (cam.isVisible(pr.x, pr.y, 80)) drawProjectile(ctx, pr, cam, this.time);
    }

    /* ---- 7b. Oklar ---- */
    for (const ar of (entities.arrows || [])) {
      if (cam.isVisible(ar.x, ar.y, 80)) drawArrow(ctx, ar, cam);
    }

    /* ---- 8. Oyuncular ----
       Yerel oyuncu EN SON çizilir ki üstte kalsın; iki karakter üst üste
       geldiğinde kendi karakterini kaybetmek çok can sıkıcı oluyor. */
    const roster = state.players && state.players.length ? state.players : [player];
    const localIdx = state.localIndex ?? 0;
    const order = roster
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (a.i === localIdx ? 1 : 0) - (b.i === localIdx ? 1 : 0));

    for (const { p, i } of order) {
      drawKnight(ctx, p, cam, this.time);
      if (roster.length > 1) this._playerBadge(ctx, p, cam, i === localIdx);
    }

    /* ---- 9. Parçacıklar ---- */
    particles.render(ctx, cam.offsetX, cam.offsetY, cam);

    /* ---- 10. Işıklandırma ---- */
    this._lighting(ctx, state);

    /* ---- 11. Post ---- */
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._vignette(ctx, theme);

    /* Ekran dışı yoldaş oku — vinyetin üstünde, HUD'un altında */
    this._offscreenMarkers(ctx, state);

    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashColor}, ${this.flash * 0.55})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    // Hit-stop sırasında hafif renk kayması
    if (hitStop > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = 'rgba(255, 60, 60, 0.14)';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }

    // Düşük can uyarısı
    if (state.lives === 1 && !player.dead) {
      const pulse = 0.12 + Math.sin(this.time * 4.5) * 0.09;
      ctx.save();
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.35, this.w / 2, this.h / 2, this.h * 0.85);
      g.addColorStop(0, 'rgba(200,20,40,0)');
      g.addColorStop(1, `rgba(200,20,40,${pulse})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }
  }

  /* ==========================================================================
     Co-op göstergeleri

     İki karakter aynı anda ekrandayken üç soru sürekli soruluyor:
       "hangisi benim?"  "yoldaşım nerede?"  "onu kaldırabilir miyim?"
     Bu üç işaret o üç soruyu cevaplıyor.
     ========================================================================== */

  /** Karakterin üstündeki kimlik nişanı + yere serilme göstergesi */
  _playerBadge(ctx, p, cam, isLocal) {
    if (p.dead) return;
    const x = p.cx - cam.offsetX;
    const y = p.y - cam.offsetY;
    const aura = p.palette?.aura || '212,168,83';

    /* Yere serilmişse: kaldırma halkası + kalan süre */
    if (p.downed) {
      const r = 22;
      ctx.save();
      ctx.translate(x, y + p.h * 0.6);
      /* Zemin halkası */
      ctx.strokeStyle = 'rgba(255,80,100,0.45)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(0, 0, r + 8, (r + 8) * 0.36, 0, 0, Math.PI * 2); ctx.stroke();
      /* Kaldırma ilerlemesi */
      if (p.reviveProgress > 0.01) {
        ctx.strokeStyle = '#3ddc84';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, r + 8, (r + 8) * 0.36, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.reviveProgress);
        ctx.stroke();
      }
      ctx.restore();

      /* Yardım çağrısı — yanıp sönen ünlem */
      const blink = 0.5 + Math.sin(this.time * 6) * 0.5;
      ctx.save();
      ctx.globalAlpha = 0.5 + blink * 0.5;
      ctx.fillStyle = '#ff5f7a';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', x, y - 12);
      ctx.restore();
      return;
    }

    /* Ayaktaysa: küçük renk nişanı. Yerel oyuncuda dolu, yoldaşta boş. */
    ctx.save();
    ctx.globalAlpha = isLocal ? 0.9 : 0.65;
    ctx.beginPath();
    ctx.arc(x, y - 12, 3.4, 0, Math.PI * 2);
    if (isLocal) { ctx.fillStyle = `rgba(${aura},1)`; ctx.fill(); }
    else { ctx.strokeStyle = `rgba(${aura},1)`; ctx.lineWidth = 1.6; ctx.stroke(); }
    ctx.restore();
  }

  /** Ekran dışındaki yoldaşı gösteren kenar oku */
  _offscreenMarkers(ctx, state) {
    const { cam, players, localIndex } = state;
    if (!players || players.length < 2) return;

    const pad = 26;
    for (let i = 0; i < players.length; i++) {
      if (i === localIndex) continue;
      const p = players[i];
      if (p.dead) continue;

      const sx = p.cx - cam.offsetX;
      const sy = p.cy - cam.offsetY;
      const inside = sx > -20 && sx < this.w + 20 && sy > -20 && sy < this.h + 20;
      if (inside) continue;

      const cx = clamp(sx, pad, this.w - pad);
      const cy = clamp(sy, pad, this.h - pad);
      const ang = Math.atan2(sy - this.h / 2, sx - this.w / 2);
      const aura = p.palette?.aura || '127,216,232';
      const urgent = p.downed;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      const pulse = urgent ? 0.6 + Math.sin(this.time * 7) * 0.4 : 0.75;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = urgent ? 'rgba(255,95,122,1)' : `rgba(${aura},1)`;
      ctx.beginPath();
      ctx.moveTo(11, 0); ctx.lineTo(-7, -7); ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      /* Mesafe — "ne kadar uzakta?" */
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#cfd6e6';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const dist = Math.round(Math.hypot(p.cx - (cam.offsetX + this.w / 2), p.cy - (cam.offsetY + this.h / 2)) / 10);
      ctx.fillText(`${dist}m`, cx, cy + 20);
      ctx.restore();
    }
  }

  /** Nokta ışıkları — oyuncu, meşaleler, portal, ateş */
  _lighting(ctx, state) {
    const { cam, player, players, entities, theme, boss } = state;
    const t = THEMES[theme] || THEMES.forest;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Oyuncu fenerleri — her karakter kendi ışığını taşır
    for (const p of (players && players.length ? players : [player])) {
      if (p.dead) continue;
      const px = p.cx - cam.offsetX;
      const py = p.cy - cam.offsetY;
      const r = (190 + Math.sin(this.time * 2) * 10) * (p.downed ? 0.55 : 1);
      const pg = ctx.createRadialGradient(px, py, 4, px, py, r);
      pg.addColorStop(0, t.lightColor);
      pg.addColorStop(0.4, t.lightColor.replace(/[\d.]+\)$/, '0.04)'));
      pg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    }

    // Aktif checkpointler
    for (const cp of entities.checkpoints) {
      if (!cp.activated || !cam.isVisible(cp.x, cp.y, 200)) continue;
      const cx = cp.cx - cam.offsetX;
      const cy = cp.y - cam.offsetY + 6;
      const flick = 0.8 + Math.sin(this.time * 10 + cp.x) * 0.2;
      const g = ctx.createRadialGradient(cx, cy, 3, cx, cy, 130 * flick);
      g.addColorStop(0, 'rgba(255, 180, 80, 0.16)');
      g.addColorStop(1, 'rgba(255, 140, 40, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, 130 * flick, 0, Math.PI * 2); ctx.fill();
    }

    // Boss ağzı
    if (boss && boss.alive && boss.mouthGlow > 0.1) {
      const bx = boss.x - cam.offsetX + (boss.facing > 0 ? boss.w : 0);
      const by = boss.y - cam.offsetY + 44;
      const g = ctx.createRadialGradient(bx, by, 4, bx, by, 220 * boss.mouthGlow);
      g.addColorStop(0, `rgba(255, 140, 50, ${0.2 * boss.mouthGlow})`);
      g.addColorStop(1, 'rgba(255, 80, 20, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, 220 * boss.mouthGlow, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }

  _vignette(ctx, theme) {
    const t = THEMES[theme] || THEMES.forest;
    const g = ctx.createRadialGradient(
      this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.32,
      this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.78
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.65, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0.68)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // Tema ambiyansı
    ctx.fillStyle = t.ambient;
    ctx.fillRect(0, 0, this.w, this.h);

    // Tarama çizgileri (çok hafif retro dokunuş)
    ctx.save();
    ctx.globalAlpha = 0.025;
    ctx.fillStyle = '#000';
    for (let y = 0; y < this.h; y += 3) ctx.fillRect(0, y, this.w, 1);
    ctx.restore();
  }
}
