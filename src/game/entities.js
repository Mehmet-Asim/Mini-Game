/* ==========================================================================
   Varlıklar — düşmanlar, tehlikeler, toplanabilirler, hareketli platformlar
   ========================================================================== */

import { clamp, rand, sign, aabb } from '../core/utils.js';

let _id = 0;
const nextId = () => ++_id;

/* ==========================================================================
   Temel sınıf
   ========================================================================== */
class Entity {
  constructor(x, y, w, h) {
    this.id = nextId();
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.alive = true;
    this.removeTimer = -1;
    this.animTime = rand(0, 10);
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  overlapsPlayer(p) { return aabb(this.x, this.y, this.w, this.h, p.x, p.y, p.w, p.h); }

  /* ------------------------------------------------------------------------
     Yalnızca animasyon saatlerini ilerlet — misafir tarafı için.

     Misafirde düşman yapay zekâsı ÇALIŞMAZ; konumlar host'tan gelir. Ama
     `update()` hiç çağrılmadığı için animasyon saatleri de duruyordu:
     kurtlar bacakları kıpırdamadan kayıyor, yarasaların kanatları donuk
     kalıyor ve ölen düşmanlar animasyonu hiç oynamadan tek karede yok
     oluyordu. Burada yalnızca GÖRSEL alanlar ilerletiliyor, hiçbir karar
     verilmiyor — iki ekran ayrışmıyor.
     ------------------------------------------------------------------------ */
  tickVisuals(dt, particles) {
    this.animTime += dt;
    if (this.wing !== undefined) {
      this.wing += dt * (this.diving ? 26 : (this.windup > 0 ? 34 : 14));
    }
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.dying) {
      if (this.deathTimer === 0 && particles) {
        particles.enemyDeath(this.cx, this.cy, this.deathColor || '#8a3050');
      }
      this.deathTimer += dt;
      /* `predictedDead`: misafir KENDİ okunun isabetini host onaylamadan
         önce oynatıyor (bkz. engine.js → _predictArrowHits). Ölüm
         animasyonu hemen başlasın diye `dying` işaretleniyor, ama nesne
         listeden DÜŞÜRÜLMÜYOR: host "hâlâ yaşıyor" derse geri alınabilmesi
         gerek. Onay gelince bayrak kalkar ve normal akış nesneyi siler
         (bkz. snapshot.js → applySnapshot). */
      if (this.deathTimer > 0.35 && !this.predictedDead) this.alive = false;
    }
  }

  /** Misafirin tahmini isabeti — host onaylayana kadar geri alınabilir */
  markPredictedDead(particles) {
    if (this.dying || this.predictedDead) return false;
    this.dying = true;
    this.deathTimer = 0;
    this.predictedDead = true;
    this.hurtFlash = 0.12;
    if (particles) particles.enemyDeath(this.cx, this.cy, this.deathColor || '#8a3050');
    return true;
  }

  /** Host "yaşıyor" dedi — tahmini ölümü geri al */
  revivePredicted() {
    if (!this.predictedDead) return;
    this.predictedDead = false;
    this.dying = false;
    this.deathTimer = 0;
  }
}

/* ==========================================================================
   Hareketli Platform
   ========================================================================== */
export class MovingPlatform extends Entity {
  constructor(cfg) {
    super(cfg.x, cfg.y, cfg.w || 110, cfg.h || 18);
    this.moving = true;
    this.startX = cfg.x; this.startY = cfg.y;
    this.rangeX = cfg.rangeX || 0;
    this.rangeY = cfg.rangeY || 0;
    this.speed = cfg.speed || 1;
    this.phase = cfg.phase || 0;
    this.dx = 0; this.dy = 0;
    this.oneWay = cfg.oneWay || false;
  }
  update(dt) {
    this.animTime += dt;
    const t = this.animTime * this.speed + this.phase;
    const nx = this.startX + Math.sin(t) * this.rangeX;
    const ny = this.startY + Math.sin(t) * this.rangeY;
    this.dx = nx - this.x;
    this.dy = ny - this.y;
    this.x = nx; this.y = ny;
  }
}

/* ==========================================================================
   CO-OP MEKANİZMALARI

   Tasarım kuralı: her mekanizma TEK OYUNCUYLA GEÇİLEMEZ olmalı, ama
   zamanlama hassasiyeti DÜŞÜK olmalı. Sebebi ağ gecikmesi — misafirin
   tuşları host'a ~50-150 ms sonra ulaşıyor. "Aynı anda bas" isteyen bir
   bulmaca internet üzerinden sinir bozucu olurdu. Bu yüzden her şey
   "basılı tut" mantığıyla çalışıyor, kimse milisaniye yakalamıyor.
   ========================================================================== */

