/* ==========================================================================
   Yönetmen — timeline motoru

   Sahne = VERİ. Motor = TEK. Sahne dosyaları hiç kod çalıştırmaz, sadece
   "şu anda şu olsun" der. Bunun iki büyük faydası var:

   1. seek(t) mümkün — sahneyi herhangi bir ana ışınlayabiliriz.
      Co-op'ta host `time` yayınlar, misafir seek eder. Kare kare aynı sahne.
   2. Metinleri, temposu, kamera hareketini kodu ellemeden değiştirebiliriz.

   Sahne şeması:
   {
     id, duration, clear, tint, letterbox, grain,
     layers: [ ...bkz. layers.js ],
     camera: [ { t, x, y, zoom, ease } ],
     actors: { hero: { keys: [ { t, x, y, facing, anim, alpha, scale, ease } ] } },
     cards:  [ { t, dur, text, pos, style, fadeIn, fadeOut, type } ],
     fades:  [ { t, dur, from, to, color } ],
     shakes: [ { t, dur, power } ],
     flashes:[ { t, dur, color, power } ],
     cues:   [ { t, sfx } ],
     choice: { t, question, options: [{ id, label, hint }] },
     next: 'sahneId' | null
   }
   ========================================================================== */

import { sampleKeys, envelope, clamp01, ease, lerp } from './easing.js';
import { noise1 } from './rng.js';

const CAM_FIELDS = ['x', 'y', 'zoom'];
const ACTOR_FIELDS = ['x', 'y', 'alpha', 'scale', 'rot'];
const ACTOR_STEPS = ['facing', 'anim'];

export class Director {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.config = opts.config || {};
    this.onCue = opts.onCue || null;
    this.onEnd = opts.onEnd || null;
    this.onChoice = opts.onChoice || null;

    this.time = 0;
    this.prevTime = 0;
    this.playing = true;
    this.speed = 1;
    this.ended = false;
    this.duration = scene.duration ?? 20;

    /* Seçim ekranı sahneyi duraklatır — cevap gelene kadar bekler */
    this.awaitingChoice = false;
    this.choiceMade = null;

