/* ==========================================================================
   Oyun Motoru
   Sabit adımlı güncelleme + hit-stop + durum makinesi
   ========================================================================== */

import { Input, RemoteInput } from '../core/input.js';
import { Camera } from '../core/camera.js';
import { Particles } from '../core/particles.js';
import { clamp, aabb } from '../core/utils.js';
import { Renderer } from '../render/renderer.js';
import { Player } from './player.js';
import { Dragon, BOSS_MAX_HP } from './boss.js';
import { LEVELS, buildLevel, GROUND_Y, DEATH_Y } from './levels.js';
import {
  MovingPlatform, CrumblePlatform, Spike, Walker, Flyer, Caster,
  Heart, LifeOrb, Checkpoint, Portal, Arrow, ShieldPickup,
  Plate, Gate, CoopLift
} from './entities.js';

const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;
const START_LIVES = 3;

/* Co-op sabitleri */
const REVIVE_RANGE = 46;      // yoldaşın kaldırmak için ne kadar yaklaşması gerek
const REVIVE_TIME = 1.15;     // kaç saniye yanında durmalı
const DOWN_TIMEOUT = 14;      // kimse gelmezse ortak candan düşer
const SPAWN_GAP = 46;         // iki oyuncunun başlangıç aralığı

export class GameEngine {
  constructor(container, callbacks, opts = {}) {
    this.container = container;
    this.cb = callbacks;   // { onHud, onLevelComplete, onGameComplete, onStory, onToast, onDeath, onBossStart, onPause }

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    container.appendChild(this.canvas);

    this.renderer = new Renderer(this.canvas);
    this.particles = new Particles();
    this.camera = new Camera(800, 500);

    /* --------------------------------------------------------------------
       Oyuncular

       mode:
         'solo'    → tek oyuncu (eski davranış, hiç değişmedi)
         'local'   → aynı klavyede iki oyuncu (bölüm tasarımını test etmek için)
         'net'     → 2. oyuncu ağdan (host bu modda simülasyonu yürütür)

       Tek oyunculu oyun bozulmasın diye players dizisi tek elemanla da
       çalışıyor; tüm döngüler eleman sayısından bağımsız.
       -------------------------------------------------------------------- */
    this.mode = opts.mode || 'solo';
    const count = this.mode === 'solo' ? 1 : 2;
    const names = opts.names || [];

    /* Hangi oyuncu bu tarayıcıdaki insana ait.
       Host için 0, misafir için 1. Klavye HER ZAMAN bu karaktere bağlanır —
       ilk sürümde klavye sabit olarak 0. oyuncuya bağlanıyordu ve misafir
       kendi karakterini oynatamıyordu. */
    this.localIndex = opts.localIndex ?? 0;

    this.players = [];
    this.inputs = [];
    for (let i = 0; i < count; i++) {
      this.players.push(new Player(0, 0, { index: i, name: names[i] || '' }));

      if (this.mode === 'local') {
        /* Aynı klavyede iki kişi: birinci WASD+JKL, ikinci yön tuşları */
        this.inputs.push(new Input(i === 0 ? 'primary' : 'arrows'));
      } else if (i === this.localIndex) {
        this.inputs.push(new Input('primary'));
      } else {
        this.inputs.push(new RemoteInput());
      }
    }

    /* --------------------------------------------------------------------
       Ağ rolü

         null    → tek makine (solo ya da local co-op). Her şeyi bu motor karar verir.
         'host'  → yetkili simülasyon. Dünyayı bu yürütür, anlık görüntü yayınlar.
         'guest' → izleyici + tahminci. Düşman/boss/mermi YAPAY ZEKÂSI ÇALIŞMAZ;
                   onların konumu host'tan gelir. Yalnızca KENDİ karakterinin
                   fiziğini yürütür (client-side prediction) ki tuşlar anında
                   cevap versin.

       Misafirin dünyayı da simüle etmesi denenebilirdi ama iki tarayıcı
       arasında kayan noktalı fizik asla birebir aynı kalmaz; birkaç saniyede
       düşmanlar iki ekranda farklı yerlere gider. Bu yüzden tek yetkili var.
       -------------------------------------------------------------------- */
    this.netMode = opts.netMode || null;

    /* Bu adımda girdisi gelmediği için simüle edilmeyecek oyuncular */
    this._frozen = new Set();

    this.lives = START_LIVES;
    this.maxLives = START_LIVES;
    this.hearts = 0;
    this.totalHearts = 0;
    this.storyUnlocked = [];

    this.levelIndex = 0;
    this.level = null;
    this.entities = this._emptyEntities();
    this.boss = null;
    this.bossStarted = false;

    this.state = 'idle';      // idle | playing | dying | respawning | levelDone | gameDone | paused
    this.stateTimer = 0;
    this.hitStop = 0;
    this.running = false;
    this.rafId = null;
    this.lastTime = 0;
    this.accumulator = 0;
    this.audio = null;

    this.spawnPoint = { x: 0, y: 0 };
    this.tips = [];

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._resize();
  }

  setAudio(audio) { this.audio = audio; }

  /* ---------- Oyuncu yardımcıları ----------
     `player` ve `input` eski tek oyunculu koda dokunmadan çalışsın diye
     takma ad olarak duruyor (renderer, boss AI, HUD hepsi bunları kullanıyordu). */
  get player() { return this.players[this.localIndex] || this.players[0]; }
  get input()  { return this.inputs[this.localIndex] || this.inputs[0]; }

  /** Oynayabilir durumdaki oyuncular (yere serilmiş ve ölü olanlar hariç) */
  get activePlayers() {
    return this.players.filter(p => !p.dead && !p.downed);
  }

  /** Sahnede duran, kameranın kapsaması gereken oyuncular */
  get visiblePlayers() {
    return this.players.filter(p => !p.dead);
  }

  /** Verilen noktaya en yakın oynayabilir oyuncu — düşman ve boss hedeflemesi */
  _nearestPlayer(x, y = null) {
    let best = null, bestD = Infinity;
    for (const p of this.players) {
      if (p.dead) continue;
      /* Yere serilmiş oyuncu hedef olarak SON tercih: düşmanlar yerdeki
         oyuncuyu döverek kurtarmayı imkânsız hale getirmesin */
      const penalty = p.downed ? 1e6 : 0;
      const d = Math.abs(p.cx - x) + (y === null ? 0 : Math.abs(p.cy - y) * 0.6) + penalty;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best || this.players[0];
  }

  _emptyEntities() {
    return {
      enemies: [], hearts: [], lifeOrbs: [], checkpoints: [],
      movingPlatforms: [], crumbles: [], spikes: [], projectiles: [], arrows: [],
      plates: [], gates: [], coopLifts: [],
      shieldPickup: null, portal: null
    };
  }

  _resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(320, r.width);
    const h = Math.max(240, r.height);
    this.renderer.resize(w, h);
    this.camera.resize(w, h);
  }