/**
 * Basınç Plakası
 * Üstünde biri durdukça aktif. `latch: true` ise bir kez basılınca kilitlenir
 * (tek yönlü şalter — geri dönülmeyen geçitler için).
 */
export class Plate extends Entity {
  constructor(cfg) {
    super(cfg.x, cfg.y, cfg.w || 56, cfg.h || 12);
    this.key = cfg.id;
    this.latch = !!cfg.latch;
    this.active = false;
    this.locked = false;
    this.amount = 0;            // 0..1 görsel basılma
    this.holders = 0;           // üstünde kaç oyuncu var
    this.justChanged = false;
  }

  evaluate(players, dt) {
    this.holders = 0;
    for (const p of players) {
      if (p.dead) continue;
      /* Ayak hizası plakanın üstünde mi? Yandan değmek saymaz. */
      const feet = p.y + p.h;
      if (p.x + p.w > this.x + 3 && p.x < this.x + this.w - 3 &&
          feet >= this.y - 6 && feet <= this.y + this.h + 8) {
        this.holders++;
      }
    }
    const wasActive = this.active;
    const pressed = this.holders > 0;
    this.active = this.locked || pressed;
    if (this.latch && pressed) this.locked = true;

    const target = this.active ? 1 : 0;
    this.amount += (target - this.amount) * Math.min(1, dt * 12);
    this.justChanged = wasActive !== this.active;
    return this.active;
  }
}

/**
 * Kapı
 * `needs` içindeki TÜM anahtarlar aktifken açılır. Açılırken katı olmaktan
 * çıkar. Kapanırken oyuncuyu ezmemesi için kademeli kapanır.
 */
export class Gate extends Entity {
  constructor(cfg) {
    super(cfg.x, cfg.y, cfg.w || 22, cfg.h || 120);
    this.needs = Array.isArray(cfg.needs) ? cfg.needs : [cfg.needs];
    this.baseY = cfg.y;
    this.open = 0;              // 0 kapalı, 1 tamamen açık
    this.speed = cfg.speed || 2.2;
    this.label = cfg.label || '';
    /* Bir kez tam açılınca AÇIK KALIR (varsayılan).
       Aksi halde klasik tuzak: ikisi plakalara basıp kapıyı açıyor, geçmek
       için plakadan iniyorlar, kapı kapanıyor. Çözülemez bir bulmaca.
       Bu bir hediye oyunu — bulmaca bir kez çözülür ve orada kalır. */
    this.once = cfg.once !== false;
    this.latched = false;
  }

  /** Açıkken katı değil — çarpışma listesine bu bayrakla giriyor */
  get solid() { return this.open < 0.82; }

  /** Çarpışma kutusu: kapı yukarı çekildikçe küçülür */
  get collisionBox() {
    const h = this.h * (1 - this.open);
    return { x: this.x, y: this.baseY + this.h - h, w: this.w, h };
  }

  update(dt, keys) {
    const want = this.latched || this.needs.every(k => keys.get(k));
    const target = want ? 1 : 0;
    this.open += (target - this.open) * Math.min(1, dt * this.speed);
    if (Math.abs(this.open - target) < 0.01) this.open = target;
    if (this.once && this.open > 0.97) this.latched = true;
    this.animTime += dt;
  }
}

/**
 * Ortak Asansör
 * Sadece GEREKEN SAYIDA oyuncu üstündeyken yükselir. Biri inerse yavaşça
 * geri iner — böylece "sen bin ben iteyim" işe yaramaz, ikisi de binmeli.
 */
export class CoopLift extends Entity {
  constructor(cfg) {
    super(cfg.x, cfg.y, cfg.w || 120, cfg.h || 18);
    this.moving = true;
    this.baseY = cfg.y;
    this.topY = cfg.y - (cfg.rise || 150);
    this.speed = cfg.speed || 62;
    this.needAll = cfg.needAll !== false;
    this.riders = 0;
    this.dx = 0; this.dy = 0;
  }

  evaluate(players) {
    this.riders = 0;
    for (const p of players) {
      if (p.dead) continue;
      const feet = p.y + p.h;
      if (p.x + p.w > this.x + 4 && p.x < this.x + this.w - 4 &&
          feet >= this.y - 8 && feet <= this.y + this.h + 10) {
        this.riders++;
      }
    }
    return this.riders;
  }