    this._firedCues = new Set();
  }

  /* ---------- Zaman kontrolü ---------- */

  update(dt) {
    if (!this.playing || this.ended) return;
    this.prevTime = this.time;

    if (this.awaitingChoice) return;   // seçim bekleniyor, zaman durur

    this.time += dt * this.speed;
    this._latchChoice();

    this._fireCues();

    /* Cevapsız seçim varken sahne ASLA bitmez — aksi halde teklif
       varsayılan "evet"e düşerdi. */
    if (this.awaitingChoice) return;

    if (this.time >= this.duration) {
      this.time = this.duration;
      this.ended = true;
      if (this.onEnd) this.onEnd({ choice: this.choiceMade, next: this.scene.next });
    }
  }

  /**
   * Seçim kapısına gelindiğinde (veya seek/sync ile üzerine ışınlandığında)
   * zamanı orada kilitle. Edge-trigger'a güvenmek yetmez: misafir sekme
   * değişiminden dönünce syncTo(choice.t) atlayıp bayrağı kaçırıyordu.
   */
  _latchChoice() {
    const ch = this.scene.choice;
    if (!ch || this.choiceMade || this.awaitingChoice) return false;
    if (this.time + 1e-6 < ch.t) return false;
    this.time = ch.t;
    this.awaitingChoice = true;
    return true;
  }

  /** Belirli bir ana ışınla — co-op senkronunun kalbi */
  seek(t) {
    this.prevTime = this.time;
    this.time = Math.max(0, Math.min(this.duration, t));
    // Geriye sarıldıysa tetiklenmiş sesleri sıfırla
    if (this.time < this.prevTime) this._firedCues.clear();
    this._latchChoice();
  }

  /**
   * Uzaktaki saate yumuşak kilitlen.
   * Küçük sapmalarda hızı esnetir (kesme olmaz), büyük sapmada seek eder.
   * `remoteWaiting` host seçimde durduysa misafirin de kapıyı kaçırmamasını sağlar.
   */
  syncTo(remoteTime, tolerance = 0.2, remoteWaiting = false) {
    const drift = remoteTime - this.time;
    if (Math.abs(drift) > tolerance * 5) { this.seek(remoteTime); this.speed = 1; }
    else if (Math.abs(drift) > tolerance) { this.speed = drift > 0 ? 1.08 : 0.92; }
    else this.speed = 1;

    if (remoteWaiting) this._latchChoice();
  }

  pause() { this.playing = false; }
  resume() { this.playing = true; }

  /** Sahneyi başa sar — tekrar izleme ve co-op'ta yeniden senkron için */
  reset() {
    this.time = 0;
    this.prevTime = 0;
    this.speed = 1;
    this.ended = false;
    this.playing = true;
    this.awaitingChoice = false;
    this.choiceMade = null;
    this._firedCues.clear();
  }

  /**
   * Sahneyi atla.
   *
   * DİKKAT: Cevaplanmamış bir seçim varsa sahneyi SONUNA değil, SORUYA atlar.
   * Aksi halde "Atla"ya basan kişi teklifi hiç görmeden finali geçiyordu —
   * bu oyunun tek amacı o soru olduğu için kabul edilemez.
   */
  skip() {
    if (this.awaitingChoice) return;

    const ch = this.scene.choice;
    if (ch && !this.choiceMade && this.time < ch.t) {
      this.time = ch.t;
      this._latchChoice();
      this._fireCues();
      return;
    }

    this.time = this.duration;
    this.ended = true;
    if (this.onEnd) this.onEnd({ choice: this.choiceMade, next: this.scene.next, skipped: true });
  }

  /** Seçim kartlarından cevap geldi */
  submitChoice(id) {
    if (!this.awaitingChoice) return;
    this.choiceMade = id;
    this.awaitingChoice = false;
    if (this.onChoice) this.onChoice(id);
  }

  /* ---------- Değerlendirme: t → sahne durumu ---------- */

  evaluate(t = this.time) {
    const s = this.scene;

    /* --- Kamera --- */
    const cam = s.camera && s.camera.length
      ? sampleKeys(s.camera, t, CAM_FIELDS)
      : { x: 0, y: 0, zoom: 1 };
    cam.x = cam.x ?? 0;
    cam.y = cam.y ?? 0;
    cam.zoom = cam.zoom ?? 1;

    /* Sarsıntı — gürültüden türetilir, deterministik */
    let shake = 0;
    for (const sh of (s.shakes || [])) {
      const env = envelope(t, sh.t, sh.dur, sh.dur * 0.12, sh.dur * 0.7);
      shake = Math.max(shake, env * (sh.power ?? 8));
    }
    cam.shakeX = shake ? noise1(t * 47.3) * shake : 0;
    cam.shakeY = shake ? noise1(t * 39.1 + 12.7) * shake * 0.7 : 0;
    cam.shake = shake;

    /* --- Aktörler --- */
    const actors = {};
    for (const [name, def] of Object.entries(s.actors || {})) {
      const a = sampleKeys(def.keys, t, ACTOR_FIELDS, ACTOR_STEPS);
      a.x = a.x ?? 0;
      a.y = a.y ?? 0;
      a.alpha = a.alpha ?? 1;
      a.scale = a.scale ?? 1;
      a.rot = a.rot ?? 0;
      a.facing = a.facing ?? 1;
      a.anim = a.anim ?? 'idle';

      const back = sampleKeys(def.keys, Math.max(0, t - 0.06), ['x']);
      const vx = ((a.x - (back.x ?? a.x)) / 0.06);
      a.speed = vx;
      a.walkAmp = Math.min(1, Math.abs(vx) / 85);
      if ((a.anim || 'idle') === 'walk') a.walkAmp = Math.max(a.walkAmp, 0.4);

      /* ------------------------------------------------------------------
         ADIM TEMPOSU KATEDİLEN MESAFEDEN GELİR — zamandan değil.

         Önce faz `t * 7.4` idi: bacaklar sabit tempoda sallanıyordu ama
         gövde bambaşka bir hızla ilerliyordu. Ayaklar yere basmadığı için
         karakter yürümüyor, KAYIYOR gibi görünüyordu. (Açılışta kahraman
         12 saniyede 730 px gidiyor — saniyede 61 px; 210 px boyunda bir
         figür için ağır çekim bir sürüklenme.)

         Faz artık x'in fonksiyonu: karakter ne kadar yol aldıysa bacaklar
         o kadar döner. Durduğunda faz da durur, geri yürürse ters döner.
         Ayak kaymasını tamamen bitiren şey bu.

         STRIDE_PER_CYCLE: bir tam bacak döngüsünde katedilen mesafe.
         Bacak salınımının ürettiği ayak açıklığından ölçüldü (ölçek 1'de
         ~±16 px → yarım döngüde ~33 px → tam döngüde ~66 px).
         ------------------------------------------------------------------ */
      const STRIDE_K = 150;
      const strideWorld = STRIDE_K * (0.35 + a.walkAmp) * a.scale;
      a.phase = (a.x / strideWorld) * Math.PI * 2;
      a.t = t;

      /* Tek seferlik jestlerin (diz çökme, el uzatma, irkilme) kare sırası,
         animasyonun son değiştiği ana göre ilerler. Aynı animasyonu tutan
         sonraki konum anahtarları diziyi baştan başlatmaz. */
      let activeAnim = def.keys[0]?.anim ?? 'idle';
      let animStart = def.keys[0]?.t ?? 0;
      for (const key of def.keys) {
        if (key.t > t) break;
        if (key.anim != null && key.anim !== activeAnim) {
          activeAnim = key.anim;
          animStart = key.t;
        }
      }
      a.animStart = animStart;
      a.animElapsed = Math.max(0, t - animStart);
      actors[name] = a;
    }

    /* --- Kararmalar --- */
    let fadeAlpha = 0;
    let fadeColor = '0,0,0';
    for (const f of (s.fades || [])) {
      if (t < f.t) continue;
      const p = f.dur > 0 ? clamp01((t - f.t) / f.dur) : 1;
      const v = lerp(f.from ?? 0, f.to ?? 0, ease(f.ease || 'inOutQuad', p));
      if (v > fadeAlpha) { fadeAlpha = v; fadeColor = f.color || '0,0,0'; }
    }

    /* --- Flaşlar --- */
    let flash = 0;
    let flashColor = '255,255,255';
    for (const fl of (s.flashes || [])) {
      const env = envelope(t, fl.t, fl.dur ?? 0.5, (fl.dur ?? 0.5) * 0.08, (fl.dur ?? 0.5) * 0.9);
      const v = env * (fl.power ?? 0.7);
      if (v > flash) { flash = v; flashColor = fl.color || '255,255,255'; }
    }

    /* --- Metin kartları --- */
    const cards = [];
    (s.cards || []).forEach((c, i) => {
      const dur = c.dur ?? 4;
      /* Yumuşak giriş/çıkış: kısa zarf kartları "pat" diye düşürüyordu */
      const fadeIn = c.fadeIn ?? 0.85;
      const fadeOut = c.fadeOut ?? 0.95;
      const alpha = envelope(t, c.t, dur, fadeIn, fadeOut);
      if (alpha <= 0.001) return;

      const text = this._interpolate(c.text);
      /* Yazı-makinesi: karakter sayısı zamandan türetilir */
      let reveal = text.length;
      if (c.type !== 'instant') {
        const typeDur = c.typeDur ?? Math.min(dur * 0.42, text.length * (c.charDelay ?? 0.018));
        const p = typeDur > 0 ? clamp01((t - c.t - fadeIn * 0.4) / typeDur) : 1;
        reveal = Math.floor(text.length * ease('outQuad', p));
      }
      cards.push({
        key: `card-${i}`,
        text,
        speaker: this._interpolate(c.speaker || ''),
        reveal,
        alpha,
        pos: c.pos || 'bottom',
        style: c.style || 'normal',
        rise: (1 - ease('outCubic', clamp01((t - c.t) / (fadeIn || 0.001)))) * 10
      });
    });

    /* --- Seçim --- */
    const choice = s.choice && t >= s.choice.t && !this.choiceMade
      ? {
          question: this._interpolate(s.choice.question || ''),
          speaker: this._interpolate(s.choice.speaker || ''),
          options: (s.choice.options || []).map(o => ({
            ...o,
            label: this._interpolate(o.label),
            hint: o.hint ? this._interpolate(o.hint) : ''
          })),
          alpha: ease('outCubic', clamp01((t - s.choice.t) / 0.8))
        }
      : null;

    return {
      t,
      cam,
      actors,
      cards,
      choice,
      fadeAlpha,
      fadeColor,
      flash,
      flashColor,
      config: this.config,
      progress: this.duration > 0 ? t / this.duration : 0
    };
  }

  /* ---------- İç yardımcılar ---------- */

  _fireCues() {
    for (const cue of (this.scene.cues || [])) {
      if (this._firedCues.has(cue)) continue;
      if (this.prevTime < cue.t && this.time >= cue.t) {
        this._firedCues.add(cue);
        if (this.onCue) this.onCue(cue);
      }
    }
  }

  /** {hero} {target} {question} yer tutucularını doldur */
  _interpolate(text) {
    if (!text) return '';
    const c = this.config;
    return text
      .replace(/\{hero\}/g, c.heroName || 'Kahraman')
      .replace(/\{target\}/g, c.targetName || 'Yolcu')
      .replace(/\{question\}/g, c.proposalText || 'Benimle çıkar mısın?');
  }
}
