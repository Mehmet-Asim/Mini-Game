/* ==========================================================================
   Sinematik Görünümü

   Sahne motorunu ekrana bağlayan katman. Oyundan tamamen bağımsız:
   #cine=intro adresinden tek başına izlenebilir.

   Co-op'a hazırlık olarak iki kanca bırakıldı:
     opts.canChoose   → bu tarayıcı karar verebilir mi (misafir: evet, host: hayır)
     opts.onTime(t)   → her karede sahne zamanı (host bunu yayınlayacak)
     ctrl.syncTo(t)   → uzak saate kilitlen (misafir bunu çağıracak)
   ========================================================================== */

import { Stage } from '../cinematic/stage.js';
import { Director } from '../cinematic/director.js';
import { composite, preloadScene } from '../cinematic/layers.js';
import { CardLayer } from '../cinematic/cards.js';
import { ChoiceLayer } from '../cinematic/choice.js';
import { getScene, sceneAfterChoice } from '../cinematic/scenes/index.js';
import { preloadPixelSprites } from '../cinematic/art/pixelSprites.js';
import { audioManager } from '../audio.js';
import { S } from '../cinematic/script.js';
import { createTicker } from '../core/ticker.js';

export function renderCinematicView(container, opts = {}) {
  const sceneId = opts.sceneId || 'intro';
  const scene = getScene(sceneId);

  if (!scene) {
    container.innerHTML = `<div class="glass-panel"><p>Sahne bulunamadı: ${sceneId}</p></div>`;
    return () => {};
  }

  const config = opts.config || {};
  const canChoose = opts.canChoose !== false;
  const showSkip = opts.showSkip !== false;

  container.innerHTML = `
    <div class="cine-shell">
      <div class="cine-frame" id="cine-frame">
        <canvas id="cine-canvas"></canvas>

        <div class="cine-overlay" id="cine-overlay"></div>

        <div class="cine-ui">
          ${showSkip ? `
            <button class="cine-skip" id="cine-skip" type="button">
              <span>Atla</span>
              <svg viewBox="0 0 24 24"><path d="M5 5l8 7-8 7z"/><path d="M15 5v14"/></svg>
            </button>` : ''}
          <div class="cine-progress"><div class="cine-progress-fill" id="cine-progress"></div></div>
        </div>

        <div class="cine-end" id="cine-end"></div>
      </div>
    </div>
  `;

  const frame = container.querySelector('#cine-frame');
  const canvas = container.querySelector('#cine-canvas');
  const overlay = container.querySelector('#cine-overlay');
  const endEl = container.querySelector('#cine-end');
  const skipBtn = container.querySelector('#cine-skip');
  const progressEl = container.querySelector('#cine-progress');

  const stage = new Stage(canvas);
  const cardLayer = new CardLayer(overlay);
  const choiceLayer = new ChoiceLayer(overlay, (id) => director.submitChoice(id));

  let ticker = null;
  let last = 0;
  let destroyed = false;

  const director = new Director(scene, {
    config,
    onCue: (cue) => playCue(cue.sfx),
    onChoice: (id) => {
      if (opts.onChoice) opts.onChoice(id);
    },
    onEnd: (info) => handleEnd(info)
  });

  /* ---------- Ölçüleme ---------- */
  const resize = () => {
    const r = frame.getBoundingClientRect();
    stage.resize(Math.max(1, r.width), Math.max(1, r.height));
  };
  const ro = new ResizeObserver(resize);
  ro.observe(frame);
  resize();

  /* ---------- Ses ----------
     Sahneler soyut işaret adları verir ("dragonWake"); burada mevcut
     audioManager metotlarına eşleniyor. Karşılığı olmayanlar (rüzgâr, ambiyans,
     tema müzikleri) henüz yok — null bırakıldı, sessizce geçiliyor.
     Yeni ses eklendiğinde SADECE bu tablo güncellenecek, sahneler değil. */
  const CUE_MAP = {
    windSwell:      'playWindSwell',
    stopStep:       'playLand',
    nameChime:      'playCheckpoint',
    dragonRoarFar:  'playDragonRoar',
    duskAmbience:   'playDuskAmbience',
    kneel:          'playLand',
    questionChime:  'playPortal',
    sunsetTheme:    'playSunsetTheme',
    closeTheme:     'playVictory',
    cineFootstep:   'playCineFootstep',
    clothRustle:    'playClothRustle',
    wingWhoosh:     'playWingWhoosh',
    heartbeat:      'playHeartbeat',
    handChime:      'playHandChime',
    rumble:         'playBossHit',
    dragonWake:     'playScreech',
    dragonRoar:     'playDragonRoar',
    chomp:          'playDragonDeath'
  };

  if (sceneId.startsWith('outro-')) audioManager.stopTrack(1.2);

  function playCue(name) {
    if (!name || !audioManager) return;
    const method = Object.prototype.hasOwnProperty.call(CUE_MAP, name) ? CUE_MAP[name] : name;
    if (!method) return;
    const fn = audioManager[method];
    if (typeof fn !== 'function') return;
    try { fn.call(audioManager); } catch { /* ses hatası sahneyi durdurmaz */ }
  }

  /* ---------- Ana döngü ----------
     Kare kaynağı ticker: gizli sekmede rAF durur ama sahne saati DURMAMALI.
     Host'un saati donunca misafir donmuş bir zamana kilitleniyor, sahne
     takılıyor ve `syncTo` geri sardığı için başa dönüyordu. */
  function loop(now, visible = true) {
    if (destroyed) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;

    director.update(dt);

    /* Sahne saati yayını (host) burada da sürsün — çizim atlansa bile
       misafir doğru zamanı almalı. */
    if (opts.onTime) opts.onTime(director.time, director.awaitingChoice);
    if (director.ended) { stopLoop(); return; }
    if (!visible) return;                    // hesap döndü, çizime gerek yok

    const state = director.evaluate();

    stage.begin(scene.clear || '#05070d');
    composite(stage, scene, state);
    stage.vignette(scene.vignette ?? 0.6);
    if (scene.tint) stage.tint(scene.tint);
    if (scene.grain !== false) stage.grain(state.t, 0.018);
    stage.letterbox(scene.letterbox === false ? 0 : 1);
    if (state.flash > 0.001) stage.fade(state.flash, state.flashColor);
    if (state.fadeAlpha > 0.001) stage.fade(state.fadeAlpha, state.fadeColor);

    cardLayer.render(state.cards);
    choiceLayer.render(state.choice, { canChoose });

    progressEl.style.transform = `scaleX(${state.progress.toFixed(4)})`;
    if (skipBtn) skipBtn.style.opacity = director.awaitingChoice ? '0' : '';
  }

  /* Sahne bittiğinde döngü durur — bitmiş bir sahne sonsuza dek kare
     yakmaya devam etmemeli. */
  function stopLoop() {
    ticker?.stop();
    ticker = null;
  }

  function startLoop() {
    if (ticker || destroyed) return;
    last = performance.now();
    ticker = createTicker((now, visible) => loop(now, visible));
    ticker.start();
  }
  /* Arka plan ve sprite'lar ilk kareden önce hazır olsun; yükleme hatasında
     hybrid katmanlar prosedürel çizime düşer ve sahne yine başlar. */
  Promise.all([preloadScene(scene), preloadPixelSprites()]).finally(startLoop);

  /* ---------- Bekleme ----------
     Sekme gizlenince sahneyi DURDURMUYORUZ.

     Bir tur bunu denedim ve daha kötü oldu: iki sekmeyle test etmek
     imkânsızlaştı, sekme değiştirince sahne donuyor ve "atla" tuşu
     çalışmıyor gibi görünüyordu (host beklemedeyken misafir saati komple
     yok sayıyordu). Semptomu gizleyip sebebi çözmeyen bir yamaydı.

     Gerçek sebep, gizli sekmede rAF'in durmasıydı — o da artık
     `createTicker` ile çözüldü: saat Worker zamanlayıcısıyla dönmeye
     devam ediyor, sadece çizim atlanıyor.

     `netHold` yine de duruyor çünkü geçerli bir kullanımı var: karşı
     taraf gerçekten beklediğini bildirirse (ileride "duraklat" gibi)
     sahne bekler. Görünürlükle tetiklenmiyor. */
  let netHold = false;

  function applyHold() {
    director.playing = !netHold;
    frame.classList.toggle('is-held', netHold);
    if (!netHold) {
      last = performance.now();
      if (!director.ended) startLoop();
    }
  }

  /* ---------- Atla ---------- */
  function doSkip() {
    if (director.awaitingChoice) return;
    /* Ağ oyununda zamanı host yönetiyor. Misafir doğrudan atlarsa iki
       sahne ayrışır; bu yüzden isteği host'a yolluyor ve host atlayınca
       yeni zaman normal senkronla geri geliyor. */
    if (opts.onSkipRequest) opts.onSkipRequest();
    else director.skip();
  }

  if (skipBtn) skipBtn.addEventListener('click', doSkip);

  const onKey = (e) => {
    if (e.code === 'Escape' && showSkip) doSkip();
  };
  window.addEventListener('keydown', onKey);

  /* ---------- Bitiş ---------- */
  function handleEnd(info) {
    cardLayer.clear();
    choiceLayer.clear();

    /* Sahne bir seçimle bittiyse ilgili finale geç */
    if (scene.choice && info.choice) {
      const nextId = sceneAfterChoice(info.choice);
      if (opts.onSceneChange) { opts.onSceneChange(nextId, info.choice); return; }
      /* Kendi başına çalışıyorsa sahneyi yerinde değiştir */
      cleanup(true);
      renderCinematicView(container, { ...opts, sceneId: nextId });
      return;
    }

    /* Seçimli sahnede cevap yokken bitiş — teklifi varsayılanla geçme */
    if (scene.choice && !info.choice) {
      director.time = scene.choice.t;
      director.awaitingChoice = true;
      director.ended = false;
      director.playing = true;
      startLoop();
      return;
    }

    if (opts.onEnd) { opts.onEnd(info); return; }

    /* Bağımsız izleme modunda kapanış paneli */
    showEndPanel(info);
  }

  function showEndPanel() {
    const isNo = sceneId === 'outro-no';
    endEl.innerHTML = `
      <div class="cine-end-inner">
        <p class="cine-end-title">${isNo ? S.no.c4 : 'Sahne bitti'}</p>
        <div class="cine-end-actions">
          <button class="cine-end-btn" id="cine-replay">${isNo ? S.no.retry : 'Tekrar izle'}</button>
        </div>
      </div>`;
    endEl.classList.add('is-visible');
    endEl.querySelector('#cine-replay').addEventListener('click', () => {
      endEl.classList.remove('is-visible');
      endEl.innerHTML = '';
      director.reset();
      startLoop();          // döngü bitişte durduruldu, yeniden başlat
    });
  }

  /* ---------- Temizlik ---------- */
  function cleanup(soft = false) {
    if (destroyed) return;
    destroyed = true;
    stopLoop();
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    cardLayer.clear();
    choiceLayer.clear();
    if (!soft) container.innerHTML = '';
  }

  /* Dışarıya kontrol arayüzü — co-op senkronu buradan bağlanacak */
  cleanup.director = director;
  cleanup.seek = (t) => director.seek(t);
  cleanup.syncTo = (t) => director.syncTo(t);
  cleanup.submitChoice = (id) => director.submitChoice(id);
  /** Karşı taraf bekletti / devam etti */
  cleanup.setNetHold = (v) => { netHold = !!v; applyHold(); };
  return cleanup;
}