  update(dt, needed) {
    const ready = this.needAll ? this.riders >= needed : this.riders > 0;
    const targetY = ready ? this.topY : this.baseY;
    const dir = Math.sign(targetY - this.y);
    /* İnerken daha yavaş: kimse yukarıda mahsur kalmasın */
    const spd = this.speed * (dir < 0 ? 1 : 0.55);
    const step = spd * dt;
    const ny = Math.abs(targetY - this.y) <= step ? targetY : this.y + dir * step;
    this.dy = ny - this.y;
    this.dx = 0;
    this.y = ny;
    this.animTime += dt;
  }
}

/* ==========================================================================
   Düşen Platform — üzerine basınca titreyip düşer, sonra geri gelir
   ========================================================================== */
export class CrumblePlatform extends Entity {
  constructor(cfg) {
    super(cfg.x, cfg.y, cfg.w || 90, cfg.h || 16);
    this.moving = false;
    this.startY = cfg.y;
    this.phase = 'idle';   // idle | shake | fall | gone | respawn
    this.timer = 0;
    this.vy = 0;
    this.solid = true;
    this.shakeOff = 0;
  }
  trigger() {
    if (this.phase === 'idle') { this.phase = 'shake'; this.timer = 0.45; }
  }
  update(dt) {
    switch (this.phase) {
      case 'shake':
        this.timer -= dt;
        this.shakeOff = Math.sin(this.animTime * 60) * 2.5;
        this.animTime += dt;
        if (this.timer <= 0) { this.phase = 'fall'; this.vy = 0; this.solid = false; this.shakeOff = 0; }
        break;
      case 'fall':
        this.vy += 1400 * dt;
        this.y += this.vy * dt;
        if (this.y > this.startY + 500) { this.phase = 'gone'; this.timer = 1.6; }
        break;
      case 'gone':
        this.timer -= dt;
        if (this.timer <= 0) { this.phase = 'respawn'; this.timer = 0.4; this.y = this.startY; }
        break;
      case 'respawn':
        this.timer -= dt;
        if (this.timer <= 0) { this.phase = 'idle'; this.solid = true; }
        break;
    }
  }
  get opacity() {
    if (this.phase === 'gone') return 0;
    if (this.phase === 'respawn') return 1 - this.timer / 0.4;
    return 1;
  }
}

/* ==========================================================================
   Diken / Tehlike
   ========================================================================== */
export class Spike extends Entity {
  constructor(cfg) {
    super(cfg.x, cfg.y, cfg.w || 32, cfg.h || 18);
    this.count = Math.max(1, Math.round(this.w / 16));
    this.instant = cfg.instant || false;
  }
  update() {}
  hitsPlayer(p) {
    // Sadece dikenlerin üst kısmıyla çarpışsın (adil hitbox)
    return aabb(this.x + 3, this.y + this.h * 0.4, this.w - 6, this.h * 0.6, p.x, p.y, p.w, p.h);
  }
}

/* ==========================================================================
   Devriye Düşmanı — "Gölge Kurdu"

   Kenardan düşmez, duvarda döner. Üstüne basılınca ölür.

   ATAK DÖNGÜSÜ: çök → sıçra → toparlan.
   Eskiden kurt yalnızca hızlanıp üstüne geliyordu; oyuncunun yapabileceği
   tek şey geri kaçmaktı çünkü okunacak bir hazırlık hareketi yoktu.
   Çökme anı "şimdi kaçın ya da vurun" demenin görsel yolu; toparlanma anı
   da doğru zamanlamayı ödüllendiren açık bir pencere.
   ========================================================================== */
const WOLF_WINDUP = 0.34;             // çökme süresi — okunacak kadar uzun
const WOLF_LEAP = 0.42;               // havada geçen süre
export const WOLF_RECOVER = 0.32;     // iniş sonrası savunmasız pencere
const WOLF_LEAP_RANGE = 130;          // bu mesafede sıçramaya karar verir

