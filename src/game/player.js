/* ==========================================================================
   Player — Şövalye
   Platformer "his" ayarları:
   - İvmeli yatay hareket + havada azaltılmış kontrol
   - Değişken zıplama yüksekliği (erken bırak = alçak zıpla)
   - Coyote time (uçurumdan düşünce hâlâ zıplayabilme)
   - Jump buffer (input.js'te)
   - Apex hang (zıplamanın tepesinde yerçekimi azalır — "havada asılı kalma")
   - Squash & stretch
   - Çift zıplama
   - Kılıç saldırısı + zıplayarak ezme (stomp)
   ========================================================================== */

import { clamp, sign } from '../core/utils.js';

export const PHYS = {
  GRAVITY: 2050,
  FALL_GRAVITY_MULT: 1.35,   // düşerken daha hızlı → daha responsive
  APEX_THRESHOLD: 110,       // |vy| bu değerin altındayken apex bonusu
  APEX_GRAVITY_MULT: 0.55,
  MAX_FALL: 900,

  RUN_SPEED: 330,
  ACCEL_GROUND: 2900,
  ACCEL_AIR: 1900,
  FRICTION_GROUND: 3400,
  FRICTION_AIR: 700,

  JUMP_VEL: -700,
  DOUBLE_JUMP_VEL: -600,
  JUMP_CUT: 0.42,            // zıplama tuşu bırakılınca vy çarpanı
  MIN_JUMP_VEL: -450,        // taban: tuşa hafifçe dokunsan bile bu kadar zıplarsın

  COYOTE: 0.11,
  ATTACK_TIME: 0.28,
  ATTACK_COOLDOWN: 0.34,
  ATTACK_WINDUP: 0.22,       // savurmanın ilk %22'si hazırlık — hitbox kapalı
  ATTACK_LUNGE: 130,         // vuruş anında öne atılma hızı

  /* Kılıç iki vuruşluk zincir. İlk vuruş yukarıdan aşağı, ikincisi aşağıdan
     yukarı savurur. Zincir penceresi kapanırsa baştan başlar. */
  COMBO_WINDOW: 0.42,
  COMBO_REACH_BONUS: 8,

  /* Yay — sınırsız ok, bekleme süresiyle dengelenir.
     Kılıç daha hızlı vurur (0.34s), yay daha yavaş ama uzaktan güvenli. */
  SHOOT_TIME: 0.24,          // gerip bırakma animasyonu
  SHOOT_RELEASE: 0.10,       // bu andan sonra ok fırlar
  SHOOT_COOLDOWN: 0.52,
  ARROW_SPEED: 660,
  ARROW_GRAVITY: 120,        // hafif düşüş
  AIM_ASSIST_ANGLE: 0.92,    // ~53° — nişan yardımının üst sınırı

  INVULN_TIME: 1.35,
  HURT_TIME: 0.32,
  KNOCKBACK_X: 260,
  KNOCKBACK_Y: -340,

  STOMP_BOUNCE: -520,

  /* Ejderha Kalkanı — siper alınca ejderhanın TÜM saldırıları engellenir.
     Bedeli: siperdeyken yavaş yürürsün, zıplayamaz ve saldıramazsın. */
  BLOCK_SPEED_MULT: 0.34,
  BLOCK_RAISE_TIME: 0.14,    // kalkanın tam kalkması
  BLOCK_KNOCKBACK: 130       // engellenen vuruşta geriye kayma
};

