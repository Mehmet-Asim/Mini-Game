/* ==========================================================================
   BOSS — Kızıl Ejderha "Vhaerix"

   Durum makinesi:
     entrance → hover → telegraph → (fireball | sweep | meteor | slam)
              → tired (savunmasız) → hover → ...

   Oyuncu yalnızca "tired" fazında hasar verebilir (kılıç, ok ya da kafaya
   zıplama). Her vuruşta faz sertleşir.

   TELEGRAPH NEDEN VAR
   Önceden `hover` bitince ejderha hiçbir uyarı vermeden saldırıya geçiyordu.
   En kötüsü süpürme dalışıydı: saniyede 430 piksel hızla, yerden 130 piksel
   yükseklikte, hiçbir işaret olmadan geliyordu. Oyuncunun tek savunması
   şanstı — kaçınılabilir bir saldırı değil, ezberlenmesi gereken bir tuzaktı.

   Şimdi her saldırının önünde kısa bir hazırlık fazı var ve hazırlığın
   ŞEKLİ saldırıyı söylüyor:
     · süpürme → geriye çekilir, kanatlar açılır, uçuş hattı yerde işaretlenir
     · ateş topu → yerinde durur, ağzı parlar
     · meteor → yükselir, gökyüzü kızarır
     · çarpma → tepeye tırmanır, sonra dikey iner (yalnızca 3. faz)

   Hazırlık süresi faz ilerledikçe kısalıyor: aynı hareketler öğrenildikçe
   dövüş hızlanıyor ama asla okunamaz hale gelmiyor.
   ========================================================================== */

import { clamp, rand, sign, aabb } from '../core/utils.js';
import { Projectile } from './entities.js';

export const BOSS_MAX_HP = 4;

/* Faza göre hazırlık süresi (saniye) */
const TELEGRAPH_TIME = { 1: 0.95, 2: 0.75, 3: 0.6 };

export class Dragon {
  constructor(cfg, arena) {
    this.x = cfg.spawnX;
    this.y = cfg.spawnY;
    this.w = 150;
    this.h = 96;
    this.vx = 0; this.vy = 0;

    this.arenaMinX = arena.minX;
    this.arenaMaxX = arena.maxX;
    this.groundY = arena.groundY;

    this.hp = BOSS_MAX_HP;
    this.maxHp = BOSS_MAX_HP;
    this.facing = -1;

    this.state = 'entrance';
    this.stateTime = 0;
    this.attackCount = 0;
    this.shotTimer = 0;
    this.shotsLeft = 0;

    this.animTime = 0;
    this.wing = 0;
    this.headBob = 0;
    this.hurtFlash = 0;
    this.invuln = 0;
    this.alive = true;
    this.dying = false;
    this.deathTimer = 0;
    this.defeated = false;

    this.mouthGlow = 0;
    this.hoverTargetX = cfg.spawnX;
    this.hoverTargetY = cfg.spawnY;

    this.roared = false;

    /* --- Hazırlık (telegraph) --- */
    this.nextAttack = null;    // hazırlıktan sonra hangi saldırı gelecek
    this.telegraph = 0;        // 0..1 hazırlığın ilerlemesi (çizim okur)
    this.sweepLaneY = 0;       // süpürmenin geçeceği yükseklik (yer işareti)
    this.wingRaise = 0;        // kanatların açılması (çizim okur)

    /* --- Tepki / iniş --- */
    this.landShock = 0;        // yere çarpma sarsıntısı (çizim okur)
    this.slamCharge = 0;       // çarpma öncesi yükselme (çizim okur)
    this.slamDone = false;     // çarpma yere değdi mi
    this.tiredLanded = false;  // yorgunluk inişi tamamlandı mı
    this.headShake = 0;        // hasar aldığında kafa titremesi
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get phase() {
    if (this.hp > this.maxHp * 0.66) return 1;
    if (this.hp > this.maxHp * 0.33) return 2;
    return 3;
  }
  get vulnerable() { return this.state === 'tired' && !this.dying && this.invuln <= 0; }

  /**
   * Misafirde AI çalışmaz; kanat/animasyon saatleri yerel ilerlemeli.
   * Karar alanları (state, konum, telegraph) anlık görüntüden gelir.
   */
  tickVisuals(dt) {
    this.animTime += dt;
    const wingRate = this.state === 'tired' ? 2
                   : this.state === 'telegraph' ? 11
                   : this.state === 'slam' ? 3.5
                   : 7.5;
    this.wing += dt * wingRate;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.landShock > 0) this.landShock = Math.max(0, this.landShock - dt * 2.4);
    if (this.headShake > 0) this.headShake = Math.max(0, this.headShake - dt * 3);
    this.stateTime += dt;
    const wingTarget = this.state === 'telegraph' ? this.telegraph
                     : this.state === 'sweep' ? 1
                     : this.state === 'tired' ? 0
                     : 0.25;
    this.wingRaise += (wingTarget - this.wingRaise) * Math.min(1, dt * 6);
    if (this.dying) this.deathTimer += dt;
  }