  /* ======================================================================
     Bölüm yükleme
     ====================================================================== */
  loadLevel(idx) {
    this.levelIndex = idx;
    this._levelDoneFired = false;
    /* Kaçıncı yükleme olduğunu sayıyoruz. Anlık görüntüyle giden bu sayı,
       misafirin "host bölümü baştan yükledi mi?" sorusuna tek yetkili
       cevabı. Toplanan kalpler ağda yalnızca "toplandı" yönünde
       taşınıyor; baştan yükleme bilgisi gitmezse misafir kalpsiz bir
       bölümde dolaşıyordu. */
    this.loadSerial = (this.loadSerial || 0) + 1;
    /* Misafir kendi yüklemelerini de sayar (bölüm geçiş perdesi sonunda
       host'la aynı anda yüklüyor). İki sayaç aynı hızda ilerlediği için
       yalnızca GERÇEK bir fark — host'un tek taraflı baştan yüklemesi —
       misafirde yeniden yükleme tetikler. */
    if (this.netMode === 'guest') this._netLoadSerial = (this._netLoadSerial || 0) + 1;
    const def = LEVELS[idx];
    this.level = buildLevel(def);
    this.renderer.setTheme(def.theme);
    this.particles.clear();

    const e = this._emptyEntities();

    for (const m of (def.moving || [])) e.movingPlatforms.push(new MovingPlatform(m));
    for (const c of (def.crumble || [])) e.crumbles.push(new CrumblePlatform(c));
    for (const s of (def.spikes || [])) e.spikes.push(new Spike(s));

    /* --- Co-op mekanizmaları ---
       Tek oyunculu modda bunlar YÜKLENMEZ; onun yerine kapılar açık kabul
       edilir. Aynı bölüm dosyası hem tek hem çift kişilik oynanabilsin diye. */
    if (this.players.length > 1) {
      for (const pl of (def.plates || [])) e.plates.push(new Plate(pl));
      for (const g of (def.gates || [])) e.gates.push(new Gate(g));
      for (const l of (def.coopLifts || [])) e.coopLifts.push(new CoopLift(l));
    }

    for (const en of (def.enemies || [])) {
      if (en.type === 'walker') e.enemies.push(new Walker(en));
      else if (en.type === 'flyer') e.enemies.push(new Flyer(en));
      else if (en.type === 'caster') e.enemies.push(new Caster(en));
    }

    for (const [hx, hy] of (def.hearts || [])) e.hearts.push(new Heart({ x: hx, y: hy }));
    for (const sh of (def.storyHearts || [])) {
      e.hearts.push(new Heart({ x: sh.x, y: sh.y, big: true, storyIndex: sh.index }));
    }
    for (const o of (def.lifeOrbs || [])) e.lifeOrbs.push(new LifeOrb(o));
    for (const c of (def.checkpoints || [])) e.checkpoints.push(new Checkpoint(c));

    if (def.shield) e.shieldPickup = new ShieldPickup(def.shield);

    e.portal = new Portal({ x: def.portal.x, y: def.portal.y, open: !def.boss });

    this.entities = e;
    this.totalHearts = e.hearts.length;

    this.tips = (def.tips || []).map(t => ({ ...t, y: GROUND_Y - 130, alpha: 0 }));

    this.boss = null;
    this.bossStarted = false;

    this.spawnPoint = { x: def.startX, y: def.startY };
    this._resetPlayersToSpawn(def.startX, def.startY);
    // Kalkan bölüme özgü — bölüm baştan başlarsa yeniden toplanmalı
    for (const p of this.players) p.hasShield = false;

    this.camera.setBounds(0, def.width, -260, DEATH_Y + 100);
    this.camera.snapTo(this.player.cx, this.player.cy, 1);

    this.state = 'playing';
    this.stateTimer = 0;
    this.hitStop = 0;

    if (this.cb.onToast) this.cb.onToast(def.intro, 3400);
    this._emitHud();
  }

  /** Oyuncuları doğuş noktasına yay — üst üste binmesinler */
  _resetPlayersToSpawn(x, y) {
    this.players.forEach((p, i) => {
      /* Ortadan simetrik dağıt: [0] sola, [1] sağa */
      const offset = this.players.length === 1
        ? 0
        : (i - (this.players.length - 1) / 2) * SPAWN_GAP;
      p.reset(x + offset, y);
    });
  }

  start(idx = 0) {
    this.lives = START_LIVES;
    this.hearts = 0;
    this.storyUnlocked = [];
    this.loadLevel(idx);
    this._startLoop();
  }

