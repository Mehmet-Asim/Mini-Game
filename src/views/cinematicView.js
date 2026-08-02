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
import { audioManager, MUSIC } from '../audio.js';
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

  /* SAHNE MÜZİĞİ
     Giriş ve final animasyonlarının kendi parçaları var. Final, `outro-ask`
     ile başlayıp seçim sonrası sahnelerde AKMAYA DEVAM EDİYOR: her sahnede
     baştan başlatmak, teklifin en can alıcı anında müziği kesip yeniden
     kurardı (aynı parça çalıyorsa playMusicFile dokunmuyor). */
  if (sceneId.startsWith('outro-')) audioManager.playMusicFile(MUSIC.finale.url, MUSIC.finale.start);
  else if (sceneId === 'intro') audioManager.playMusicFile(MUSIC.intro.url, MUSIC.intro.start);

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
  /* ---------- Varlık yüklemesi ----------
     Arka plan ve sprite'lar ilk kareden önce hazır olsun; yükleme hatasında
     hybrid katmanlar prosedürel çizime düşer ve sahne yine başlar.

     CO-OP'TA YÜKLEME ORTAK BİR BEKLEMEDİR. Eskiden bu tamamen sessizdi:
     yavaş bağlanan taraf yüklerken host sahne saatini 4 Hz yayınlamayı
     sürdürüyor, misafir `syncTo` ile ona kilitleniyordu. Yükleme bitip
     döngü başladığında yönetmen çoktan host'un zamanındaydı — yani yavaş
     taraf sahnenin İLK SANİYELERİNİ hiç görmüyordu. 10 Mbps'lik bir hatta
     sprite yüklemesi ölçümle 3.2 sn; teklif sahnesinin başı tam o kadar.

     `onLoadingChange` bunu dışarı bildiriyor; main.js onu
     `session.holdScene()`e bağlıyor ve iki taraf da aynı yerden başlıyor. */
  let loading = true;
  let onLoading = null;

  function setLoading(v) {
    if (loading === !!v) return;
    loading = !!v;
    onLoading?.(loading);
  }

  /* GÜVENLİK SÜRESİ — takılı bir istek iki oyuncuyu birden kilitlemesin.
     `preloadScene`/`preloadPixelSprites` hata durumunda çözülüyor ama
     ASILI KALAN bir istek (hat kopmuş, cevap hiç gelmiyor) hiç
     çözülmüyor. O hâlde beklemeyi bırakıp sahneyi başlatıyoruz: eksik
     sprite prosedürel yedeğe düşer, sonsuza dek donmuş bir sahneden
     kat kat iyidir. */
  const loadGuard = setTimeout(() => {
    if (!loading) return;
    console.warn('[cinematic] varlık yüklemesi 12 sn sürdü, sahne yine de başlıyor');
    setLoading(false);
    startLoop();
  }, 12000);

  Promise.all([preloadScene(scene), preloadPixelSprites()]).finally(() => {
    clearTimeout(loadGuard);
    setLoading(false);
    startLoop();
  });

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
      /* `loading` şartı ŞART. Bu fonksiyon her SCENE paketinde (saniyede 4)
         `netHold=false` ile çağrılıyor; eski hâlinde varlıklar henüz
         gelmemişken döngüyü başlatıyor ve sahne prosedürel yedekle
         çiziliyordu. Yüklemenin bitişi zaten kendi `startLoop`unu çağırıyor. */
      if (!director.ended && !loading) startLoop();
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
    /* BEKLETMEYİ MUTLAKA BIRAK. Sahne yükleme bitmeden kapanabiliyor
       (host atladı, sahne değişti, oyuncu çıktı). Bırakmazsak karşı taraf
       bizim yüzümüzden sonsuza dek beklemede kalırdı. */
    clearTimeout(loadGuard);
    setLoading(false);
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
  /**
   * Varlık yüklemesi başlayınca/bitince haber ver — co-op'ta karşı taraf
   * beklesin diye. Kaydolurken yükleme çoktan bittiyse hiç çağrılmaz;
   * bekletecek bir şey yoktur.
   */
  cleanup.onLoadingChange = (fn) => {
    onLoading = fn;
    if (loading) fn(true);
  };
  /** Karşı taraf sahneyi bitirdi — biz de kapatalım (co-op senkronu) */
  cleanup.finish = () => director.finish();
  return cleanup;
}