  /** Kafa hitbox'ı — savunmasızken buraya vurulur */
  get headBox() {
    const hw = 58, hh = 50;
    const hx = this.facing > 0 ? this.x + this.w - 44 : this.x - 14;
    return { x: hx, y: this.y + 14 + this.headBob, w: hw, h: hh };
  }

  /** Gövde hitbox'ı — oyuncuya hasar verir */
  get bodyBox() {
    return { x: this.x + 20, y: this.y + 18, w: this.w - 40, h: this.h - 26 };
  }

  /** Hazırlık fazında miyiz? Çizim ve HUD bunu okuyor. */
  get isTelegraphing() { return this.state === 'telegraph'; }

  _setState(s, ctx) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    if (s !== 'telegraph') this.telegraph = 0;
    if (s !== 'fireball' && s !== 'meteor' && s !== 'telegraph') this.mouthGlow = 0;
    if (s !== 'slam') { this.slamDone = false; this.slamCharge = 0; }
    if (s !== 'tired') this.tiredLanded = false;
    if (s === 'tired') {
      this.mouthGlow = 0;
      if (ctx?.audio) ctx.audio.playDragonTired();
    }
  }

  /**
   * Saldırıyı SEÇ ama hemen başlatma — önce hazırlık fazına gir.
   * Oyuncunun tepki verebilmesi için hazırlığın şekli saldırıyı anlatıyor.
   */
  _chooseAttack(ctx) {
    const ph = this.phase;
    const pool = ph === 1 ? ['fireball', 'sweep']
              : ph === 2 ? ['fireball', 'sweep', 'meteor']
              : ['slam', 'meteor', 'sweep', 'fireball', 'slam'];
    this.nextAttack = pool[Math.floor(Math.random() * pool.length)];

    const p = ctx.player;
    this.facing = p.cx > this.cx ? 1 : -1;
    /* Süpürme hattı şimdiden belli: yerdeki işaret bu yükseklikten çiziliyor */
    this.sweepLaneY = this.groundY - 130;

    this._setState('telegraph', ctx);
    if (ctx?.audio) {
      if (this.nextAttack === 'sweep' || this.nextAttack === 'slam') ctx.audio.playWingWhoosh?.();
      else ctx.audio.playScreech?.();
    }
  }

  /** Hazırlık bitti — seçilen saldırıyı gerçekten başlat */
  _launchAttack(ctx) {
    const ph = this.phase;
    const pick = this.nextAttack || 'fireball';
    this._setState(pick, ctx);

    if (pick === 'fireball') {
      this.shotsLeft = ph === 1 ? 3 : ph === 2 ? 4 : 5;
      this.shotTimer = 0.42;
    } else if (pick === 'meteor') {
      this.shotsLeft = ph === 2 ? 7 : 10;
      this.shotTimer = 0.3;
    } else if (pick === 'sweep') {
      const p = ctx.player;
      this.facing = p.cx > this.cx ? 1 : -1;
      this.y = this.sweepLaneY;
      this.vx = this.facing * 430;
      if (ctx?.audio) ctx.audio.playWingWhoosh?.();
    } else if (pick === 'slam') {
      /* Çarpma: oyuncunun tam üstünde asılı kalır, sonra dikine iner */
      this.vy = 0;
      this.slamCharge = 1;
      if (ctx?.audio) ctx.audio.playDragonRoar?.();
    }
    this.nextAttack = null;
  }

  update(dt, ctx) {
    /* Kanat ritmi / flash / iniş sarsıntısı — misafirdeki tickVisuals ile aynı */
    this.tickVisuals(dt);

    if (this.dying) {
      /* deathTimer tickVisuals içinde de artıyor; dying dalında ekstra iş aşağıda */
      this.vy += 900 * dt;
      this.y += this.vy * dt;
      this.x += this.vx * dt;
      this.vx *= 0.97;
      if (this.y + this.h > this.groundY) { this.y = this.groundY - this.h; this.vy = 0; this.vx *= 0.8; }
      if (ctx.particles && Math.random() < 0.7) {
        ctx.particles.spawn({
          x: this.cx + rand(-70, 70), y: this.cy + rand(-40, 40),
          vx: rand(-60, 60), vy: rand(-120, -20),
          life: rand(0.4, 1.0), size: rand(2, 6),
          color: Math.random() < 0.5 ? 'rgba(255,140,40,0.9)' : 'rgba(120,120,130,0.6)',
          glow: 10, gravity: -30
        });
      }
      if (this.deathTimer > 3.2 && !this.defeated) {
        this.defeated = true;
        if (ctx.particles) ctx.particles.hitSpark(this.cx, this.cy, '#ffd76b', 60);
        if (ctx.camera) ctx.camera.addShake(26);
      }
      return;
    }

    const p = ctx.player;
    const ph = this.phase;

    switch (this.state) {
      /* -------- Giriş: kükreme -------- */
      case 'entrance': {
        if (!this.roared) {
          this.roared = true;
          if (ctx.audio) ctx.audio.playDragonRoar();
          if (ctx.camera) ctx.camera.addShake(22);
        }
        this.y += Math.sin(this.animTime * 2) * 12 * dt;
        this.facing = -1;
        this.mouthGlow = clamp(Math.sin(this.stateTime * 3), 0, 1);
        if (ctx.particles && Math.random() < 0.5) {
          const mx = this.x + (this.facing > 0 ? this.w : 0);
          ctx.particles.fireTrail(mx, this.y + 44);
        }
        if (this.stateTime > 2.6) this._setState('hover', ctx);
        break;
      }

      /* -------- Süzülme: oyuncunun üstüne konumlan -------- */
      case 'hover': {
        this.hoverTargetX = clamp(p.cx - this.w / 2 + rand(-40, 40) * dt * 8,
                                  this.arenaMinX + 60, this.arenaMaxX - this.w - 60);
        this.hoverTargetY = 130 + Math.sin(this.animTime * 1.4) * 26;
        const spd = 1.6 + ph * 0.5;
        this.x += (this.hoverTargetX - this.x) * Math.min(1, dt * spd);
        this.y += (this.hoverTargetY - this.y) * Math.min(1, dt * spd);
        this.facing = p.cx > this.cx ? 1 : -1;

        const wait = ph === 1 ? 1.5 : ph === 2 ? 1.1 : 0.8;
        if (this.stateTime > wait) this._chooseAttack(ctx);
        break;
      }

      /* -------- Hazırlık: saldırıyı önceden okut --------
         Her saldırının kendine has bir duruşu var. Oyuncu bu bir saniyede
         ne geleceğini görüp yerini alabiliyor; dövüş ezber değil okuma
         oyununa dönüşüyor. */
      case 'telegraph': {
        const dur = TELEGRAPH_TIME[ph] || 0.8;
        this.telegraph = clamp(this.stateTime / dur, 0, 1);
        this.facing = p.cx > this.cx ? 1 : -1;

        const pick = this.nextAttack;

        if (pick === 'sweep') {
          /* Geriye çekilip yaylanır — sonra fırlayacağı hat yerde işaretli */
          this.x -= this.facing * 90 * dt;
          this.y += (this.sweepLaneY - this.y) * Math.min(1, dt * 3);
          this.mouthGlow = this.telegraph * 0.35;
        } else if (pick === 'fireball') {
          /* Yerinde çakılı kalır, ağzı dolar */
          this.y += Math.sin(this.animTime * 4) * 8 * dt;
          this.mouthGlow = this.telegraph;
        } else if (pick === 'meteor') {
          /* Yükselir: gökten yağmur geleceğinin işareti */
          this.y += (95 - this.y) * Math.min(1, dt * 2.6);
          this.mouthGlow = this.telegraph * 0.8;
        } else if (pick === 'slam') {
          /* Oyuncunun üstüne konumlanıp tepeye tırmanır */
          const tx = clamp(p.cx - this.w / 2, this.arenaMinX + 40, this.arenaMaxX - this.w - 40);
          this.x += (tx - this.x) * Math.min(1, dt * 4);
          this.y += (70 - this.y) * Math.min(1, dt * 3.4);
          this.slamCharge = this.telegraph;
          this.mouthGlow = this.telegraph * 0.5;
        }

        /* Kanat çırpıntısından kalkan toz — hazırlık sesli ve görünür olsun */
        if (ctx.particles && Math.random() < 0.45) {
          ctx.particles.spawn({
            x: this.cx + rand(-80, 80), y: this.cy + rand(-30, 30),
            vx: rand(-90, 90), vy: rand(-40, 40),
            life: 0.35, size: rand(2, 4),
            color: 'rgba(255,150,60,0.5)', glow: 8
          });
        }
        if (this.telegraph >= 1) this._launchAttack(ctx);
        break;
      }

      /* -------- Ateş topu salvosu -------- */
      case 'fireball': {
        this.y += Math.sin(this.animTime * 3) * 20 * dt;
        this.facing = p.cx > this.cx ? 1 : -1;
        this.shotTimer -= dt;
        this.mouthGlow = clamp(1 - this.shotTimer / 0.55, 0, 1);

        if (ctx.particles && this.mouthGlow > 0.6 && Math.random() < 0.5) {
          const mx = this.x + (this.facing > 0 ? this.w - 20 : 20);
          ctx.particles.fireTrail(mx, this.y + 44);
        }

        if (this.shotTimer <= 0 && this.shotsLeft > 0) {
          this.shotsLeft--;
          this.shotTimer = this.phase === 3 ? 0.36 : 0.5;
          const mx = this.x + (this.facing > 0 ? this.w - 16 : 16);
          const my = this.y + 44;
          const a = Math.atan2(p.cy - my, p.cx - mx);
          const spread = (this.shotsLeft % 2 === 0 ? 1 : -1) * (this.phase === 3 ? 0.16 : 0.08);
          const sp = 270 + this.phase * 35;
          ctx.spawnProjectile(new Projectile({
            x: mx, y: my,
            vx: Math.cos(a + spread) * sp,
            vy: Math.sin(a + spread) * sp,
            color: '#ff7a2a', size: 9, life: 4, fromBoss: true, kind: 1
          }));
          if (ctx.audio) ctx.audio.playFireball();
          if (ctx.camera) ctx.camera.addShake(3);
        }
        if (this.shotsLeft <= 0 && this.shotTimer <= -0.4) {
          this.attackCount++;
          /* Her saldırıdan sonra savunmasız pencere — dövüş ritmi okunabilir kalsın */
          this._setState('tired', ctx);
        }
        break;
      }

      /* -------- Süpürme dalışı -------- */
      case 'sweep': {
        this.x += this.vx * dt;
        this.y += Math.sin(this.stateTime * 9) * 34 * dt;
        if (ctx.particles) {
          for (let i = 0; i < 2; i++) {
            ctx.particles.spawn({
              x: this.cx + rand(-60, 60), y: this.cy + rand(-30, 30),
              vx: -this.facing * rand(60, 180), vy: rand(-50, 50),
              life: 0.4, size: rand(2, 5),
              color: 'rgba(255,110,40,0.65)', glow: 10
            });
          }
        }
        const out = this.facing > 0
          ? this.x > this.arenaMaxX - 20
          : this.x + this.w < this.arenaMinX + 20;
        if (out || this.stateTime > 3.5) {
          this.attackCount++;
          this.x = clamp(this.x, this.arenaMinX + 40, this.arenaMaxX - this.w - 40);
          this._setState('tired', ctx);
        }
        break;
      }

      /* -------- Gökten ateş yağmuru -------- */
      case 'meteor': {
        this.hoverTargetY = 90;
        this.y += (this.hoverTargetY - this.y) * Math.min(1, dt * 2.5);
        this.x += Math.sin(this.animTime * 1.1) * 60 * dt;
        this.mouthGlow = 0.9;
        this.shotTimer -= dt;

        if (this.shotTimer <= 0 && this.shotsLeft > 0) {
          this.shotsLeft--;
          this.shotTimer = this.phase === 3 ? 0.24 : 0.32;
          // Oyuncunun etrafına serpiştirilmiş meteorlar
          const tx = clamp(p.cx + rand(-260, 260), this.arenaMinX + 40, this.arenaMaxX - 40);
          ctx.spawnProjectile(new Projectile({
            x: tx, y: this.y - 60,
            vx: rand(-30, 30), vy: 90,
            gravity: 620,
            color: '#ff5a20', size: 8, life: 4.5, fromBoss: true, kind: 2
          }));
          if (ctx.audio && this.shotsLeft % 3 === 0) ctx.audio.playFireball();
        }
        if (this.shotsLeft <= 0 && this.shotTimer <= -0.6) {
          this.attackCount++;
          this._setState('tired', ctx);
        }
        break;
      }

      /* -------- Çarpma dalışı (yalnızca 3. faz) --------
         Dikine iner ve yere vurur. Çarpma anında iki yana giden şok
         dalgası çıkar — zıplamazsan vurur. Kalkanla engellenebilir. */
      case 'slam': {
        this.slamCharge = Math.max(0, this.slamCharge - dt * 3);
        const floor = this.groundY - this.h - 4;

        if (!this.slamDone) {
          this.vy += 2600 * dt;
          this.y += this.vy * dt;
          if (ctx.particles && Math.random() < 0.8) {
            ctx.particles.spawn({
              x: this.cx + rand(-50, 50), y: this.y + rand(-20, 20),
              vx: rand(-40, 40), vy: rand(-160, -60),
              life: 0.3, size: rand(2, 5),
              color: 'rgba(255,170,70,0.7)', glow: 10
            });
          }
          if (this.y >= floor) {
            this.y = floor;
            this.vy = 0;
            this.slamDone = true;
            this.landShock = 1;

            if (ctx.camera) { ctx.camera.addShake(30); ctx.camera.punchZoom(0.07); }
            if (ctx.audio) ctx.audio.playBossHit?.();
            if (ctx.particles) {
              ctx.particles.hitSpark(this.cx, this.groundY - 8, '#ff9a3a', 40);
              for (let i = 0; i < 26; i++) {
                const dir = i % 2 === 0 ? -1 : 1;
                ctx.particles.spawn({
                  x: this.cx + rand(-40, 40), y: this.groundY - 6,
                  vx: dir * rand(160, 460), vy: rand(-220, -40),
                  life: rand(0.4, 0.8), size: rand(2, 5),
                  gravity: 620, drag: 0.94,
                  color: i % 3 === 0 ? 'rgba(255,220,140,0.9)' : 'rgba(150,120,110,0.6)'
                });
              }
            }
            /* İki yana koşan şok dalgası — zıplayarak kaçılır */
            for (const dir of [-1, 1]) {
              ctx.spawnProjectile(new Projectile({
                x: this.cx + dir * 60, y: this.groundY - 16,
                vx: dir * 380, vy: 0,
                color: '#ffb347', size: 10, life: 2.2,
                fromBoss: true, kind: 1, deflectable: false
              }));
            }
          }
        } else if (this.stateTime > 1.15) {
          /* Çarpmadan sonra doğal olarak yorgun kalıyor — bedava vuruş anı */
          this.slamDone = false;
          this.attackCount++;
          this._setState('tired', ctx);
        }
        break;
      }

      /* -------- Yorgun: yere iner, kafa savunmasız --------
         İniş artık yumuşak bir kayma değil: son 20 pikselde hızlanıp yere
         çarpıyor, toz kaldırıyor ve ekranı sarsıyor. "Şimdi vur" anının
         başladığını bedeniyle söylüyor. */
      case 'tired': {
        const targetY = this.groundY - this.h - 4;
        const fallGap = targetY - this.y;
        if (fallGap > 2) {
          /* Serbest düşüşe yakın iniş */
          this.vy = Math.min(760, this.vy + 1500 * dt);
          this.y = Math.min(targetY, this.y + this.vy * dt);
          if (this.y >= targetY && !this.tiredLanded) {
            this.tiredLanded = true;
            this.landShock = 1;
            this.vy = 0;
            if (ctx.camera) ctx.camera.addShake(16);
            if (ctx.particles) {
              for (let i = 0; i < 18; i++) {
                ctx.particles.spawn({
                  x: this.cx + rand(-70, 70), y: this.groundY - 6,
                  vx: rand(-200, 200), vy: rand(-140, -30),
                  life: rand(0.4, 0.8), size: rand(2, 5),
                  gravity: 520, drag: 0.93,
                  color: 'rgba(150,130,120,0.55)'
                });
              }
            }
          }
        } else {
          this.y = targetY;
          this.x += (clamp(p.cx - this.w / 2, this.arenaMinX + 80, this.arenaMaxX - this.w - 80) - this.x) * Math.min(1, dt * 0.8);
        }
        this.facing = p.cx > this.cx ? 1 : -1;
        /* Ağır, düzensiz nefes alma — sabit sinüsten daha canlı */
        this.headBob = Math.sin(this.stateTime * 3.4) * 5 + Math.sin(this.stateTime * 8.1) * 1.6;
        this.mouthGlow = 0;

        if (ctx.particles && Math.random() < 0.35) {
          /* Burnundan çıkan duman */
          const mx = this.x + (this.facing > 0 ? this.w - 10 : 10);
          ctx.particles.spawn({
            x: mx + rand(-8, 8), y: this.y + 44,
            vx: this.facing * rand(20, 70), vy: rand(-24, 4),
            life: 0.9, size: rand(2, 5),
            color: 'rgba(160,150,145,0.42)', drag: 0.96
          });
        }

        const dur = this.phase === 3 ? 2.6 : 3.4;
        if (this.stateTime > dur) {
          this.headBob = 0;
          this.tiredLanded = false;
          this._setState('hover', ctx);
        }
        break;
      }

      /* -------- Hasar tepkisi -------- */
      case 'stagger': {
        /* Geriye savrulup yükselir; ilk yarıda tepki sert, sonra toparlanır */
        const k = clamp(1 - this.stateTime / 0.9, 0, 1);
        this.y -= 150 * k * dt;
        this.x -= this.facing * 130 * k * dt;
        this.headBob = Math.sin(this.stateTime * 30) * 7 * k;
        if (this.stateTime > 0.9) { this.headBob = 0; this._setState('hover', ctx); }
        break;
      }
    }

    this.x = clamp(this.x, this.arenaMinX + 10, this.arenaMaxX - this.w - 10);
    this.y = clamp(this.y, 40, this.groundY - this.h);
  }

  /** Oyuncu kafaya vurdu */
  takeHit(ctx) {
    if (!this.vulnerable) return false;
    this.hp--;
    this.hurtFlash = 0.25;
    this.invuln = 0.6;
    this.headShake = 1;
    this.tiredLanded = false;

    const hb = this.headBox;
    if (ctx.particles) {
      ctx.particles.hitSpark(hb.x + hb.w / 2, hb.y + hb.h / 2, '#ffd76b', 34);
      ctx.particles.enemyDeath(hb.x + hb.w / 2, hb.y + hb.h / 2, '#c41e3a');
    }
    if (ctx.camera) { ctx.camera.addShake(20); ctx.camera.punchZoom(0.06); }
    if (ctx.audio) ctx.audio.playBossHit();

    if (this.hp <= 0) {
      this.dying = true;
      this.deathTimer = 0;
      this.vy = -260;
      this.vx = -this.facing * 120;
      if (ctx.audio) ctx.audio.playDragonDeath();
      if (ctx.camera) ctx.camera.addShake(30);
      return true;
    }
    this._setState('stagger', ctx);
    return true;
  }

  /** Gövdesi oyuncuya değiyor mu? */
  hitsPlayer(p) {
    if (this.dying) return false;
    const b = this.bodyBox;
    return aabb(b.x, b.y, b.w, b.h, p.x, p.y, p.w, p.h);
  }

  /** Herhangi bir kutu ejderhanın zırhlı gövdesine değiyor mu (ok sekmesi için) */
  hitsBox(o) {
    if (this.dying) return false;
    const b = this.bodyBox;
    return aabb(b.x, b.y, b.w, b.h, o.x, o.y, o.w, o.h);
  }
}