  _startLoop() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    const loop = (now) => {
      if (!this.running) return;
      let frameTime = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (frameTime > 0.25) frameTime = 0.25;   // sekme değişimi koruması

      /* Ağ katmanı buraya giriyor: misafir, fizik adımından ÖNCE gelen
         anlık görüntüyü uygular. Sonra uygularsa kendi tahmini bir kare
         boyunca eski veriyle çarpışır. */
      if (this.cb.onFrame) this.cb.onFrame(frameTime);

      this.accumulator += frameTime;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
        this._step(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_STEPS) this.accumulator = 0;

      this.renderer.render(this._renderState(), frameTime);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /* --------------------------------------------------------------------
     Duraklatmanın SAHİBİ var: 'local' | 'net'

     Neden: host bir hatıra kartı açtığında ya da duraklat menüsüne
     bastığında dünya durur ve misafir de durmalıdır. Ama misafir kendi
     duraklat menüsünü açtığında, host'tan gelen "ben oynuyorum" bilgisi
     onun menüsünü kapatmamalıdır.

     Sahip ayrımı olmadan şu oluyordu: host duraklatıyor → misafir de
     duruyor → host devam ediyor → misafir SONSUZA DEK duruyor, çünkü
     ağdan gelen durum yalnızca "paused değilsen uygula" diye korunuyordu
     ve misafir tam da paused'daydı. Oyuncunun "2. oyuncu oyunda değil
     gibi" dediği kilit buydu.
     -------------------------------------------------------------------- */
  pause(source = 'local') {
    if (this.state === 'paused' || !this.running) return;
    this._prevState = this.state;
    this.pausedBy = source;
    this.state = 'paused';
    for (const inp of this.inputs) inp.reset();
    /* Karşı tarafa haber ver. Bunun MOTORDA olması bilinçli: duraklatmayı
       tetikleyen üç ayrı yer var (menü, hatıra kartı, yoldaş düştü) ve
       bildirimi çağrı yerlerine bırakınca biri unutuluyor. */
    this.onHalt?.(true, source);
  }

  /** @param source 'net' ise oyuncunun KENDİ açtığı menüyü kapatmaz */
  resume(source = 'local') {
    if (this.state !== 'paused') return;
    if (source === 'net' && this.pausedBy === 'local') return;
    this.pausedBy = null;
    this.state = this._prevState || 'playing';
    this.lastTime = performance.now();
    this.accumulator = 0;
    /* Bekleyen AĞ girdilerini at — hepsi duraklamadan öncesine ait.
       Sekme arka plandayken kuyruk doluyor; işlemek karaktere geçmişi
       yeniden oynatır. */
    for (const inp of this.inputs) inp.flush?.();
    this.onHalt?.(false, source);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    for (const inp of this.inputs) inp.destroy();
    window.removeEventListener('resize', this._onResize);
  }

  _renderState() {
    return {
      cam: this.camera,
      level: this.level,
      player: this.player,
      players: this.players,
      localIndex: this.localIndex,
      entities: this.entities,
      particles: this.particles,
      boss: this.boss,
      theme: this.level ? this.level.theme : 'forest',
      tips: this.tips,
      hitStop: this.hitStop,
      lives: this.lives
    };
  }

  _ctx() {
    return {
      /* Varlıklar `ctx.player`'ı hedef olarak okuyor. İki oyunculu oyunda
         bunu her varlık güncellenmeden önce EN YAKIN oyuncuya çeviriyoruz,
         böylece düşman AI'ı hiç değişmeden iki hedefle çalışıyor. */
      player: this.player,
      players: this.players,
      level: this.level,
      particles: this.particles,
      camera: this.camera,
      audio: this.audio,
      spawnProjectile: (p) => this.entities.projectiles.push(p)
    };
  }

  /* ======================================================================
     Ana adım
     ====================================================================== */
  _step(dt) {
    if (this.state === 'paused') return;

    if (this.inputs[this.localIndex].consumePause() && this.cb.onPause) {
      this.cb.onPause();
      return;
    }

    for (let i = 0; i < this.inputs.length; i++) {
      const inp = this.inputs[i];
      inp.update(dt);

      /* Ağ girdisi: adım başına TAM BİR TANE tüket.
         Böylece "N girdi işlendi" durumu iki tarafta da aynı simülasyon
         anına denk gelir ve uzlaştırma birebir çalışır. Gelir gelmez
         uygulasaydık ağ dalgalanması bir karede iki girdi işletir, adım
         sayısı girdi sayısından geri kalır ve sahte sapma doğardı. */
      if (inp.consumeTick) {
        const p = this.players[i];
        /* Onay konumu FİZİKTEN ÖNCE alınır — misafir de kaydını fizikten
           önce alıyor, iki ölçüm aynı ana ait olsun diye. */
        const consumed = inp.consumeTick();
        if (consumed && p) {
          this._frozen.delete(i);
          this.remoteAck = { seq: consumed.seq, x: Math.round(p.x), y: Math.round(p.y) };
        } else {
          /* GİRDİ YOK → BU OYUNCUYU BU ADIMDA SİMÜLE ETME.
             Son tuşu tutup fizik işletmek, host'a misafirin atmadığı fazladan
             bir kare attırıyor. Tek başına önemsiz görünüyor ama her açlıkta
             bir kare birikiyor ve saniyeler içinde iki dünya ayrışıyor
             (ölçümde 130px'e kadar çıktı). Dondurmak, karşı karakteri bir
             kare oynatmamak demek — misafirin interpolasyon tamponu bunu
             zaten yutuyor. */
          this._frozen.add(i);
        }
      }

      /* Ağ girdisi bayatladıysa tuşları bırak — bağlantı koptuğunda
         karakter duvara doğru koşmaya devam etmesin */
      inp.checkStale?.();
    }

    /* --------------------------------------------------------------------
       Girdi yayını SİMÜLASYON ADIMINA kilitli.

       Önceden ayrı bir 30 Hz zamanlayıcı vardı ve misafir kendi karakterini
       CANLI klavyeyle tahmin ederken host'a ÖRNEKLENMİŞ hâlini yolluyordu.
       İki taraf farklı girdi sinyali işlediği için her yön değişiminde
       gerçek bir sapma doğuyor, uzlaştırma da onu geri çekiyordu — oyuncuya
       "lastikli" hissi veren şey buydu.

       Artık her sabit adımda bir paket gidiyor: host'un işlediği sinyal,
       misafirin simüle ettiği sinyalin birebir aynısı.
       -------------------------------------------------------------------- */
    if (this.cb.onInputTick) this.cb.onInputTick(this.inputs[this.localIndex]);

    this.camera.update(dt);

    // Hit-stop: kısa donma (vuruş hissi)
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.particles.update(dt * 0.25);
      return;
    }

    switch (this.state) {
      case 'playing': this._stepPlaying(dt); break;
      case 'dying': this._stepDying(dt); break;
      case 'respawning': this._stepRespawning(dt); break;
      case 'levelDone': this._stepLevelDone(dt); break;
      case 'gameDone': this._stepGameDone(dt); break;
    }

    this.particles.update(dt);
  }

  _stepPlaying(dt) {
    const ctx = this._ctx();
    const e = this.entities;
    const guest = this.netMode === 'guest';

    /* --- Hareketli/çöken platformları çarpışma listesine ekle ---
       Misafirde bunların konumu anlık görüntüden geliyor; yerel olarak
       ilerletmek iki ekranda kayma yaratır. */
    if (!guest) {
      for (const mp of e.movingPlatforms) mp.update(dt);
      for (const cp of e.crumbles) cp.update(dt);
      this._updateCoop(dt);
    }

    this._rebuildSolids();

    /* --- Oyuncular --- */
    for (let i = 0; i < this.players.length; i++) {
      /* Misafir yalnızca KENDİ karakterini simüle eder. Yoldaşının konumu
         host'tan gelir ve applySnapshot ile yazılır — ama animasyon saatleri
         yine yerel dönmeli, yoksa yoldaş donmuş bacaklarla kayar. */
      if (guest && i !== this.localIndex) {
        this.players[i].updateVisuals(dt, this.particles);
        continue;
      }
      /* Ağ girdisi gelmediyse bu oyuncu bu adımda DONDURULUR (bkz. _step).
         Fiziği işletmek, host'a misafirin atmadığı fazladan bir kare
         attırıp iki dünyayı kalıcı olarak ayırıyordu. Görsel saatler
         yine dönüyor ki karakter taş gibi kalmasın. */
      if (this._frozen.has(i)) {
        this.players[i].updateVisuals(dt, this.particles);
        continue;
      }
      const p = this.players[i];

      /* Nişan yardımı hedefi (yay için) — oyuncu başına ayrı */
      p.aimTarget = this._findAimTarget(p);

      p.update(dt, this.inputs[i], this.level, this.particles, this.camera, this.audio);

      /* Yaydan çıkan ok — hangi oyuncunun attığını işaretliyoruz ki
         kendi okun sana zarar vermesin ve isabet sesi doğru çalsın */
      if (p.pendingArrow) {
        const arrow = new Arrow(p.pendingArrow);
        arrow.ownerIndex = i;
        e.arrows.push(arrow);
        p.pendingArrow = null;
        this.camera.addShake(3);
      }

      /* Çöken platform tetikleme */
      for (const cp of e.crumbles) {
        if (cp.phase !== 'idle' || !cp.solid) continue;
        if (p.bottom >= cp.y - 2 && p.bottom <= cp.y + 10 &&
            p.x + p.w > cp.x && p.x < cp.x + cp.w) {
          cp.trigger();
          if (this.audio) this.audio.playCrumble();
        }
      }
    }

    /* ====================================================================
       MİSAFİR BURADA DURUR

       Aşağıdaki her şey "dünyanın ne yaptığı" ile ilgili: düşman kararları,
       hasar, toplama, ölüm, bölüm sonu. Bunların tek bir yerde karara
       bağlanması şart, yoksa iki tarayıcı farklı sonuçlara varır.
       Misafir yalnızca kamerayı ve ipuçlarını yerel yürütür.
       ==================================================================== */
    if (guest) {
      /* Düşman/boss KARARLARI host'ta; ama animasyon saatleri yerel dönmeli.
         Yoksa kurtlar bacaklarını kıpırdatmadan kayar, yarasaların kanatları
         donar, ejderha kanatları donuk kalır ve ölen düşmanlar animasyonu
         oynamadan yok olur. */
      for (const en of e.enemies) en.tickVisuals(dt, this.particles);
      e.enemies = e.enemies.filter(x => x.alive);
      if (this.boss?.alive) this.boss.tickVisuals(dt);
      this._stepTipsAndCamera(dt);
      return;
    }

    /* --- Yere serilme / kaldırma --- */
    this._updateDowned(dt);

    /* --- Düşmanlar --- */
    for (const en of e.enemies) {
      if (!en.alive) continue;
      /* Her düşman kendine en yakın oyuncuyu hedefler — AI kodu değişmedi */
      ctx.player = this._nearestPlayer(en.cx, en.cy);
      en.update(dt, ctx);
    }
    e.enemies = e.enemies.filter(x => x.alive);
    ctx.player = this.player;

    /* --- Boss --- */
    this._updateBoss(dt, ctx);

    /* --- Mermiler --- */
    for (const pr of e.projectiles) {
      if (!pr.alive) continue;
      pr.update(dt, ctx);
    }
    e.projectiles = e.projectiles.filter(x => x.alive);

    /* --- Oklar --- */
    for (const ar of e.arrows) {
      if (!ar.alive) continue;
      ar.update(dt, ctx);
    }
    e.arrows = e.arrows.filter(x => x.alive);

    /* --- Toplama --- */
    this._collect(dt);

    /* --- Çarpışma / hasar --- */
    this._combat(dt);

    /* --- Ölüm bölgesi --- */
    for (const p of this.players) {
      if (!p.dead && p.y > this.level.deathY) this._playerFalls(p);
    }

    /* --- İpuçları: herhangi bir oyuncu yaklaşınca görünür --- */
    for (const t of this.tips) {
      let nearest = Infinity;
      for (const p of this.players) nearest = Math.min(nearest, Math.abs(p.cx - t.x));
      const target = nearest < 220 ? 1 : 0;
      t.alpha += (target - t.alpha) * Math.min(1, dt * 5);
    }

    /* --- Checkpoint: biri dokunursa ikisi için de kaydedilir --- */
    for (const cp of e.checkpoints) {
      cp.update(dt);
      if (cp.activated) continue;
      if (!this.players.some(p => !p.dead && cp.overlapsPlayer(p))) continue;
      cp.activate();
      this.spawnPoint = { x: cp.spawnX, y: cp.spawnY };
      this.particles.coinBurst(cp.cx, cp.y + 10, '#ffb84a');
      this.camera.addShake(4);
      if (this.audio) this.audio.playCheckpoint();
      if (this.cb.onToast) this.cb.onToast('Kontrol noktası kaydedildi', 1800);
    }

    /* --- Portal ---
       Co-op'ta bölüm İKİSİ DE geçitte olduğunda biter. Yoksa biri koşup
       bitirir, diğeri geride kalır ve "birlikte geçme" hissi kaybolur. */
    e.portal.update(dt);
    if (e.portal.open) {
      const waiting = this.players.filter(p => !p.dead && !p.downed);
      const atPortal = waiting.filter(p => e.portal.triggersPlayer(p));
      this.portalWaiting = this.players.length > 1
        ? { at: atPortal.length, need: waiting.length }
        : null;

      if (waiting.length > 0 && atPortal.length === waiting.length) {
        this._levelComplete();
      } else if (atPortal.length > 0 && atPortal.length < waiting.length) {
        this._hintOnce('portal-wait', 'Geçit ikinizi birden bekliyor', 2200);
      }
    }

    this._stepTipsAndCamera(dt, /* alreadyDidTips */ true);
  }