export class Walker extends Entity {
  constructor(cfg) {
    super(cfg.x, cfg.y, 38, 32);
    this.type = 'walker';
    this.speed = cfg.speed || 62;
    this.dir = cfg.dir || 1;
    this.minX = cfg.minX ?? cfg.x - 130;
    this.maxX = cfg.maxX ?? cfg.x + 130;
    this.groundY = cfg.y;
    this.hp = 1;
    this.hurtFlash = 0;
    this.dying = false;
    this.deathTimer = 0;
    this.stompable = true;
    this.damage = 1;
    this.aggro = 0;
    this.deathColor = '#6b2a45';

    /* windup: 0→1 çökme ilerlemesi, leap: 0→1 sıçrama ilerlemesi.
       recover > 0 iken kurt yerinde nefeslenir. */
    this.windup = 0;
    this.leap = 0;
    this.recover = 0;
    this.attackCooldown = rand(0.4, 1.2);
    this.leapVX = 0;
    this.hop = 0;               // görsel + hitbox yükselmesi
  }

  get attacking() { return this.leap > 0; }

  update(dt, ctx) {
    this.animTime += dt;
    if (this.dying) { this.deathTimer += dt; if (this.deathTimer > 0.35) this.alive = false; return; }
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const p = ctx.player;
    const distX = p.cx - this.cx;
    const sameLevel = Math.abs(p.cy - this.cy) < 70;
    const sees = sameLevel && Math.abs(distX) < 260 && !p.dead;

    if (sees) {
      this.aggro = Math.min(1, this.aggro + dt * 2.5);
      /* Sıçrama sırasında yön kilitli: havada dönüş yapan bir düşmandan
         kaçmanın yolu yok, o yüzden karar bir kez veriliyor. */
      if (this.leap <= 0 && this.windup <= 0) this.dir = sign(distX) || this.dir;
    } else {
      this.aggro = Math.max(0, this.aggro - dt * 1.5);
    }

    /* ---- Toparlanma: kısa, savunmasız, hareketsiz ---- */
    if (this.recover > 0) {
      this.recover -= dt;
      this.hop = 0;
      this.y = this.groundY;
      return;
    }

    /* ---- Çökme ---- */
    if (this.windup > 0) {
      this.windup += dt / WOLF_WINDUP;
      /* Çökerken hafifçe GERİ çekilir — yay gerilir gibi */
      this.x -= this.dir * 26 * dt;
      this.hop = 0;
      this.y = this.groundY;
      if (this.windup >= 1) {
        this.windup = 0;
        this.leap = 0.0001;
        this.leapVX = this.dir * 330;
        if (ctx.particles) ctx.particles.runDust(this.cx, this.groundY + this.h, -this.dir);
      }
      this._clampPatrol();
      return;
    }

    /* ---- Sıçrama ---- */
    if (this.leap > 0) {
      this.leap += dt / WOLF_LEAP;
      this.x += this.leapVX * dt;
      this.leapVX *= 0.985;
      /* Yarım sinüs: temiz bir yay, iniş anı belli */
      this.hop = Math.sin(Math.min(1, this.leap) * Math.PI) * 30;
      this.y = this.groundY - this.hop;
      if (this.leap >= 1) {
        this.leap = 0;
        this.hop = 0;
        this.y = this.groundY;
        this.recover = WOLF_RECOVER;
        this.attackCooldown = rand(1.3, 2.0);
        if (ctx.particles) ctx.particles.landDust(this.cx, this.groundY + this.h, 0.8);
      }
      this._clampPatrol();
      return;
    }

    /* ---- Sıçramaya karar ---- */
    /* Yakın mesafede de sıçrayabilmesi lazım: eski alt sınır (26 px) yüzünden
       oyuncuya yapışan kurt hiç saldırmıyor, sadece üstünde titriyordu. */
    if (sees && this.attackCooldown <= 0 && this.aggro > 0.55 &&
        Math.abs(distX) < WOLF_LEAP_RANGE) {
      this.windup = 0.0001;
      if (ctx.audio) ctx.audio.playGrowl();
      return;
    }

    /* ---- Devriye / kovalama ---- */
    const spd = this.speed * (1 + this.aggro * 1.1);
    this.x += this.dir * spd * dt;
    this.y = this.groundY;
    this._clampPatrol();
  }

  _clampPatrol() {
    if (this.x < this.minX) { this.x = this.minX; this.dir = 1; this.leapVX = Math.abs(this.leapVX); }
    if (this.x + this.w > this.maxX) { this.x = this.maxX - this.w; this.dir = -1; this.leapVX = -Math.abs(this.leapVX); }
  }

