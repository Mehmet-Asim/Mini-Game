/* ==========================================================================
   Web Audio — sentezlenmiş müzik ve efektler (harici dosya yok)
   Her bölüm için farklı müzik teması + katmanlı SFX
   ========================================================================== */

const TRACKS = {
  // Karanlık Orman — eolian, yavaş, gizemli
  forest: {
    bpm: 72,
    chords: [
      [130.81, 155.56, 196.00, 233.08],  // Cm7
      [116.54, 138.59, 174.61, 207.65],  // Bbm7
      [103.83, 130.81, 155.56, 196.00],  // Abmaj7
      [123.47, 146.83, 185.00, 233.08]   // Ebmaj7
    ],
    melody: [523.25, 466.16, 415.30, 466.16, 523.25, 622.25, 523.25, 466.16],
    padVol: 0.052, melVol: 0.030, pulse: false
  },
  // Kale Surları — daha görkemli, ritmik
  castle: {
    bpm: 92,
    chords: [
      [110.00, 164.81, 220.00, 261.63],  // Am
      [146.83, 220.00, 293.66, 349.23],  // Dm
      [130.81, 196.00, 261.63, 329.63],  // C
      [164.81, 246.94, 329.63, 392.00]   // Em
    ],
    melody: [440.00, 493.88, 523.25, 587.33, 523.25, 493.88, 440.00, 392.00],
    padVol: 0.048, melVol: 0.034, pulse: true
  },
  // Ejderha İni — gergin, disonans, davullu
  lair: {
    bpm: 108,
    chords: [
      [98.00, 138.59, 185.00, 233.08],   // gerilim
      [92.50, 130.81, 174.61, 220.00],
      [103.83, 146.83, 196.00, 246.94],
      [87.31, 123.47, 164.81, 207.65]
    ],
    melody: [415.30, 466.16, 415.30, 369.99, 415.30, 493.88, 466.16, 415.30],
    padVol: 0.056, melVol: 0.028, pulse: true, drums: true
  },
  // Boss
  boss: {
    bpm: 138,
    chords: [
      [73.42, 110.00, 146.83, 174.61],
      [77.78, 116.54, 155.56, 185.00],
      [69.30, 103.83, 138.59, 164.81],
      [82.41, 123.47, 164.81, 196.00]
    ],
    melody: [293.66, 349.23, 415.30, 349.23, 293.66, 261.63, 293.66, 349.23],
    padVol: 0.062, melVol: 0.040, pulse: true, drums: true, aggressive: true
  }
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.enabled = false;
    this.currentTrack = null;
    this.timers = [];
    this.step = 0;
    this.noiseBuffer = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;

    // Hafif kompresör — patlamaları yumuşatır
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.7;
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1.0;

    // Yankı (convolver yerine hafif delay ağı)
    this.reverb = this.ctx.createGain();
    this.reverb.gain.value = 0.26;
    const d1 = this.ctx.createDelay(1.0); d1.delayTime.value = 0.19;
    const f1 = this.ctx.createGain(); f1.gain.value = 0.42;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2600;
    this.reverb.connect(d1); d1.connect(lp); lp.connect(f1); f1.connect(d1);
    lp.connect(this.comp);

    this.musicGain.connect(this.comp);
    this.musicGain.connect(this.reverb);
    this.sfxGain.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(this.ctx.destination);

    this._makeNoise();
  }

  _makeNoise() {
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  /* ======================================================================
     Temel ses üreteçleri
     ====================================================================== */
  _tone({ freq, dur = 0.4, type = 'sine', vol = 0.1, dest = null, detune = 0, attack = 0.01, glideTo = null, filter = null }) {
    if (!this.ctx) return null;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), now + dur * 0.85);
    if (detune) osc.detune.value = detune;

    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    let node = osc;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.setValueAtTime(filter.freq || 1200, now);
      if (filter.sweepTo) f.frequency.exponentialRampToValueAtTime(filter.sweepTo, now + dur);
      f.Q.value = filter.q || 1;
      osc.connect(f); node = f;
    }
    node.connect(g);
    g.connect(dest || this.sfxGain);
    osc.start(now);
    osc.stop(now + dur + 0.05);
    return osc;
  }

  _noise({ dur = 0.2, vol = 0.1, type = 'lowpass', freq = 1200, sweepTo = null, q = 1 }) {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, now);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), now + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  /* ======================================================================
     Müzik
     ====================================================================== */
  playTrack(name) {
    this.init();
    if (!this.ctx) return;
    if (this.currentTrack === name && this.enabled) return;
    this.currentTrack = name;
    this._clearTimers();
    if (this.enabled) this._runTrack();
  }

  toggle() {
    this.init();
    if (!this.ctx) return false;
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.musicGain.gain.setTargetAtTime(0.7, this.ctx.currentTime, 0.4);
      this._runTrack();
    } else {
      this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
      this._clearTimers();
    }
    return this.enabled;
  }

  setEnabled(v) {
    this.init();
    if (!this.ctx) return;
    this.enabled = v;
    if (v) { this.musicGain.gain.value = 0.7; this._runTrack(); }
    else { this.musicGain.gain.value = 0; this._clearTimers(); }
  }

  _clearTimers() {
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
  }

  stopTrack(fade = 0.8) {
    this._clearTimers();
    this.currentTrack = null;
    if (!this.ctx || !this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, Math.max(0.04, fade * 0.32));
  }

  _runTrack() {
    this._clearTimers();
    if (!this.enabled || !this.currentTrack) return;
    const tr = TRACKS[this.currentTrack] || TRACKS.forest;
    const beat = 60 / tr.bpm;
    this.step = 0;

    const tick = () => {
      if (!this.enabled) return;
      const s = this.step;
      const bar = Math.floor(s / 8) % tr.chords.length;
      const chord = tr.chords[bar];

      // Ped akoru (her 8 adımda bir)
      if (s % 8 === 0) {
        chord.forEach((f, i) => {
          this._tone({
            freq: f, dur: beat * 7.5, type: 'sine',
            vol: tr.padVol * (i === 0 ? 1.3 : 0.75),
            dest: this.musicGain, attack: 0.6,
            detune: (i % 2 ? 5 : -5)
          });
          this._tone({
            freq: f * 2, dur: beat * 6, type: 'triangle',
            vol: tr.padVol * 0.3, dest: this.musicGain, attack: 0.9
          });
        });
      }

      // Melodi
      if (s % 2 === 0) {
        const mf = tr.melody[(s / 2) % tr.melody.length];
        this._tone({
          freq: mf, dur: beat * 1.6, type: 'triangle',
          vol: tr.melVol, dest: this.musicGain, attack: 0.06,
          filter: { type: 'lowpass', freq: 2400, q: 0.8 }
        });
      }

      // Bas nabzı
      if (tr.pulse && s % 4 === 0) {
        this._tone({
          freq: chord[0] / 2, dur: beat * 1.1, type: 'sine',
          vol: tr.padVol * 1.6, dest: this.musicGain, attack: 0.02
        });
      }

      // Davul
      if (tr.drums) {
        if (s % 4 === 0) {
          this._tone({
            freq: 90, glideTo: 42, dur: 0.22, type: 'sine',
            vol: 0.13, dest: this.musicGain, attack: 0.004
          });
        }
        if (s % 8 === 4) {
          this._noiseMusic(0.14, 0.055, 'highpass', 1800);
        }
        if (tr.aggressive && s % 2 === 1) {
          this._noiseMusic(0.05, 0.018, 'highpass', 6000);
        }
      }

      this.step++;
      this.timers.push(setTimeout(tick, beat * 500));  // yarım vuruş
    };
    tick();
  }

  _noiseMusic(dur, vol, type, freq) {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f); f.connect(g); g.connect(this.musicGain);
    src.start(now); src.stop(now + dur + 0.02);
  }

  /* ======================================================================
     SFX
     ====================================================================== */
  playJump() {
    this.init();
    this._tone({ freq: 300, glideTo: 560, dur: 0.16, type: 'triangle', vol: 0.085, attack: 0.005 });
    this._noise({ dur: 0.08, vol: 0.035, type: 'highpass', freq: 900, sweepTo: 3000 });
  }

  playDoubleJump() {
    this.init();
    this._tone({ freq: 480, glideTo: 880, dur: 0.2, type: 'triangle', vol: 0.08, attack: 0.004 });
    [880, 1174].forEach((f, i) => setTimeout(() =>
      this._tone({ freq: f, dur: 0.16, type: 'sine', vol: 0.05 }), i * 45));
  }

  playLand(power = 1) {
    this.init();
    this._noise({ dur: 0.12 + power * 0.06, vol: 0.05 * power, type: 'lowpass', freq: 1400, sweepTo: 200 });
    this._tone({ freq: 130, glideTo: 60, dur: 0.14, type: 'sine', vol: 0.06 * power, attack: 0.004 });
  }

  playCollect(big = false) {
    this.init();
    const notes = big ? [523, 659, 784, 1047, 1319] : [784, 1047];
    notes.forEach((f, i) => setTimeout(() =>
      this._tone({ freq: f, dur: big ? 0.42 : 0.24, type: 'sine', vol: big ? 0.1 : 0.075 }), i * (big ? 75 : 55)));
  }

  playLifeUp() {
    this.init();
    [392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() =>
      this._tone({ freq: f, dur: 0.5, type: 'triangle', vol: 0.085 }), i * 70));
  }

  playSwing() {
    this.init();
    this._noise({ dur: 0.16, vol: 0.055, type: 'bandpass', freq: 2600, sweepTo: 700, q: 1.6 });
    this._tone({ freq: 700, glideTo: 240, dur: 0.13, type: 'sawtooth', vol: 0.028, attack: 0.004 });
  }

  playHit() {
    this.init();
    this._noise({ dur: 0.11, vol: 0.075, type: 'bandpass', freq: 1500, sweepTo: 400, q: 1 });
    this._tone({ freq: 200, glideTo: 70, dur: 0.13, type: 'square', vol: 0.045, attack: 0.003 });
  }

  playStomp() {
    this.init();
    this._tone({ freq: 340, glideTo: 110, dur: 0.16, type: 'square', vol: 0.06, attack: 0.003 });
    this._noise({ dur: 0.12, vol: 0.05, type: 'lowpass', freq: 2200, sweepTo: 300 });
  }

  /* ---- Yay ---- */
  playBowDraw() {
    this.init();
    // Kirişin gerilme gıcırtısı
    this._noise({ dur: 0.14, vol: 0.028, type: 'bandpass', freq: 500, sweepTo: 1500, q: 3.2 });
    this._tone({ freq: 130, glideTo: 220, dur: 0.13, type: 'triangle', vol: 0.02, attack: 0.02 });
  }

  playBowRelease() {
    this.init();
    // "tvang" — kiriş bırakma
    this._tone({ freq: 520, glideTo: 150, dur: 0.2, type: 'triangle', vol: 0.06, attack: 0.002,
                 filter: { type: 'lowpass', freq: 3000, sweepTo: 700 } });
    this._noise({ dur: 0.13, vol: 0.05, type: 'bandpass', freq: 2400, sweepTo: 600, q: 1.2 });
  }

  playArrowHit() {
    this.init();
    this._noise({ dur: 0.09, vol: 0.06, type: 'bandpass', freq: 2000, sweepTo: 500, q: 1.4 });
    this._tone({ freq: 300, glideTo: 110, dur: 0.1, type: 'square', vol: 0.035, attack: 0.002 });
  }

  playArrowHitWall() {
    this.init();
    this._noise({ dur: 0.07, vol: 0.035, type: 'bandpass', freq: 1200, sweepTo: 340, q: 2 });
    this._tone({ freq: 180, glideTo: 90, dur: 0.08, type: 'triangle', vol: 0.02, attack: 0.002 });
  }

  /* ---- Ejderha Kalkanı ---- */
  playShieldPickup() {
    this.init();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() =>
      this._tone({ freq: f, dur: 0.55, type: 'triangle', vol: 0.055, attack: 0.01 }), i * 75));
    this._tone({ freq: 130.81, dur: 1.1, type: 'sine', vol: 0.045, attack: 0.05 });
  }

  playBlock() {
    this.init();
    // Metalik "klang" + enerji çınlaması
    this._noise({ dur: 0.16, vol: 0.07, type: 'bandpass', freq: 3200, sweepTo: 800, q: 2.2 });
    this._tone({ freq: 880, glideTo: 420, dur: 0.26, type: 'triangle', vol: 0.055, attack: 0.002,
                 filter: { type: 'lowpass', freq: 5000, sweepTo: 1200 } });
    this._tone({ freq: 1760, glideTo: 1320, dur: 0.18, type: 'sine', vol: 0.03, attack: 0.002 });
  }

  playDeflect() {
    this.init();
    [1200, 1600, 2100].forEach((f, i) => setTimeout(() =>
      this._tone({ freq: f, dur: 0.2, type: 'sine', vol: 0.06 }), i * 28));
    this._noise({ dur: 0.1, vol: 0.04, type: 'highpass', freq: 3000 });
  }

  playEnemyDeath() {
    this.init();
    this._tone({ freq: 260, glideTo: 60, dur: 0.35, type: 'sawtooth', vol: 0.05, attack: 0.005,
                 filter: { type: 'lowpass', freq: 1800, sweepTo: 200 } });
    this._noise({ dur: 0.25, vol: 0.05, type: 'lowpass', freq: 1600, sweepTo: 180 });
  }

  playHurt() {
    this.init();
    this._tone({ freq: 380, glideTo: 120, dur: 0.32, type: 'sawtooth', vol: 0.07, attack: 0.004,
                 filter: { type: 'lowpass', freq: 1400, sweepTo: 300 } });
    this._noise({ dur: 0.2, vol: 0.055, type: 'bandpass', freq: 900, sweepTo: 200, q: 0.8 });
  }

  playDeath() {
    this.init();
    [440, 370, 311, 233, 175].forEach((f, i) => setTimeout(() =>
      this._tone({ freq: f, dur: 0.55, type: 'triangle', vol: 0.075 }), i * 110));
  }

  playCheckpoint() {
    this.init();
    [523, 659, 880].forEach((f, i) => setTimeout(() =>
      this._tone({ freq: f, dur: 0.6, type: 'sine', vol: 0.075 }), i * 90));
  }

  playCrumble() {
    this.init();
    this._noise({ dur: 0.4, vol: 0.05, type: 'lowpass', freq: 900, sweepTo: 160 });
  }

  playCast() {
    this.init();
    this._tone({ freq: 180, glideTo: 620, dur: 0.28, type: 'sawtooth', vol: 0.04, attack: 0.02,
                 filter: { type: 'bandpass', freq: 800, sweepTo: 2400, q: 3 } });
  }

  playScreech() {
    this.init();
    this._tone({ freq: 1800, glideTo: 900, dur: 0.22, type: 'sawtooth', vol: 0.03,
                 filter: { type: 'highpass', freq: 1200, q: 2 } });
  }

  /* Kurt çökerken duyulan hırlama: sıçramanın SESLİ uyarısı.
     Görsel hazırlık ekranın dışında kalabiliyor; ses kalmıyor. */
  playGrowl() {
    this.init();
    this._tone({ freq: 92, glideTo: 58, dur: 0.34, type: 'sawtooth', vol: 0.045, attack: 0.05,
                 filter: { type: 'lowpass', freq: 420, sweepTo: 190, q: 4 } });
    this._noise({ dur: 0.3, vol: 0.02, type: 'bandpass', freq: 300, sweepTo: 140, q: 1.4 });
  }

  /* Yarasa dalışa hazırlanırken kanat titremesi */
  playBatFlutter() {
    this.init();
    this._noise({ dur: 0.34, vol: 0.024, type: 'bandpass', freq: 900, sweepTo: 2100, q: 1.1 });
  }

  playPortal() {
    this.init();
    [261, 329, 392, 523, 659, 784].forEach((f, i) => setTimeout(() =>
      this._tone({ freq: f, dur: 1.2, type: 'sine', vol: 0.08 }), i * 85));
    this._noise({ dur: 1.0, vol: 0.03, type: 'bandpass', freq: 400, sweepTo: 4000, q: 2 });
  }

  playVictory() {
    this.init();
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() =>
      this._tone({ freq: f, dur: 1.4, type: 'triangle', vol: 0.09 }), i * 110));
  }

  /* ---- Sinematik atmosferi ---- */
  playWindSwell() {
    this.init();
    this._noise({ dur: 3.6, vol: 0.035, type: 'bandpass', freq: 260, sweepTo: 1900, q: 0.65 });
    this._tone({ freq: 98, glideTo: 147, dur: 3.8, type: 'sine', vol: 0.035, attack: 1.2 });
  }

  playDuskAmbience() {
    this.init();
    [110, 164.81, 220].forEach((freq, index) => this._tone({
      freq,
      dur: 7.5,
      type: index === 0 ? 'sine' : 'triangle',
      vol: index === 0 ? 0.035 : 0.018,
      attack: 1.4,
      filter: { type: 'lowpass', freq: 900 }
    }));
    this._noise({ dur: 5.5, vol: 0.018, type: 'lowpass', freq: 520, sweepTo: 180 });
  }

  playSunsetTheme() {
    this.init();
    const notes = [261.63, 329.63, 392, 523.25, 659.25, 783.99];
    notes.forEach((freq, index) => setTimeout(() => {
      this._tone({ freq, dur: 2.8, type: 'triangle', vol: 0.055, attack: 0.18 });
      this._tone({ freq: freq / 2, dur: 3.4, type: 'sine', vol: 0.026, attack: 0.4 });
    }, index * 240));
  }

  playCineFootstep() {
    this.init();
    this._noise({ dur: 0.13, vol: 0.035, type: 'lowpass', freq: 720, sweepTo: 150 });
    this._tone({ freq: 86, glideTo: 54, dur: 0.16, type: 'sine', vol: 0.035, attack: 0.004 });
  }

  playClothRustle() {
    this.init();
    this._noise({ dur: 0.34, vol: 0.022, type: 'bandpass', freq: 1300, sweepTo: 420, q: 0.7 });
  }

  playWingWhoosh() {
    this.init();
    this._noise({ dur: 1.15, vol: 0.065, type: 'bandpass', freq: 180, sweepTo: 1350, q: 0.5 });
    this._tone({ freq: 62, glideTo: 42, dur: 1.0, type: 'sine', vol: 0.055, attack: 0.08 });
  }

  playHeartbeat() {
    this.init();
    const beat = (vol) => {
      this._tone({ freq: 72, glideTo: 48, dur: 0.18, type: 'sine', vol, attack: 0.004 });
      this._noise({ dur: 0.08, vol: vol * 0.32, type: 'lowpass', freq: 180, sweepTo: 70 });
    };
    beat(0.065);
    setTimeout(() => beat(0.048), 230);
  }

  playHandChime() {
    this.init();
    [523.25, 659.25, 783.99].forEach((freq, index) => setTimeout(() =>
      this._tone({ freq, dur: 0.9, type: 'sine', vol: 0.038, attack: 0.05 }), index * 78));
    this._noise({ dur: 0.42, vol: 0.012, type: 'highpass', freq: 3200, sweepTo: 7200 });
  }

  /* ---- Boss ---- */
  playDragonRoar() {
    this.init();
    this._tone({ freq: 70, glideTo: 130, dur: 1.6, type: 'sawtooth', vol: 0.12, attack: 0.1,
                 filter: { type: 'lowpass', freq: 500, sweepTo: 1400, q: 2 } });
    this._tone({ freq: 48, glideTo: 88, dur: 1.8, type: 'square', vol: 0.09, attack: 0.15,
                 filter: { type: 'lowpass', freq: 300, q: 1 } });
    this._noise({ dur: 1.5, vol: 0.07, type: 'lowpass', freq: 700, sweepTo: 240 });
  }

  playFireball() {
    this.init();
    this._noise({ dur: 0.32, vol: 0.06, type: 'bandpass', freq: 1400, sweepTo: 380, q: 1.4 });
    this._tone({ freq: 220, glideTo: 90, dur: 0.28, type: 'sawtooth', vol: 0.04, attack: 0.006,
                 filter: { type: 'lowpass', freq: 1200, sweepTo: 300 } });
  }

  playBossHit() {
    this.init();
    this._tone({ freq: 160, glideTo: 55, dur: 0.4, type: 'square', vol: 0.09, attack: 0.003 });
    this._noise({ dur: 0.3, vol: 0.08, type: 'bandpass', freq: 2200, sweepTo: 400, q: 0.9 });
    [880, 1174, 1568].forEach((f, i) => setTimeout(() =>
      this._tone({ freq: f, dur: 0.3, type: 'sine', vol: 0.05 }), i * 40));
  }

  playDragonTired() {
    this.init();
    this._tone({ freq: 120, glideTo: 62, dur: 0.9, type: 'sawtooth', vol: 0.055, attack: 0.08,
                 filter: { type: 'lowpass', freq: 600, sweepTo: 200 } });
    this._noise({ dur: 0.8, vol: 0.04, type: 'lowpass', freq: 500, sweepTo: 160 });
  }

  playDragonDeath() {
    this.init();
    this._tone({ freq: 130, glideTo: 34, dur: 2.6, type: 'sawtooth', vol: 0.12, attack: 0.05,
                 filter: { type: 'lowpass', freq: 900, sweepTo: 120, q: 2 } });
    this._noise({ dur: 2.4, vol: 0.09, type: 'lowpass', freq: 1200, sweepTo: 100 });
    setTimeout(() => {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() =>
        this._tone({ freq: f, dur: 1.8, type: 'sine', vol: 0.08 }), i * 130));
    }, 1600);
  }

  playProposalYes() {
    this.init();
    [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() =>
      this._tone({ freq: f, dur: 2.4, type: 'sine', vol: 0.1, dest: this.musicGain }), i * 95));
  }

  playUiClick() {
    this.init();
    this._tone({ freq: 620, glideTo: 880, dur: 0.1, type: 'sine', vol: 0.05 });
  }
}

export const audioManager = new AudioEngine();