  /** İpuçları + kamera — hem host hem misafirde yerel çalışır */
  _stepTipsAndCamera(dt, skipTips = false) {
    if (!skipTips) {
      for (const t of this.tips) {
        let nearest = Infinity;
        for (const p of this.players) nearest = Math.min(nearest, Math.abs(p.cx - t.x));
        const target = nearest < 220 ? 1 : 0;
        t.alpha += (target - t.alpha) * Math.min(1, dt * 5);
      }
      for (const h of this.entities.hearts) h.update(dt);
      for (const cp of this.entities.checkpoints) cp.update(dt);
      if (this.entities.portal) this.entities.portal.update(dt);
    }

    const seen = this.visiblePlayers;
    if (seen.length > 1) {
      this.camera.followGroup(seen.map(p => ({ x: p.cx, y: p.cy })), dt);
    } else {
      const p = seen[0] || this.player;
      this.camera.follow(p.cx, p.cy, p.facing, dt);
      this.camera.zoomTarget = 1;
    }
  }

  /** Aynı ipucunu saniyede bir kez göster — toast spam'i olmasın */
  _hintOnce(key, text, ms) {
    const now = performance.now();
    this._hints = this._hints || {};
    if (this._hints[key] && now - this._hints[key] < ms) return;
    this._hints[key] = now;
    if (this.cb.onToast) this.cb.onToast(text, ms);
  }

  _rebuildSolids() {
    const lv = this.level;
    lv.solids = lv.staticSolids.slice();
    for (const mp of this.entities.movingPlatforms) {
      lv.solids.push(mp);
    }
    for (const cp of this.entities.crumbles) {
      if (cp.solid) lv.solids.push(cp);
    }
    /* Ortak asansör: hareketli platform gibi davranır (üstündekini taşır) */
    for (const lift of this.entities.coopLifts) {
      lift.moving = true;
      lv.solids.push(lift);
    }
    /* Kapı: kapalıyken katı. Açıldıkça çarpışma kutusu yukarı kayar. */
    for (const g of this.entities.gates) {
      if (!g.solid) continue;
      const b = g.collisionBox;
      lv.solids.push({ x: b.x, y: b.y, w: b.w, h: b.h, gate: g });
    }
  }

  /* ======================================================================
     Co-op mekanizmaları
     ====================================================================== */
  _updateCoop(dt) {
    const e = this.entities;
    if (e.plates.length === 0 && e.gates.length === 0 && e.coopLifts.length === 0) return;

    const players = this.players.filter(p => !p.dead);

    /* 1. Plakalar: kim üstünde? */
    const keys = new Map();
    for (const pl of e.plates) {
      const active = pl.evaluate(players, dt);
      keys.set(pl.key, active);
      if (pl.justChanged) {
        this.particles.hitSpark(pl.cx, pl.y, active ? '#3ddc84' : '#8a8ea6', active ? 14 : 8);
        if (this.audio) this.audio.playUiClick?.();
      }
    }

    /* 2. Kapılar: gereken anahtarların hepsi aktifse açılır */
    for (const g of e.gates) {
      const before = g.open;
      g.update(dt, keys);
      if (before < 0.5 && g.open >= 0.5) {
        this.particles.coinBurst(g.cx, g.cy, '#8fd0ff');
        this.camera.addShake(4);
        if (this.audio) this.audio.playCheckpoint?.();
      }
    }

    /* 3. Ortak asansör: gereken sayıda oyuncu binene kadar kımıldamaz */
    const needed = this.players.length;
    for (const lift of e.coopLifts) {
      lift.evaluate(players);
      const wasReady = lift._wasReady;
      const ready = lift.riders >= needed;
      lift.update(dt, needed);
      if (ready && !wasReady) {
        this.particles.hitSpark(lift.cx, lift.y, '#d4a853', 12);
        this._hintOnce('lift', 'Asansör ikinizi birden taşıyor', 2000);
      }
      lift._wasReady = ready;
      if (!ready && lift.riders > 0 && lift.y >= lift.baseY - 2) {
        this._hintOnce('lift-need', 'Asansör ancak ikiniz de bindiğinizde kalkar', 2600);
      }
    }
  }