  takeHit(particles) {
    if (this.dying) return false;
    this.hp--;
    this.hurtFlash = 0.12;
    /* Vurulan kurt hazırlığını iptal eder: oyuncunun zamanlaması işe yaramalı */
    this.windup = 0;
    if (this.hp <= 0) {
      this.dying = true;
      if (particles) particles.enemyDeath(this.cx, this.cy, '#6b2a45');
      return true;
    }
    return false;
  }
}

/* ==========================================================================
   Uçan Düşman — "Gece Yarasası"

   Sinüs dalgasıyla süzülür, oyuncu yaklaşınca dalış yapar.

   İKİ ESKİ SORUN GİDERİLDİ:

   1. DALIŞ UYARISIZDI. 175 px'e girildiği anda saniyede 300 px'le geliyordu;
      kaçmak için insan tepki süresinden kısa bir vakit kalıyordu. Artık önce
      geri çekilip titriyor (windup), sonra dalıyor.

   2. DALIŞ BİTİNCE IŞINLANIYORDU. Süzülme konumu `baseX + sin(animTime)`
      formülüyle hesaplanıyor ama `animTime` dalış boyunca da işliyordu;
      dalış bitince sinüs rastgele bir fazdaydı ve yarasa tek karede
      150 px'e kadar atlıyordu. Artık yörüngeye YUMUŞAKÇA dönüyor ve
      yörünge saati yalnızca süzülürken ilerliyor.
   ========================================================================== */
const BAT_WINDUP = 0.38;
export const BAT_DIVE = 1.2;
/* Dönüş SABİT HIZLA yapılıyor, sabit sürede değil: "0.6 saniyede yörüngeye
   dön" demek uzaktan dönerken kare başına 20 pikselden fazla atlamak
   demekti — teknik olarak interpolasyon, gözle ışınlanma. */
const BAT_RETURN_SPEED = 420;
const BAT_RETURN_LIMIT = 3;

export class Flyer extends Entity {
  constructor(cfg) {
    super(cfg.x, cfg.y, 34, 26);
    this.type = 'flyer';
    this.amp = cfg.amp || 46;
    this.speed = cfg.speed || 1.6;
    this.rangeX = cfg.rangeX || 150;
    this.hp = 1;
    this.dying = false;
    this.deathTimer = 0;
    this.hurtFlash = 0;
    this.stompable = true;
    this.damage = 1;
    this.deathColor = '#4a2668';
    this.diving = false;
    this.diveTimer = 0;
    this.windup = 0;
    this.returning = false;
    this.returnTime = 0;
    this.cooldown = 0;
    this.vx = 0; this.vy = 0;
    this.wing = 0;

    /* Yörünge saati yalnızca süzülürken ilerler. Faz rastgele ki bütün
       yarasalar aynı anda aynı yerde olmasın — ama yuva noktası bu faza
       göre GERİ hesaplanıyor, böylece yörünge doğduğu noktadan geçiyor.
       Aksi halde yarasa ilk karede sinüsün rastgele fazına, yani 150 px'e
       kadar uzağa ışınlanıyordu. Yuva sabit: her dalıştan sonra
       kaydırılsaydı yarasa bölüm boyunca sürüklenirdi. */
    this.orbitT = rand(0, Math.PI * 2);
    const t0 = this.orbitT * this.speed;
    this.homeX = cfg.x - Math.sin(t0) * this.rangeX;
    this.homeY = cfg.y - Math.sin(t0 * 2.1) * this.amp;
  }

  get attacking() { return this.diving; }

  /** Süzülme yörüngesinin o anki noktası (sol-üst köşe) */
  _orbit() {
    const t = this.orbitT * this.speed;
    return {
      x: this.homeX + Math.sin(t) * this.rangeX,
      y: this.homeY + Math.sin(t * 2.1) * this.amp
    };
  }

  update(dt, ctx) {
    this.animTime += dt;
    this.wing += dt * (this.diving ? 26 : (this.windup > 0 ? 34 : 14));
    if (this.dying) { this.deathTimer += dt; if (this.deathTimer > 0.35) this.alive = false; return; }
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.cooldown > 0) this.cooldown -= dt;

    const p = ctx.player;
    const dx = p.cx - this.cx;
    const dy = p.cy - this.cy;
    const dist = Math.hypot(dx, dy);