export class Player {
  constructor(x, y, opts = {}) {
    /* --- Co-op kimliği --- */
    this.index = opts.index ?? 0;          // 0 = host, 1 = misafir
    this.id = opts.id ?? `p${this.index}`;
    this.name = opts.name || '';
    /* İki karakter aynı görünürse kimin kim olduğu anlaşılmıyor.
       Renk paleti tek ayırt edici işaret. */
    this.palette = opts.palette || (this.index === 0
      ? { cape: '#8e1730', trim: '#d4a853', aura: '212,168,83' }
      : { cape: '#1d5a6e', trim: '#7fd8e8', aura: '127,216,232' });

    this.w = 26;
    this.h = 44;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;

    /* --- Yere serilme (co-op) ---
       Tek başına oynarken ölüm = can kaybı. İki kişiyken ölüm önce
       "yere serilme"ye dönüşüyor: yoldaşın gelip kaldırabilir. Ortak can
       ancak kimse kurtaramazsa eksiliyor. Böylece birinin hatası oyunu
       hemen cezalandırmıyor, iş birliğine dönüşüyor. */
    this.downed = false;
    this.downTimer = 0;        // yerde geçen süre
    this.reviveProgress = 0;   // 0..1 yoldaş ne kadar kaldırdı

    this.facing = 1;
    this.grounded = false;
    this.wasGrounded = false;
    this.coyote = 0;
    this.jumpsLeft = 2;
    this.jumpHeld = false;
    this.onPlatform = null;   // üzerinde durduğu hareketli platform

    this.state = 'idle';      // idle | run | jump | fall | hurt | dead | win
    this.animTime = 0;
    this.runCycle = 0;

    this.squashX = 1;
    this.squashY = 1;

    this.attackTimer = 0;
    this.attackCooldown = 0;
    this.attackHitIds = new Set();
    this.comboStep = 0;        // 0 = inen vuruş, 1 = kalkan vuruş
    this.comboTimer = 0;       // zincir penceresi
    this.attackLunge = 0;      // saldırıda öne kayma (görsel + fizik)

    /* Yay */
    this.shootTimer = 0;      // >0 iken gerip bırakma animasyonu oynuyor
    this.shootCooldown = 0;
    this.arrowFired = false;  // bu atışta ok çıktı mı
    this.pendingArrow = null; // motor bunu okuyup ok yaratır
    this.aimTarget = null;    // motor doldurur — hafif nişan yardımı

    /* Ejderha Kalkanı */
    this.hasShield = false;   // kalkan toplandı mı
    this.blocking = false;    // şu anda siper alınmış mı
    this.blockAmount = 0;     // 0..1 kalkanın kalkma animasyonu
    this.blockFlash = 0;      // engelleme çarpma efekti

    this.invuln = 0;
    /* Yalnızca MİSAFİRDE: öngörülen temas hasarının onay penceresi.
       Bu süre boyunca host henüz hasarı görmediği için gönderdiği sıfır
       değerler tahmini silmiyor (bkz. engine.js, snapshot.js). */
    this.predictHurtCd = 0;
    this.hurtTimer = 0;
    this.dead = false;
    this.deathTimer = 0;

    this.dustTimer = 0;
    this.landImpact = 0;      // görsel iniş şiddeti
    this.skid = 0;            // ters yöne dönüşte fren kayması (0..1)
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get bottom() { return this.y + this.h; }

  /** Yay gerilme miktarı 0..1 (1 = tam gergin). Atış yokken 0. */
  get bowDraw() {
    if (this.shootTimer <= 0) return 0;
    const t = 1 - this.shootTimer / PHYS.SHOOT_TIME;   // 0 → 1 zaman ilerlemesi
    const rel = 1 - PHYS.SHOOT_RELEASE / PHYS.SHOOT_TIME;
    // Bırakmaya kadar ger, sonra hızla gevşe
    return t < rel ? t / rel : Math.max(0, 1 - (t - rel) / (1 - rel)) * 0.35;
  }

  /** Savurmanın 0..1 ilerlemesi. Saldırı yokken -1. */
  get attackProgress() {
    if (this.attackTimer <= 0) return -1;
    return 1 - this.attackTimer / PHYS.ATTACK_TIME;
  }

  /**
   * Aktif saldırı hitbox'ı (yoksa null).
   *
   * Hazırlık karelerinde (ilk %22) hitbox KAPALI. Bu, savurmayı okunabilir
   * yapan şey: kılıç geriye gidiyorken kimse hasar almıyor, darbe gerçekten
   * bıçağın indiği anda düşüyor. Zincirin ikinci vuruşu yukarı savurduğu için
   * kutusu biraz daha uzun ve daha yükseği tarar.
   */
  get attackBox() {
    const t = this.attackProgress;
    if (t < PHYS.ATTACK_WINDUP) return null;

    const up = this.comboStep === 1;
    const reach = 42 + (up ? PHYS.COMBO_REACH_BONUS : 0);
    return {
      x: this.facing > 0 ? this.x + this.w - 6 : this.x - reach + 6,
      y: this.y + (up ? -2 : 6),
      w: reach,
      h: this.h - (up ? 4 : 10)
    };
  }

  reset(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.grounded = false;
    this.coyote = 0;
    this.jumpsLeft = 2;
    this.state = 'idle';
    this.attackTimer = 0;
    this.attackCooldown = 0;
    this.comboStep = 0;
    this.comboTimer = 0;
    this.attackLunge = 0;
    this.skid = 0;
    this.shootTimer = 0;
    this.shootCooldown = 0;
    this.arrowFired = false;
    this.pendingArrow = null;
    this.blocking = false;
    this.blockAmount = 0;
    this.blockFlash = 0;
    this.hurtTimer = 0;
    this.invuln = 1.0;
    this.dead = false;
    this.deathTimer = 0;
    this.squashX = this.squashY = 1;
    this.onPlatform = null;
    this.downed = false;
    this.downTimer = 0;
    this.reviveProgress = 0;
  }

  /** Yere seril — ölmedi ama yoldaşı olmadan kalkamaz */
  goDown(x, y) {
    this.downed = true;
    this.downTimer = 0;
    this.reviveProgress = 0;
    this.dead = false;
    this.state = 'downed';
    this.vx = 0;
    this.vy = 0;
    if (x !== undefined) { this.x = x; this.y = y; }
    this.invuln = 0.6;
  }

  /** Yoldaş kaldırdı */
  reviveNow(particles) {
    this.downed = false;
    this.downTimer = 0;
    this.reviveProgress = 0;
    this.state = 'idle';
    this.invuln = 1.6;
    this.jumpsLeft = 2;
    if (particles) particles.coinBurst(this.cx, this.cy, '#3ddc84');
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead';
    this.deathTimer = 0;
    this.vy = -420;
    this.vx = 0;
  }

  hurt(fromX, particles, camera) {
    if (this.invuln > 0 || this.dead) return false;
    this.invuln = PHYS.INVULN_TIME;
    this.hurtTimer = PHYS.HURT_TIME;
    this.state = 'hurt';
    const dir = sign(this.cx - fromX) || -this.facing;
    this.vx = dir * PHYS.KNOCKBACK_X;
    this.vy = PHYS.KNOCKBACK_Y;
    this.grounded = false;
    if (camera) { camera.addShake(14); camera.punchZoom(0.05); }
    if (particles) particles.hitSpark(this.cx, this.cy, '#ff4060', 22);
    return true;
  }

  /** Siperdeyken bir saldırı engellendi — hasar yok, sadece geri kayma */
  blockHit(fromX, particles, camera) {
    this.blockFlash = 0.22;
    const dir = sign(this.cx - fromX) || -this.facing;
    this.vx = dir * PHYS.BLOCK_KNOCKBACK;
    this.squashX = 1.16; this.squashY = 0.9;
    if (camera) { camera.addShake(9); camera.punchZoom(0.025); }
    if (particles) {
      // Kalkan yüzeyinde sıçrayan kıvılcımlar
      const px = this.cx + this.facing * 14;
      const py = this.cy - 2;
      for (let i = 0; i < 16; i++) {
        const a = (Math.random() - 0.5) * 2.2;
        particles.spawn({
          x: px, y: py,
          vx: -dir * (60 + Math.random() * 220) * Math.cos(a),
          vy: Math.sin(a) * 200 - 40,
          life: 0.32 + Math.random() * 0.2,
          size: 1.6 + Math.random() * 2.2,
          color: i % 3 === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(120,190,255,0.9)',
          glow: 12, gravity: 380, drag: 0.94
        });
      }
      particles.spawn({ x: px, y: py, life: 0.34, size: 12, color: '#8fd0ff', type: 'ring', glow: 18, drag: 1 });
    }
  }

  bounce(power = PHYS.STOMP_BOUNCE) {
    this.vy = power;
    this.grounded = false;
    this.jumpsLeft = Math.max(this.jumpsLeft, 1);
    this.squashX = 0.72; this.squashY = 1.32;
  }

  update(dt, input, level, particles, camera, audio) {
    this.animTime += dt;

    if (this.dead) {
      this.deathTimer += dt;
      this.vy += PHYS.GRAVITY * dt;
      this.y += this.vy * dt;
      this.squashX += (1 - this.squashX) * dt * 8;
      this.squashY += (1 - this.squashY) * dt * 8;
      return;
    }

    /* Yere serilmiş: tuşlara cevap vermez ama yerçekimine tabidir —
       platform kayarsa onunla kayar, havada kaldıysa düşer. Böylece
       yoldaşının ona ulaşabileceği bir yerde durur. */
    if (this.downed) {
      this.downTimer += dt;
      if (this.invuln > 0) this.invuln -= dt;
      this.vx *= 0.86;
      this.vy += PHYS.GRAVITY * dt;
      this._moveAndCollide(dt, level, null);
      this.squashX += (1.25 - this.squashX) * dt * 6;
      this.squashY += (0.72 - this.squashY) * dt * 6;
      this.blocking = false;
      this.blockAmount = 0;
      this.attackTimer = 0;
      this.shootTimer = 0;
      this.state = 'downed';
      return;
    }

    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtTimer > 0) this.hurtTimer -= dt;
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) { this.attackTimer = 0; this.attackHitIds.clear(); }
    }
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.comboStep = 0;
    }
    if (this.attackLunge > 0) this.attackLunge -= dt;

    if (this.blockFlash > 0) this.blockFlash -= dt;

    const controllable = this.hurtTimer <= 0;

    /* ---- Kalkan: siper al ---- */
    // Sadece kalkan toplandıysa, yerdeyken ve başka bir aksiyon yokken
    this.blocking = this.hasShield && controllable && input.blockHeld &&
                    this.grounded && this.attackTimer <= 0 && this.shootTimer <= 0;
    const raiseRate = dt / PHYS.BLOCK_RAISE_TIME;
    this.blockAmount = this.blocking
      ? Math.min(1, this.blockAmount + raiseRate)
      : Math.max(0, this.blockAmount - raiseRate * 1.6);

    /* ---- Yay: gerilmiş oku bırakma anı ---- */
    if (this.shootTimer > 0) {
      const before = this.shootTimer;
      this.shootTimer -= dt;
      const releaseAt = PHYS.SHOOT_TIME - PHYS.SHOOT_RELEASE;
      // Geri sayım releaseAt eşiğini bu karede geçtiyse ok fırlar
      if (!this.arrowFired && before > releaseAt && this.shootTimer <= releaseAt) {
        this.arrowFired = true;

        const ox = this.cx + this.facing * 16;
        const oy = this.y + 20;

        // Nişan yardımı: öndeki hedefe doğru açıyı yumuşakça eğ.
        // Motor her karede this.aimTarget'ı doldurur (yoksa düz atış).
        let ang = 0;
        if (this.aimTarget) {
          const dx = (this.aimTarget.x - ox) * this.facing;   // ileri mesafe
          const dy = this.aimTarget.y - oy;
          if (dx > 20) {
            ang = Math.atan2(dy, dx);
            const lim = PHYS.AIM_ASSIST_ANGLE;
            ang = Math.max(-lim, Math.min(lim, ang));
          }
        }

        this.pendingArrow = {
          x: ox,
          y: oy,
          vx: this.facing * Math.cos(ang) * PHYS.ARROW_SPEED + this.vx * 0.25,
          vy: Math.sin(ang) * PHYS.ARROW_SPEED - 20,
          dir: this.facing,
          gravity: PHYS.ARROW_GRAVITY
        };
        if (audio) audio.playBowRelease();
        if (particles) {
          for (let i = 0; i < 5; i++) {
            particles.spawn({
              x: this.cx + this.facing * 18, y: this.y + 20 + (Math.random() - 0.5) * 6,
              vx: this.facing * (40 + Math.random() * 90), vy: (Math.random() - 0.5) * 60,
              life: 0.16, size: 1.4 + Math.random() * 1.6,
              color: 'rgba(255,225,170,0.9)', glow: 7, drag: 0.88
            });
          }
        }
      }
      if (this.shootTimer <= 0) this.shootTimer = 0;
    }

    /* ---- Saldırı ---- */
    if (controllable && !this.blocking && input.consumeAttack() && this.attackCooldown <= 0 && this.shootTimer <= 0) {
      /* Zincir penceresi hâlâ açıksa ikinci vuruşa geç. İkinci vuruş
         yukarı savurur, biraz daha uzağa uzanır ve daha çabuk toparlanır —
         böylece "vur-vur" ritmi tek tip bir savurmadan daha canlı. */
      const chain = this.comboTimer > 0 && this.comboStep === 0;
      this.comboStep = chain ? 1 : 0;
      this.comboTimer = PHYS.COMBO_WINDOW;

      this.attackTimer = PHYS.ATTACK_TIME;
      this.attackCooldown = chain ? PHYS.ATTACK_COOLDOWN * 0.78 : PHYS.ATTACK_COOLDOWN;
      this.attackHitIds.clear();
      this.attackLunge = PHYS.ATTACK_TIME * 0.45;

      /* Yerdeyken kılıçla birlikte küçük bir adım — vuruşa ağırlık katar */
      if (this.grounded) this.vx += this.facing * PHYS.ATTACK_LUNGE * (chain ? 1.25 : 1);
      this.squashX = chain ? 0.92 : 1.08;
      this.squashY = chain ? 1.08 : 0.94;

      if (audio) audio.playSwing();
      if (particles) {
        const ax = this.facing > 0 ? this.x + this.w + 14 : this.x - 14;
        for (let i = 0; i < 6; i++) {
          particles.spawn({
            x: ax, y: this.y + 16 + Math.random() * 14,
            vx: this.facing * (60 + Math.random() * 120),
            vy: (Math.random() - 0.5) * 90 - (chain ? 80 : 0),
            life: 0.18, size: 1.5 + Math.random() * 2,
            color: 'rgba(230,230,255,0.85)', glow: 8, drag: 0.9
          });
        }
      }
    }

    /* ---- Yay atışı başlat ---- */
    if (controllable && !this.blocking && input.consumeShoot() && this.shootCooldown <= 0 && this.attackTimer <= 0) {
      this.shootTimer = PHYS.SHOOT_TIME;
      this.shootCooldown = PHYS.SHOOT_COOLDOWN;
      this.arrowFired = false;
      if (audio) audio.playBowDraw();
    }

    /* ---- Yatay hareket ---- */
    const axis = controllable ? input.axis : 0;
    const accel = this.grounded ? PHYS.ACCEL_GROUND : PHYS.ACCEL_AIR;
    const friction = this.grounded ? PHYS.FRICTION_GROUND : PHYS.FRICTION_AIR;

    const maxSpeed = PHYS.RUN_SPEED * (this.blocking ? PHYS.BLOCK_SPEED_MULT : 1);

    if (axis !== 0) {
      this.facing = axis;
      const target = axis * maxSpeed;
      // ters yöne dönerken daha çabuk tepki
      const reversing = sign(this.vx) !== 0 && sign(this.vx) !== axis;
      const rate = reversing ? accel * 1.9 : accel;
      this.vx += sign(target - this.vx) * rate * dt;
      /* Saldırı atılımı hız tavanını geçici olarak aşabilir; yoksa tuşa
         basılı tutan oyuncuda kılıç adımı hiç görünmez. */
      if (Math.abs(this.vx) > maxSpeed && this.attackLunge <= 0) this.vx = target;

      /* Fren kayması: yerde tam ters yöne dönerken ayaklar kayar */
      const wantSkid = reversing && this.grounded && Math.abs(this.vx) > PHYS.RUN_SPEED * 0.45;
      this.skid = wantSkid ? Math.min(1, this.skid + dt * 9) : Math.max(0, this.skid - dt * 7);
      if (wantSkid && particles) {
        this.dustTimer -= dt;
        if (this.dustTimer <= 0) {
          this.dustTimer = 0.04;
          particles.runDust(this.cx + this.facing * 6, this.bottom - 2, -this.facing);
        }
      }
    } else {
      this.skid = Math.max(0, this.skid - dt * 7);
      const drop = friction * dt;
      if (Math.abs(this.vx) <= drop) this.vx = 0;
      else this.vx -= sign(this.vx) * drop;
    }

    /* ---- Zıplama ---- */
    if (this.grounded) {
      this.coyote = PHYS.COYOTE;
      this.jumpsLeft = 2;
    } else if (this.coyote > 0) {
      this.coyote -= dt;
    }

    if (controllable && !this.blocking && input.consumeJump()) {
      if (this.grounded || this.coyote > 0) {
        this.vy = PHYS.JUMP_VEL;
        this.grounded = false;
        this.coyote = 0;
        this.jumpsLeft = 1;
        this.squashX = 0.74; this.squashY = 1.3;
        if (particles) particles.jumpPuff(this.cx, this.bottom);
        if (audio) audio.playJump();
      } else if (this.jumpsLeft > 0) {
        this.vy = PHYS.DOUBLE_JUMP_VEL;
        this.jumpsLeft = 0;
        this.squashX = 0.8; this.squashY = 1.24;
        if (particles) {
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            particles.spawn({
              x: this.cx + Math.cos(a) * 12, y: this.bottom - 6 + Math.sin(a) * 6,
              vx: Math.cos(a) * 80, vy: Math.sin(a) * 40 + 20,
              life: 0.3, size: 2, color: 'rgba(212,168,83,0.7)', glow: 8, drag: 0.9
            });
          }
        }
        if (audio) audio.playDoubleJump();
      }
    }

    // Değişken zıplama: tuş bırakılınca yükselişi kes.
    // Ama MIN_JUMP_VEL tabanının altına inmez — tuşa dokunmak bile
    // uçurumu geçmeye yetecek bir sıçrama verir (affedici his).
    if (!input.jumpHeld && this.vy < PHYS.MIN_JUMP_VEL) {
      this.vy = Math.max(PHYS.MIN_JUMP_VEL, this.vy * Math.pow(PHYS.JUMP_CUT, dt * 60));
    }

    /* ---- Yerçekimi (apex hang + fast fall) ---- */
    let g = PHYS.GRAVITY;
    if (Math.abs(this.vy) < PHYS.APEX_THRESHOLD && !this.grounded) g *= PHYS.APEX_GRAVITY_MULT;
    if (this.vy > 0) g *= PHYS.FALL_GRAVITY_MULT;
    this.vy = Math.min(PHYS.MAX_FALL, this.vy + g * dt);

    /* ---- Hareket + çarpışma ---- */
    this.wasGrounded = this.grounded;
    this._moveAndCollide(dt, level, input);

    /* ---- İniş / kalkış efektleri ---- */
    if (!this.wasGrounded && this.grounded) {
      const power = clamp(this.landImpact / 700, 0.25, 1.4);
      this.squashX = 1 + 0.34 * power;
      this.squashY = 1 - 0.3 * power;
      if (particles) particles.landDust(this.cx, this.bottom, power);
      if (camera && power > 0.7) camera.addShake(4 * power);
      if (audio && power > 0.4) audio.playLand(power);
    }

    /* ---- Koşu tozu ---- */
    if (this.grounded && Math.abs(this.vx) > 120) {
      this.dustTimer -= dt;
      if (this.dustTimer <= 0) {
        this.dustTimer = 0.06;
        if (particles) particles.runDust(this.cx - this.facing * 8, this.bottom - 2, this.facing);
      }
    }

    /* ---- Squash & stretch geri dönüş ---- */
    this.squashX += (1 - this.squashX) * Math.min(1, dt * 13);
    this.squashY += (1 - this.squashY) * Math.min(1, dt * 13);

    /* ---- Durum ---- */
    if (this.hurtTimer > 0) this.state = 'hurt';
    else if (this.blocking) this.state = 'block';
    else if (!this.grounded) this.state = this.vy < 0 ? 'jump' : 'fall';
    else if (Math.abs(this.vx) > 20) this.state = 'run';
    else this.state = 'idle';

    if (this.state === 'run') this.runCycle += dt * (Math.abs(this.vx) / PHYS.RUN_SPEED) * 13;
    else this.runCycle = 0;
  }

  /* ========================================================================
     Yalnızca görsel güncelleme — misafirin ekranındaki YOLDAŞ için

     Misafirde yoldaşın fiziği çalışmaz; konumu host'tan gelir. Ama eskiden
     `update()` hiç çağrılmadığı için animTime, runCycle ve squash da hiç
     ilerlemiyordu: yoldaş donmuş bacaklarla kayarak geziyor, kılıç savurduğu
     hiç görünmüyordu. Burada fiziğe DOKUNMADAN sadece animasyon saatlerini
     ilerletiyoruz. Konum yine host'un dediği yer.
     ======================================================================== */
  updateVisuals(dt, particles) {
    this.animTime += dt;

    const decay = (v) => (v > 0 ? Math.max(0, v - dt) : 0);
    this.attackTimer = decay(this.attackTimer);
    this.shootTimer = decay(this.shootTimer);
    this.comboTimer = decay(this.comboTimer);
    this.attackLunge = decay(this.attackLunge);
    this.hurtTimer = decay(this.hurtTimer);
    this.blockFlash = decay(this.blockFlash);
    if (this.comboTimer <= 0) this.comboStep = 0;

    if (this.dead) {
      this.deathTimer += dt;
      this.squashX += (1 - this.squashX) * Math.min(1, dt * 8);
      this.squashY += (1 - this.squashY) * Math.min(1, dt * 8);
      return;
    }

    if (this.downed) {
      this.downTimer += dt;
      this.squashX += (1.25 - this.squashX) * Math.min(1, dt * 6);
      this.squashY += (0.72 - this.squashY) * Math.min(1, dt * 6);
      return;
    }

    /* Koşu döngüsü hızdan türetiliyor — host'tan gelen vx yeter */
    const speed = Math.abs(this.vx);
    if (this.state === 'run' || (speed > 20 && this.state === 'idle')) {
      this.runCycle += dt * (speed / PHYS.RUN_SPEED) * 13;
      this.dustTimer -= dt;
      if (speed > 120 && this.dustTimer <= 0 && particles) {
        this.dustTimer = 0.06;
        particles.runDust(this.cx - this.facing * 8, this.bottom - 2, this.facing);
      }
    } else {
      this.runCycle = 0;
    }

    /* İniş tozu: havadan yere geçişi durum değişiminden yakala */
    const airborne = this.state === 'jump' || this.state === 'fall';
    if (this._wasAirVisual && !airborne && particles) {
      particles.landDust(this.cx, this.bottom, 0.7);
      this.squashX = 1.2; this.squashY = 0.82;
    }
    this._wasAirVisual = airborne;

    /* Skid ters yön tahmininden türetilir ki misafir tarafında fren
       kayması da görünsün. blockAmount snapshot'tan geliyor. */
    this.blocking = this.state === 'block';
    const reverseGuess = this.state === 'run' && Math.abs(this.vx) > 40
      && Math.sign(this.vx) !== Math.sign(this.facing || 1);
    this.skid = reverseGuess
      ? Math.min(1, this.skid + dt * 8)
      : Math.max(0, this.skid - dt * 7);
    this.squashX += (1 - this.squashX) * Math.min(1, dt * 13);
    this.squashY += (1 - this.squashY) * Math.min(1, dt * 13);
  }

  _moveAndCollide(dt, level, input) {
    const solids = level.solids;
    const oneWays = level.oneWays;

    // Hareketli platform ile birlikte taşın
    if (this.onPlatform && this.grounded) {
      this.x += this.onPlatform.dx;
      this.y += this.onPlatform.dy;
    }

    /* --- X ekseni --- */
    this.x += this.vx * dt;
    for (const s of solids) {
      if (!this._overlaps(s)) continue;
      if (this.vx > 0) this.x = s.x - this.w;
      else if (this.vx < 0) this.x = s.x + s.w;
      this.vx = 0;
    }

    // Bölüm sınırları
    if (this.x < level.minX) { this.x = level.minX; this.vx = 0; }
    if (this.x + this.w > level.maxX) { this.x = level.maxX - this.w; this.vx = 0; }

    /* --- Y ekseni --- */
    const prevBottom = this.y + this.h;
    this.landImpact = this.vy;
    this.y += this.vy * dt;
    this.grounded = false;
    this.onPlatform = null;

    for (const s of solids) {
      if (!this._overlaps(s)) continue;
      if (this.vy > 0) {
        this.y = s.y - this.h;
        this.grounded = true;
        if (s.moving) this.onPlatform = s;
      } else if (this.vy < 0) {
        this.y = s.y + s.h;
      }
      this.vy = 0;
    }

    // Tek yönlü platformlar: sadece yukarıdan düşerken tut.
    // Aşağı tuşu basılıysa aşağı düş (drop-through).
    if (this.vy >= 0 && !(input && input.down)) {
      for (const s of oneWays) {
        if (!this._overlaps(s)) continue;
        if (prevBottom <= s.y + 2) {
          this.y = s.y - this.h;
          this.vy = 0;
          this.grounded = true;
          if (s.moving) this.onPlatform = s;
        }
      }
    }
  }

  _overlaps(s) {
    return this.x < s.x + s.w && this.x + this.w > s.x &&
           this.y < s.y + s.h && this.y + this.h > s.y;
  }
}