  /* ======================================================================
     Toplama
     ====================================================================== */
  _collect(dt) {
    /* Toplanabilirler ORTAK. Kim alırsa alsın sayaç aynı — iki kişi kalp
       için yarışmasın, birlikte toplasın. */
    const collectors = this.players.filter(p => !p.dead && !p.downed);
    if (collectors.length === 0) {
      for (const h of this.entities.hearts) h.update(dt);
      return;
    }

    for (const h of this.entities.hearts) {
      h.update(dt);
      if (h.collected) continue;

      /* Mıknatıs etkisi: en yakın oyuncuya çekilir */
      let p = collectors[0], dist = Infinity, dx = 0, dy = 0;
      for (const c of collectors) {
        const cdx = c.cx - h.cx, cdy = c.cy - h.cy;
        const d = Math.hypot(cdx, cdy);
        if (d < dist) { dist = d; p = c; dx = cdx; dy = cdy; }
      }
      if (dist < 90 && dist > 0.001) {
        const pull = (1 - dist / 90) * 340 * dt;
        h.x += (dx / dist) * pull;
        h.y += (dy / dist) * pull;
      }
      if (dist < 26) {
        h.collected = true;
        this.hearts++;
        this.particles.coinBurst(h.cx, h.cy, h.big ? '#ffb84a' : '#ff6b8a');
        this.particles.heartFloat(h.cx, h.cy);
        if (this.audio) this.audio.playCollect(h.big);

        if (h.big && h.storyIndex >= 0) {
          this.camera.addShake(6);
          this.camera.punchZoom(0.04);
          this.renderer.addFlash(0.3, '255,200,120');
          this.storyUnlocked.push(h.storyIndex);
          if (this.cb.onStory) this.cb.onStory(h.storyIndex);
        }
        this._emitHud();
      }
    }

    for (const o of this.entities.lifeOrbs) {
      o.update(dt);
      if (o.collected) continue;
      if (collectors.some(c => o.overlapsPlayer(c))) {
        o.collected = true;
        if (this.lives < 5) this.lives++;
        this.maxLives = Math.max(this.maxLives, this.lives);
        this.particles.coinBurst(o.cx, o.cy, '#3ddc84');
        this.renderer.addFlash(0.25, '120,255,180');
        if (this.audio) this.audio.playLifeUp();
        if (this.cb.onToast) this.cb.onToast('+1 Can', 1600);
        this._emitHud();
      }
    }

    /* --- Ejderha Kalkanı --- */
    const sp = this.entities.shieldPickup;
    if (sp && !sp.collected) {
      sp.update(dt);
      if (collectors.some(c => sp.overlapsPlayer(c))) {
        sp.collected = true;
        /* Kalkan ikisine birden verilir. Tek kişiye verilse "kalkan kimde?"
           tartışması çıkar ve boss savaşında biri savunmasız kalır. */
        for (const c of this.players) c.hasShield = true;
        this.particles.coinBurst(sp.cx, sp.cy, '#8fd0ff');
        this.particles.hitSpark(sp.cx, sp.cy, '#cfe4ff', 26);
        this.renderer.addFlash(0.4, '150,200,255');
        this.camera.punchZoom(0.05);
        if (this.audio) this.audio.playShieldPickup();
        if (this.cb.onToast) this.cb.onToast('EJDERHA KALKANI — L tuşunu basılı tut: siper al', 4200);
        this._emitHud();
      }
    }
  }

  /* ======================================================================
     Nişan yardımı — oyuncunun baktığı yöndeki en yakın geçerli hedef.
     Ok bu hedefe doğru en fazla ±35° eğilir; yay "ışınlanma" hissi
     vermeden yukarıdaki yarasaları ve ejderhanın kafasını vurabilsin diye.
     ====================================================================== */
  _findAimTarget(player) {
    const p = player || this.player;
    if (p.dead || p.downed) return null;

    const MAX_FWD = 540;
    const MAX_VERT = 300;
    let best = null, bestD = Infinity;

    const consider = (x, y) => {
      const fwd = (x - p.cx) * p.facing;
      if (fwd < 40 || fwd > MAX_FWD) return;
      const dy = y - (p.y + 20);
      if (Math.abs(dy) > MAX_VERT) return;
      const d = Math.hypot(fwd, dy);
      if (d < bestD) { bestD = d; best = { x, y }; }
    };

    for (const en of this.entities.enemies) {
      if (!en.alive || en.dying) continue;
      consider(en.cx, en.cy);
    }
    if (this.boss && this.boss.alive && !this.boss.dying && this.boss.vulnerable) {
      const hb = this.boss.headBox;
      consider(hb.x + hb.w / 2, hb.y + hb.h / 2);
    }
    return best;
  }

  /* ======================================================================
     Savaş / hasar
     ====================================================================== */
  _combat(dt) {
    /* Savaş çözümü oyuncu başına aynen çalışıyor; tek fark her şeyin
       bir döngü içine alınmış olması. Böylece iki karakter de vurabiliyor,
       vurulabiliyor ve mermi sektirebiliyor. */
    for (let i = 0; i < this.players.length; i++) {
      this._combatForPlayer(this.players[i], i, dt);
    }
    this._combatShared(dt);
    for (const p of this.players) this._combatContact(p, dt);
  }

  /** Siperdeyken gelen saldırıyı emer. true → saldırı tüketildi, hasar yok. */
  _tryBlock(p, fromX) {
    if (!p.blocking || p.blockAmount < 0.5) return false;
    p.blockHit(fromX, this.particles, this.camera);
    this.hitStop = 0.07;
    this.renderer.addFlash(0.16, '150,200,255');
    if (this.audio) this.audio.playBlock();
    return true;
  }

  _combatForPlayer(p, index, dt) {
    if (p.dead || p.downed) return;
    const atk = p.attackBox;


    /* --- Kılıç → düşman --- */
    if (atk) {
      for (const en of this.entities.enemies) {
        if (!en.alive || en.dying) continue;
        if (p.attackHitIds.has(en.id)) continue;
        if (!aabb(atk.x, atk.y, atk.w, atk.h, en.x, en.y, en.w, en.h)) continue;

        p.attackHitIds.add(en.id);
        const killed = en.takeHit(this.particles);
        this.hitStop = killed ? 0.075 : 0.045;
        this.camera.addShake(killed ? 9 : 5);
        if (this.audio) this.audio.playHit();
        if (killed && this.audio) this.audio.playEnemyDeath();
      }

      /* --- Kılıç → mermi sektirme --- */
      for (const pr of this.entities.projectiles) {
        if (!pr.alive || !pr.deflectable || pr.deflected) continue;
        if (!aabb(atk.x, atk.y, atk.w, atk.h, pr.x, pr.y, pr.w, pr.h)) continue;
        pr.deflect(p.facing);
        this.hitStop = 0.06;
        this.camera.addShake(6);
        this.particles.hitSpark(pr.cx, pr.cy, '#ffd76b', 16);
        if (this.audio) this.audio.playDeflect();
      }

      /* --- Kılıç → boss --- */
      if (this.boss && this.boss.alive && !this.boss.dying && this.boss.vulnerable) {
        const hb = this.boss.headBox;
        if (aabb(atk.x, atk.y, atk.w, atk.h, hb.x, hb.y, hb.w, hb.h)) {
          if (this.boss.takeHit(this._ctx())) {
            this.hitStop = 0.16;
            this.renderer.addFlash(0.45, '255,220,150');
            this._emitHud();
          }
        }
      }
    }

    /* Oklar oyuncuya değil DÜNYAYA ait — her oyuncu için ayrı ayrı
       çözülürse aynı ok iki kez işlenir. Bu yüzden _combatShared'e taşındı. */
  }