    /* ---- Dalışa hazırlık: geri çekilip titrer ---- */
    if (this.windup > 0) {
      this.windup += dt / BAT_WINDUP;
      /* Hedeften uzaklaşarak gerilir; titreme çizimde okunuyor */
      const back = Math.atan2(dy, dx) + Math.PI;
      this.x += Math.cos(back) * 34 * dt;
      this.y += Math.sin(back) * 34 * dt;
      if (this.windup >= 1) {
        this.windup = 0;
        this.diving = true;
        this.diveTimer = BAT_DIVE;
        /* Hedef, hazırlık BİTTİĞİNDE nişanlanır: oyuncu kaçtıysa ıskalar */
        const a = Math.atan2(p.cy - this.cy, p.cx - this.cx);
        this.vx = Math.cos(a) * 320;
        this.vy = Math.sin(a) * 320;
        if (ctx.audio) ctx.audio.playScreech();
      }
      return;
    }

    /* ---- Dalış ---- */
    if (this.diving) {
      this.diveTimer -= dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= 0.985; this.vy *= 0.985;
      if (ctx.particles && Math.random() < 0.4) {
        ctx.particles.spawn({
          x: this.cx, y: this.cy, vx: rand(-20, 20), vy: rand(-20, 20),
          life: 0.3, size: 2, color: 'rgba(90,40,120,0.5)'
        });
      }
      if (this.diveTimer <= 0) {
        this.diving = false;
        this.returning = true;
        this.returnTime = 0;
        this.cooldown = rand(0.9, 1.6);
      }
      return;
    }

    /* ---- Yörüngeye dönüş: ışınlanma yerine süzülerek ---- */
    this.orbitT += dt;
    const o = this._orbit();
    if (this.returning) {
      this.returnTime += dt;
      const step = BAT_RETURN_SPEED * dt;
      const ox = o.x - this.x, oy = o.y - this.y;
      const d = Math.hypot(ox, oy);
      if (d <= step) {
        this.x = o.x; this.y = o.y;
        this.returning = false;
      } else if (this.returnTime > BAT_RETURN_LIMIT) {
        /* Yetişemediyse (yörünge hızlı kaydı) yuvayı BULUNDUĞU yere göre
           yeniden hesapla — sıçramadan devam etsin. */
        const t = this.orbitT * this.speed;
        this.homeX = this.x - Math.sin(t) * this.rangeX;
        this.homeY = this.y - Math.sin(t * 2.1) * this.amp;
        this.returning = false;
      } else {
        this.x += (ox / d) * step;
        this.y += (oy / d) * step;
      }
      return;
    }
    this.x = o.x;
    this.y = o.y;

    /* ---- Dalışa karar ---- */
    if (dist < 175 && this.cooldown <= 0 && !p.dead) {
      this.windup = 0.0001;
      if (ctx.audio) ctx.audio.playBatFlutter();
    }
  }

  takeHit(particles) {
    if (this.dying) return false;
    this.dying = true;
    if (particles) particles.enemyDeath(this.cx, this.cy, '#4a2668');
    return true;
  }
}

/* ==========================================================================
   Nişancı — "Kara Büyücü"
   Sabit durur, oyuncuya büyü mermisi atar.
   ========================================================================== */
export class Caster extends Entity {
  constructor(cfg) {
    super(cfg.x, cfg.y, 32, 48);
    this.type = 'caster';
    this.cooldown = rand(0.6, 1.6);
    this.interval = cfg.interval || 2.1;
    this.range = cfg.range || 460;
    this.hp = 2;
    this.dying = false;
    this.deathTimer = 0;
    this.hurtFlash = 0;
    this.stompable = true;
    this.damage = 1;
    this.charging = 0;
    this.recoil = 0;              // atıştan sonra asanın geri tepmesi
    this.facing = cfg.dir || -1;
    this.deathColor = '#5a2a8a';
  }

  /** Asa kristalinin dünya koordinatı — mermi buradan çıkar */
  get staffTip() {
    return { x: this.cx + this.facing * 15, y: this.y + this.h - 49 };
  }

  update(dt, ctx) {
    this.animTime += dt;
    if (this.dying) { this.deathTimer += dt; if (this.deathTimer > 0.35) this.alive = false; return; }
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.recoil > 0) this.recoil -= dt;