  /* ======================================================================
     Oyuncudan bağımsız çarpışmalar — sahnede bir kez çözülür
     ====================================================================== */
  _combatShared() {
    /* --- Ok → düşman / mermi / boss --- */
    for (const ar of this.entities.arrows) {
      if (!ar.alive || ar.stuck) continue;

      let consumed = false;

      for (const en of this.entities.enemies) {
        if (!en.alive || en.dying) continue;
        if (!aabb(ar.x, ar.y, ar.w, ar.h, en.x, en.y, en.w, en.h)) continue;
        const killed = en.takeHit(this.particles);
        ar.consume(this.particles);
        consumed = true;
        this.hitStop = killed ? 0.06 : 0.035;
        this.camera.addShake(killed ? 7 : 4);
        if (this.audio) this.audio.playArrowHit();
        if (killed && this.audio) this.audio.playEnemyDeath();
        break;
      }
      if (consumed) continue;

      // Ok düşman mermisini havada patlatır
      for (const pr of this.entities.projectiles) {
        if (!pr.alive || pr.deflected) continue;
        if (!aabb(ar.x, ar.y, ar.w, ar.h, pr.x, pr.y, pr.w, pr.h)) continue;
        pr.alive = false;
        ar.consume(this.particles);
        consumed = true;
        this.particles.hitSpark(pr.cx, pr.cy, '#ffd76b', 14);
        this.camera.addShake(4);
        if (this.audio) this.audio.playDeflect();
        break;
      }
      if (consumed) continue;

      // Boss — sadece savunmasızken kafadan
      if (this.boss && this.boss.alive && !this.boss.dying) {
        if (this.boss.vulnerable) {
          const hb = this.boss.headBox;
          if (aabb(ar.x, ar.y, ar.w, ar.h, hb.x, hb.y, hb.w, hb.h)) {
            ar.consume(this.particles);
            if (this.boss.takeHit(this._ctx())) {
              this.hitStop = 0.16;
              this.renderer.addFlash(0.45, '255,220,150');
              this._emitHud();
            }
            continue;
          }
        }
        // Zırhlı gövde: ok seker
        if (this.boss.hitsBox && this.boss.hitsBox(ar)) {
          ar.consume(this.particles);
          this.particles.hitSpark(ar.cx, ar.cy, '#9aa0b8', 10);
          if (this.audio) this.audio.playArrowHitWall();
        }
      }
    }

  }

  /* ======================================================================
     Temas hasarı — oyuncu başına
     ====================================================================== */
  _combatContact(p, dt) {
    if (p.dead || p.downed) return;
    const tryBlock = (fromX) => this._tryBlock(p, fromX);

    /* --- Zıplayarak ezme + temas hasarı --- */
    for (const en of this.entities.enemies) {
      if (!en.alive || en.dying) continue;
      if (!en.overlapsPlayer(p)) continue;

      const stomping = en.stompable && p.vy > 60 &&
                       (p.bottom - p.vy * dt) <= en.y + 12;

      if (stomping) {
        const killed = en.takeHit(this.particles);
        p.bounce();
        this.hitStop = 0.07;
        this.camera.addShake(8);
        this.renderer.addFlash(0.14);
        if (this.audio) this.audio.playStomp();
        if (killed && this.audio) this.audio.playEnemyDeath();
      } else if (!tryBlock(en.cx)) {
        if (p.hurt(en.cx, this.particles, this.camera)) {
          this._takeDamage(p);
        }
      }
    }

    /* --- Dikenler --- */
    for (const sp of this.entities.spikes) {
      if (sp.hitsPlayer(p)) {
        if (p.hurt(p.cx, this.particles, this.camera)) {
          this._takeDamage(p);
          p.vy = -420;   // dikenden zıplat
        }
      }
    }

    /* --- Mermiler --- */
    for (const pr of this.entities.projectiles) {
      if (!pr.alive) continue;

      if (pr.deflected) {
        // Sektirilen mermi düşmanlara ve boss'a zarar verir
        for (const en of this.entities.enemies) {
          if (!en.alive || en.dying) continue;
          if (!aabb(pr.x, pr.y, pr.w, pr.h, en.x, en.y, en.w, en.h)) continue;
          en.takeHit(this.particles);
          pr.alive = false;
          this.camera.addShake(6);
          if (this.audio) this.audio.playHit();
          break;
        }
        if (this.boss && this.boss.alive && this.boss.vulnerable) {
          const hb = this.boss.headBox;
          if (aabb(pr.x, pr.y, pr.w, pr.h, hb.x, hb.y, hb.w, hb.h)) {
            pr.alive = false;
            if (this.boss.takeHit(this._ctx())) {
              this.hitStop = 0.16;
              this.renderer.addFlash(0.45, '255,220,150');
              this._emitHud();
            }
          }
        }
        continue;
      }

      if (aabb(pr.x, pr.y, pr.w, pr.h, p.x, p.y, p.w, p.h)) {
        // Ejderha Kalkanı: ateş topunu / meteoru / büyüyü emer
        if (tryBlock(pr.cx)) {
          pr.alive = false;
          continue;
        }
        if (p.hurt(pr.cx, this.particles, this.camera)) {
          pr.alive = false;
          this._takeDamage(p);
        }
      }
    }

    /* --- Boss gövde teması --- */
    if (this.boss && this.boss.alive && !this.boss.dying) {
      const stompHead = this.boss.vulnerable && p.vy > 60 &&
        aabb(p.x, p.y + p.h - 12, p.w, 16,
             this.boss.headBox.x, this.boss.headBox.y, this.boss.headBox.w, 26);

      if (stompHead) {
        if (this.boss.takeHit(this._ctx())) {
          p.bounce(-620);
          this.hitStop = 0.16;
          this.renderer.addFlash(0.45, '255,220,150');
          this._emitHud();
        }
      } else if (this.boss.hitsPlayer(p)) {
        // Ejderha Kalkanı: süpürme dalışını ve gövde çarpmasını da durdurur
        if (!tryBlock(this.boss.cx)) {
          if (p.hurt(this.boss.cx, this.particles, this.camera)) {
            this._takeDamage(p);
          }
        }
      }
    }
  }

  /* ======================================================================
     Hasar / yere serilme

     Tek oyuncu: hasar → can eksilir → can biterse ölüm. (eski davranış)
     Co-op:      hasar → can eksilir → can biterse o oyuncu YERE SERİLİR,
                 yoldaşı kaldırabilir. İkisi de yerdeyse tur biter.

     Neden böyle: bu bir hediye, zorluk sınavı değil. Birinin hatası oyunu
     bitirmemeli; onun yerine "gel beni kurtar" anına dönüşmeli.
     ====================================================================== */
  _takeDamage(player) {
    const p = player || this.player;
    if (p.downed || p.dead) return;

    this.lives--;
    this.hitStop = 0.1;
    this.renderer.addFlash(0.4, '255,60,60');
    if (this.audio) this.audio.playHurt();
    this._emitHud();

    if (this.lives > 0) return;

    if (this.players.length === 1) {
      this._playerDies('damage');
    } else {
      this._downPlayer(p);
    }
  }

  /** Uçuruma düştü */
  _playerFalls(p) {
    if (this.players.length === 1) { this._playerDies('fall'); return; }

    /* Düşen oyuncu son kontrol noktasına yere serilmiş olarak döner.
       Uçurumun dibinde bırakmak kurtarmayı imkânsız yapardı. */
    if (this.lives > 0) { this.lives--; this._emitHud(); }
    this.camera.addShake(10);
    if (this.audio) this.audio.playDeath();
    this._downPlayer(p, this.spawnPoint.x + (p.index === 0 ? -SPAWN_GAP / 2 : SPAWN_GAP / 2),
                         this.spawnPoint.y);
  }

  _downPlayer(p, x, y) {
    p.goDown(x, y);
    this.particles.hitSpark(p.cx, p.cy, '#ff4060', 26);
    this.renderer.addFlash(0.3, '200,40,60');
    this.camera.addShake(10);
    if (this.audio) this.audio.playHurt();

    const alive = this.activePlayers;
    if (alive.length === 0) {
      /* İkisi de yerde — kimse kurtaramaz, tur biter */
      this._playerDies('both-down');
    } else {
      this._hintOnce('down', `${p.name || 'Yoldaşın'} yere serildi — yanına git ve kaldır`, 3200);
    }
    this._emitHud();
  }

  /** Yere serilmiş oyuncuları izle: kaldırılıyor mu, süre doluyor mu */
  _updateDowned(dt) {
    if (this.players.length < 2) return;

    for (const p of this.players) {
      if (!p.downed) continue;

      /* Yakınında ayakta duran bir yoldaş var mı? */
      const helper = this.players.find(o =>
        o !== p && !o.dead && !o.downed &&
        Math.abs(o.cx - p.cx) < REVIVE_RANGE &&
        Math.abs(o.cy - p.cy) < REVIVE_RANGE + 20
      );

      if (helper) {
        p.reviveProgress += dt / REVIVE_TIME;
        /* Kaldırma sırasında parıltı — ilerleme görünür olsun */
        if (Math.random() < 0.35) {
          this.particles.spawn?.({
            x: p.cx + (Math.random() - 0.5) * 22,
            y: p.cy + 10 - Math.random() * 24,
            life: 0.4, size: 5, color: '#3ddc84', glow: 12, drag: 1
          });
        }
        if (p.reviveProgress >= 1) {
          p.reviveNow(this.particles);
          this.renderer.addFlash(0.25, '120,255,180');
          if (this.audio) this.audio.playLifeUp();
          if (this.cb.onToast) this.cb.onToast('Kaldırıldı! Devam edin.', 1800);
          /* Kurtarma ödülü: ortak cana 1 ekle ki iş birliği kazandırsın */
          if (this.lives < 1) { this.lives = 1; }
          this._emitHud();
        }
      } else {
        /* Kimse gelmiyorsa ilerleme geri sarılır */
        p.reviveProgress = Math.max(0, p.reviveProgress - dt * 0.6);
      }

      if (p.downTimer > DOWN_TIMEOUT) {
        this._playerDies('down-timeout');
        return;
      }
    }

    /* Yerdeyken HUD saniyede ~6 kez tazelensin: kaldırma çubuğu ve geri
       sayım akmalı, yoksa kurtarma sırasında ekranda hiçbir şey oynamıyor
       gibi görünüyor. */
    this._downHudTimer = (this._downHudTimer || 0) + dt;
    if (this._downHudTimer > 0.16) {
      this._downHudTimer = 0;
      if (this.players.some(p => p.downed)) this._emitHud();
    }
  }

  /* ======================================================================
     Boss
     ====================================================================== */
  /**
   * Ejderhayı yarat ve arenayı kilitle.
   *
   * Hem host'un tetikleyicisi hem de MİSAFİR bunu çağırıyor. Misafirin de
   * çağırması şart: boss'un yapay zekâsı yalnızca host'ta koşuyor ama nesnenin
   * kendisi misafirde de var olmak zorunda, yoksa anlık görüntüdeki boss
   * verisini yazacak bir yer bulunamıyor ve misafir GÖRÜNMEZ bir ejderhayla
   * dövüşüyor — arena kilidi de, boss can çubuğu da hiç açılmıyor.
   */
  spawnBoss() {
    if (this.boss) return this.boss;
    const bd = this.level?.def?.boss;
    if (!bd) return null;

    this.bossStarted = true;
    this.boss = new Dragon(bd, {
      minX: bd.arenaMinX,
      maxX: bd.arenaMaxX,
      groundY: GROUND_Y
    });
    // Arena kilidi
    this.level.minX = bd.arenaMinX;
    this.camera.setBounds(bd.arenaMinX, bd.arenaMaxX, -260, DEATH_Y + 100);
    this.renderer.addFlash(0.5, '255,120,60');
    this.camera.addShake(18);
    if (this.cb.onBossStart) this.cb.onBossStart();
    this._emitHud();
    return this.boss;
  }

  _updateBoss(dt, ctx) {
    const def = this.level.def;
    if (!def.boss) return;

    /* Boss'u herhangi bir oyuncunun geçmesi tetikler */
    if (!this.bossStarted && this.players.some(p => !p.dead && p.cx > def.boss.triggerX)) {
      this.spawnBoss();
      return;
    }

    if (!this.boss) return;
    /* Ejderha en yakın ayakta oyuncuyu hedefler */

    const prevTarget = ctx.player;
    ctx.player = this._nearestPlayer(this.boss.cx, this.boss.cy);
    this.boss.update(dt, ctx);
    ctx.player = prevTarget;

    if (this.boss.defeated && this.state === 'playing') {
      this.boss.alive = false;
      this.entities.portal.open = true;
      this.level.minX = 0;
      this.renderer.addFlash(0.7, '255,230,180');
      if (this.cb.onToast) this.cb.onToast('Ejderha yenildi! Geçit açıldı.', 3200);
      if (this.audio) this.audio.playVictory();
      this._emitHud();
    }
  }

  /* ======================================================================
     Ölüm / yeniden doğma
     ====================================================================== */
  _playerDies(cause) {
    if (this.state !== 'playing') return;
    /* Co-op'ta tur ikisi için birden biter — biri ayakta kalıp tek başına
       devam edemez, çünkü kapıların yarısı iki kişi ister. */
    for (const p of this.players) { p.downed = false; p.kill(); }
    this.state = 'dying';
    this.stateTimer = 0;
    this.camera.addShake(12);
    this.renderer.addFlash(0.35, '180,30,50');
    if (this.audio) this.audio.playDeath();
    if (cause === 'fall' && this.lives > 0) {
      this.lives--;
      this._emitHud();
    }
  }