    const p = ctx.player;
    const dx = p.cx - this.cx;
    if (Math.abs(dx) < this.range && !p.dead) {
      this.facing = sign(dx) || this.facing;
      this.cooldown -= dt;
      /* Şarj penceresi 0.85 sn: kristal büyürken oyuncu siperini kaldırabiliyor.
         Eskiden 0.6 sn'ydi ve mobilde tepki vermeye yetmiyordu. */
      this.charging = clamp(1 - this.cooldown / 0.85, 0, 1);
      if (this.cooldown <= 0) {
        this.cooldown = this.interval;
        this.charging = 0;
        this.recoil = 0.28;
        /* Mermi ASADAN çıkıyor; eskiden göğüs hizasından çıkıp havadan
           doğuyormuş gibi görünüyordu. */
        const tip = this.staffTip;
        const a = Math.atan2(p.cy - tip.y, p.cx - tip.x);
        ctx.spawnProjectile(new Projectile({
          x: tip.x, y: tip.y,
          vx: Math.cos(a) * 250, vy: Math.sin(a) * 250,
          color: '#a76bff', size: 7, life: 3.5, kind: 0
        }));
        if (ctx.particles) ctx.particles.hitSpark(tip.x, tip.y, '#c78bff', 8);
        if (ctx.audio) ctx.audio.playCast();
      }
    } else {
      this.charging = 0;
    }
  }
  takeHit(particles) {
    if (this.dying) return false;
    this.hp--;
    this.hurtFlash = 0.14;
    /* Vurulan büyücünün şarjı bozulur — saldırıyı kesmek ödüllendirilir */
    this.charging = 0;
    this.cooldown = Math.max(this.cooldown, 0.7);
    if (particles) particles.hitSpark(this.cx, this.cy, '#a76bff', 12);
    if (this.hp <= 0) {
      this.dying = true;
      if (particles) particles.enemyDeath(this.cx, this.cy, '#5a2a8a');
      return true;
    }
    return false;
  }
}

/* ==========================================================================
   Mermi
   ========================================================================== */
export class Projectile extends Entity {
  constructor(cfg) {
    super(cfg.x - (cfg.size || 6), cfg.y - (cfg.size || 6), (cfg.size || 6) * 2, (cfg.size || 6) * 2);
    this.vx = cfg.vx; this.vy = cfg.vy;
    this.color = cfg.color || '#a76bff';
    this.size = cfg.size || 6;
    this.life = cfg.life || 3;
    this.gravity = cfg.gravity || 0;
    this.damage = cfg.damage || 1;
    this.fromBoss = cfg.fromBoss || false;
    this.deflectable = cfg.deflectable !== false;
    /* Tür kodu ağ üzerinden geçer; misafir boyut ve rengi bundan kuruyor.
       Bkz. net/snapshot.js → PROJECTILE_KINDS */
    this.kind = cfg.kind ?? 0;
  }
  update(dt, ctx) {
    this.animTime += dt;
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (ctx.particles) {
      ctx.particles.spawn({
        x: this.cx, y: this.cy,
        vx: rand(-18, 18), vy: rand(-18, 18),
        life: 0.28, size: this.size * 0.45,
        color: this.color, glow: 8, drag: 0.9
      });
    }
    // Duvara çarparsa yok ol
    for (const s of ctx.level.solids) {
      if (aabb(this.x, this.y, this.w, this.h, s.x, s.y, s.w, s.h)) {
        this.alive = false;
        if (ctx.particles) ctx.particles.hitSpark(this.cx, this.cy, this.color, 10);
        return;
      }
    }
  }
  /** Kılıçla sektirme */
  deflect(dirX) {
    this.vx = Math.abs(this.vx || 260) * dirX * 1.5 + dirX * 120;
    this.vy *= 0.3;
    this.fromBoss = false;
    this.deflected = true;
    this.color = '#ffd76b';
    this.life = 2.4;
  }
}

/* ==========================================================================
   Ok — oyuncunun yayından çıkar
   Düz uçar, hafifçe düşer, ilk isabette saplanır.
   ========================================================================== */
export class Arrow extends Entity {
  constructor(cfg) {
    super(cfg.x - 9, cfg.y - 3, 18, 6);
    this.vx = cfg.vx;
    this.vy = cfg.vy || 0;
    this.dir = cfg.dir || sign(cfg.vx) || 1;
    this.gravity = cfg.gravity ?? 190;
    this.damage = cfg.damage || 1;
    this.life = cfg.life || 2.2;
    this.angle = Math.atan2(this.vy, this.vx);
    this.stuck = false;       // bir yüzeye saplandı
    this.stuckTimer = 0;
    this.hitIds = new Set();
  }