  _stepDying(dt) {
    this.stateTimer += dt;
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].update(dt, this.inputs[i], this.level, this.particles, this.camera, this.audio);
    }
    const seen = this.players.map(p => ({ x: p.cx, y: clamp(p.cy, 0, GROUND_Y) }));
    if (seen.length > 1) this.camera.followGroup(seen, dt);
    else this.camera.follow(seen[0].x, seen[0].y, this.player.facing, dt);
    for (const mp of this.entities.movingPlatforms) mp.update(dt);
    for (const cp of this.entities.crumbles) cp.update(dt);

    if (this.stateTimer > 1.1) {
      if (this.lives <= 0) {
        this.state = 'respawning';
        this.stateTimer = 0;
        this.fullRestart = true;
        if (this.cb.onDeath) this.cb.onDeath(true);
      } else {
        this.state = 'respawning';
        this.stateTimer = 0;
        this.fullRestart = false;
        if (this.cb.onDeath) this.cb.onDeath(false);
      }
    }
  }

  _stepRespawning(dt) {
    this.stateTimer += dt;
    if (this.stateTimer < 0.7) return;

    /* --------------------------------------------------------------------
       MİSAFİR BÖLÜMÜ BAŞTAN YÜKLEMEYE KARAR VEREMEZ.

       `fullRestart` yerel bir tahmindi ve misafirde yanlış çıkabiliyordu:
       host 'dying' durumunda 1.1 sn kalıyor, misafir oraya ~100 ms geç
       giriyor ve host çıktığı anda anlık görüntüyle dışarı çekiliyor —
       yani bayrağın atandığı satıra hiç varamıyor. Bayrak bir önceki
       ölümden kalma değerle kalınca misafir ya gereksiz yere bölümü
       baştan yüklüyor ya da yüklemesi gerekirken yüklemiyordu.

       Artık kararı host veriyor: `loadSerial` anlık görüntüyle geliyor
       (bkz. snapshot.js → `rs`). Misafir yalnızca kendi tarafını hazır
       konuma alıp oynamaya döner.
       -------------------------------------------------------------------- */
    if (this.netMode === 'guest') {
      this._resetPlayersToSpawn(this.spawnPoint.x, this.spawnPoint.y);
      this.entities.projectiles.length = 0;
      this.entities.arrows.length = 0;
      this.camera.snapTo(this.player.cx, this.player.cy, 1);
      this.state = 'playing';
      this._emitHud();
      return;
    }

    if (this.fullRestart) {
      this.lives = START_LIVES;
      this.entities.projectiles.length = 0;
      this.entities.arrows.length = 0;
      this.loadLevel(this.levelIndex);
    } else {
      this._resetPlayersToSpawn(this.spawnPoint.x, this.spawnPoint.y);
      this.entities.projectiles.length = 0;
      this.entities.arrows.length = 0;
      // Boss savaşındaysa boss'u sıfırla
      if (this.boss && this.boss.alive && !this.boss.dying) {
        this.boss.hp = Math.min(this.boss.maxHp, this.boss.hp + 1);
        this.boss._setState('hover');
      }
      this.camera.snapTo(this.player.cx, this.player.cy, 1);
      this.state = 'playing';
      this.particles.coinBurst(this.player.cx, this.player.cy, '#8ab4ff');
      this._emitHud();
    }
  }

  /* ======================================================================
     Bölüm tamamlama
     ====================================================================== */
  _levelComplete() {
    if (this.state !== 'playing') return;
    this.state = 'levelDone';
    this.stateTimer = 0;
    this.portalWaiting = null;
    for (const p of this.players) {
      p.state = 'win';
      p.vx = 0;
      this.particles.coinBurst(p.cx, p.cy, '#c78bff');
    }
    this.renderer.addFlash(0.6, '200,160,255');
    this.camera.punchZoom(0.08);
    if (this.audio) this.audio.playPortal();
  }

  _stepLevelDone(dt) {
    this.stateTimer += dt;
    const px = this.entities.portal.cx;
    /* İki oyuncu da portale çekilir */
    for (const p of this.players) {
      p.vx *= 0.9;
      p.x += (px - p.w / 2 - p.x) * Math.min(1, dt * 3);
      p.y += (this.entities.portal.y + 40 - p.y) * Math.min(1, dt * 2);
      p.squashX = clamp(1 - this.stateTimer * 0.5, 0.05, 1);
      p.squashY = clamp(1 - this.stateTimer * 0.3, 0.1, 1);
    }
    for (const mp of this.entities.movingPlatforms) mp.update(dt);
    this.camera.follow(px, this.entities.portal.cy, 1, dt);

    if (this.stateTimer > 1.4) {
      const isLast = this.levelIndex >= LEVELS.length - 1;
      this.state = 'idle';
      /* TEK ATIŞ.
         Misafir bu duruma anlık görüntüyle giriyor ve host 1.4 sn boyunca
         'levelDone' yayınlamaya devam ediyor. Kilit olmadan misafir her
         yeni pakette buraya tekrar giriyor ve bölüm geçiş perdesi arka
         arkaya 4 kez açılıyordu (ölçüldü: host 1, misafir 4). */
      if (this._levelDoneFired) return;
      this._levelDoneFired = true;
      if (isLast) {
        if (this.cb.onGameComplete) this.cb.onGameComplete({
          hearts: this.hearts,
          story: this.storyUnlocked
        });
      } else {
        if (this.cb.onLevelComplete) {
          this.cb.onLevelComplete(this.levelIndex, () => {
            this.loadLevel(this.levelIndex + 1);
          });
        }
      }
    }
  }

  _stepGameDone() {}

  /* ======================================================================
     HUD
     ====================================================================== */
  _emitHud() {
    if (!this.cb.onHud) return;
    this.cb.onHud({
      lives: this.lives,
      maxLives: Math.max(3, this.maxLives),
      hearts: this.hearts,
      totalHearts: this.totalHearts,
      level: this.levelIndex,
      levelName: this.level ? this.level.name : '',
      hasShield: this.player.hasShield,
      coop: this.players.length > 1 ? {
        localIndex: this.localIndex,
        players: this.players.map(p => ({
          index: p.index,
          name: p.name,
          downed: p.downed,
          dead: p.dead,
          revive: p.reviveProgress,
          downLeft: p.downed ? Math.max(0, DOWN_TIMEOUT - p.downTimer) : 0,
          palette: p.palette
        })),
        portal: this.portalWaiting || null
      } : null,
      boss: this.boss && this.boss.alive ? {
        hp: Math.max(0, this.boss.hp),
        maxHp: BOSS_MAX_HP,
        name: 'Vhaerix'
      } : null
    });
  }

  /* Dokunmatik butonları bağla — her zaman YEREL oyuncuya */
  bindTouch(els) { this.inputs[this.localIndex]?.bindTouch(els); }

  /**
   * Ağdan gelen tuş durumunu uzak oyuncuya uygula (host tarafında).
   *
   * Uygulamadan HEMEN ÖNCE oyuncunun konumunu kaydediyoruz. Bunun sebebi
   * uzlaştırma (reconciliation):
   *
   *   · Misafir N numaralı girdiyi yollarken N-1'e kadarını işlemiş olur.
   *   · Host N geldiğinde yine N-1'e kadarını işlemiş olur.
   *
   * Yani bu iki konum AYNI SİMÜLASYON ANINA aittir ve doğrudan
   * kıyaslanabilir. Anlık görüntü zamanındaki konumla kıyaslamak
   * "gecikme × hız" kadar sahte bir hata üretiyor ve karakteri geri
   * sürüklüyordu.
   */
  applyRemoteInput(index, state, seq, backfill = null) {
    const inp = this.inputs[index];
    if (inp instanceof RemoteInput) inp.apply(state, seq, backfill);
  }
}