  update(dt, ctx) {
    this.animTime += dt;

    // Saplandıysa kısa süre görünür kalıp kaybol
    if (this.stuck) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.9) this.alive = false;
      return;
    }

    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }

    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle = Math.atan2(this.vy, this.vx);

    // İz
    if (ctx.particles && Math.random() < 0.65) {
      ctx.particles.spawn({
        x: this.cx - this.dir * 8, y: this.cy,
        vx: rand(-14, 14), vy: rand(-14, 14),
        life: 0.22, size: 1.5,
        color: 'rgba(255,226,160,0.55)', glow: 6, drag: 0.9
      });
    }

    // Bölüm sınırı
    if (this.x < ctx.level.minX - 60 || this.x > ctx.level.maxX + 60 || this.y > ctx.level.deathY) {
      this.alive = false;
      return;
    }

    // Zemine/duvara saplan
    for (const s of ctx.level.solids) {
      if (aabb(this.x, this.y, this.w, this.h, s.x, s.y, s.w, s.h)) {
        this.stuck = true;
        this.vx = this.vy = 0;
        if (ctx.particles) ctx.particles.hitSpark(this.cx, this.cy, '#e8c88a', 7);
        if (ctx.audio) ctx.audio.playArrowHitWall();
        return;
      }
    }
  }

  /** Hedefe saplandı — oku tüket */
  consume(particles) {
    this.alive = false;
    if (particles) particles.hitSpark(this.cx, this.cy, '#ffe2a0', 14);
  }
}

/* ==========================================================================
   Toplanabilir Kalp
   ========================================================================== */
export class Heart extends Entity {
  constructor(cfg) {
    super(cfg.x - 11, cfg.y - 11, 22, 22);
    this.collected = false;
    this.pop = 0;
    this.big = cfg.big || false;   // hikaye parçası kalbi
    this.storyIndex = cfg.storyIndex ?? -1;
  }
  update(dt) { this.animTime += dt; if (this.pop > 0) this.pop -= dt; }
  get bob() { return Math.sin(this.animTime * 2.6) * 5; }
}

/* ==========================================================================
   Can Kutusu (kaybedilen canı geri verir)
   ========================================================================== */
export class LifeOrb extends Entity {
  constructor(cfg) {
    super(cfg.x - 13, cfg.y - 13, 26, 26);
    this.collected = false;
  }
  update(dt) { this.animTime += dt; }
  get bob() { return Math.sin(this.animTime * 2) * 6; }
}

/* ==========================================================================
   Ejderha Kalkanı — arena girişinde duran efsanevi kalkan
   Alındığında oyuncu siper alabilir ve ejderhanın tüm saldırılarını engeller.
   ========================================================================== */
export class ShieldPickup extends Entity {
  constructor(cfg) {
    super(cfg.x - 20, cfg.y - 74, 40, 52);
    this.collected = false;
    this.groundY = cfg.y;
  }
  update(dt) { this.animTime += dt; }
  get bob() { return Math.sin(this.animTime * 1.8) * 6; }
  get spin() { return Math.sin(this.animTime * 0.9) * 0.16; }
}

/* ==========================================================================
   Checkpoint — meşale
   ========================================================================== */
export class Checkpoint extends Entity {
  constructor(cfg) {
    super(cfg.x - 12, cfg.y - 64, 24, 64);
    this.activated = false;
    this.activateTime = 0;
  }
  update(dt) { this.animTime += dt; if (this.activated) this.activateTime += dt; }
  activate() {
    if (this.activated) return false;
    this.activated = true;
    return true;
  }
  get spawnX() { return this.cx - 13; }
  get spawnY() { return this.y + this.h - 44; }
}

/* ==========================================================================
   Bölüm Sonu Geçidi
   ========================================================================== */
export class Portal extends Entity {
  constructor(cfg) {
    super(cfg.x - 34, cfg.y - 96, 68, 96);
    this.open = cfg.open !== false;
    this.openAmount = this.open ? 1 : 0;
    // Tetikleme alanı çizilen kemerden çok daha cömert:
    // oyuncu üstünden zıplayarak geçse bile geçit tetiklenir.
    this.trigger = {
      x: cfg.x - 62, y: cfg.y - 300,
      w: 124, h: 306
    };
  }
  update(dt) {
    this.animTime += dt;
    const target = this.open ? 1 : 0;
    this.openAmount += (target - this.openAmount) * Math.min(1, dt * 2.5);
  }
  /** Cömert tetikleme kutusu */
  triggersPlayer(p) {
    const t = this.trigger;
    return aabb(t.x, t.y, t.w, t.h, p.x, p.y, p.w, p.h);
  }
}
