/* ==========================================================================
   Ticker — arka plandaki sekmede DURMAYAN kare kaynağı

   SORUN
   Tarayıcı, arka plandaki sekmede `requestAnimationFrame`'i tamamen
   durdurur. Tek kişilik oyunda bu doğru davranış: kimse bakmıyorsa
   hesaplamaya gerek yok. Ama co-op'ta yetkili simülasyonu host yürütüyor.
   Host sekmesi arkaya düştüğü an dünya duruyor: misafirin girdileri
   işlenmiyor, anlık görüntü üretilmiyor. Misafir kendi ekranında
   yürümeye devam ediyor ama yetkili dünyada hiç kımıldamıyor — kalp
   toplayamıyor, düşmanlar onu görmüyor. Sekmeye dönülünce yetkili konum
   geri geliyor ve misafir "sıfırlanmış" görünüyor.

   Bu bir görsel sorun değil, SİMÜLASYON sorunu.

   ÇÖZÜM
   Çizim ile simülasyonun kare kaynağını ayırmak:

     görünürken   → requestAnimationFrame  (ekranla senkron, pürüzsüz)
     gizliyken    → Web Worker içinde setInterval

   Worker'daki zamanlayıcılar kısılmaz. Ana iş parçacığı arka plandayken
   de mesaj işleyicilerini çalıştırdığı için simülasyon 60 Hz dönmeye
   devam eder; sadece çizim atlanır (zaten kimse bakmıyor).

   DENENİP VAZGEÇİLENLER
   · Ana iş parçacığında `setInterval`: arka planda saniyede bire kısılıyor.
   · Sekme gizlenince oyunu duraklatmak: iki sekmeyle test etmeyi imkânsız
     kılıyor ve gerçek oyunda da biri pencereye bakmadığında oyunu
     donduruyor. Semptomu gizliyor, sebebi çözmüyor.
   ========================================================================== */

const STEP_MS = 1000 / 60;

/* Worker kaynağı — ayrı dosya yerine Blob, derleme yapılandırmasına
   dokunmamak için. İçinde oyun kodu yok, sadece bir zamanlayıcı. */
const WORKER_SRC = `
let id = null;
onmessage = (e) => {
  if (e.data === 'start') {
    if (id !== null) return;
    id = setInterval(() => postMessage(0), ${STEP_MS});
  } else {
    clearInterval(id);
    id = null;
  }
};`;

function makeWorker() {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    return w;
  } catch {
    return null;   // güvenlik politikası engelliyorsa yedeğe düşeriz
  }
}

/**
 * @param onTick(nowMs, visible) her karede çağrılır
 * @returns { start(), stop(), get visible() }
 */
export function createTicker(onTick) {
  let running = false;
  let rafId = null;
  let worker = null;
  let fallbackId = null;
  let mode = null;          // 'raf' | 'worker' | 'timeout'

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const hidden = () => typeof document !== 'undefined' && document.hidden === true;

  const fire = () => { if (running) onTick(now(), !hidden()); };

  function stopDriver() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (worker) { worker.postMessage('stop'); worker.onmessage = null; worker.terminate(); worker = null; }
    if (fallbackId !== null) { clearInterval(fallbackId); fallbackId = null; }
    mode = null;
  }

  function startDriver() {
    const want = hidden() ? 'background' : 'raf';
    if (want === 'raf' && mode === 'raf') return;
    if (want === 'background' && (mode === 'worker' || mode === 'timeout')) return;

    stopDriver();

    if (want === 'raf') {
      mode = 'raf';
      const loop = () => {
        if (!running || mode !== 'raf') return;
        fire();
        if (running && mode === 'raf') rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
      return;
    }

    worker = makeWorker();
    if (worker) {
      mode = 'worker';
      worker.onmessage = fire;
      worker.postMessage('start');
      return;
    }

    /* Worker kurulamadı (eski tarayıcı, katı CSP). Kısılmış da olsa
       çalışan bir zamanlayıcı, hiç çalışmamasından iyidir. */
    mode = 'timeout';
    fallbackId = setInterval(fire, STEP_MS);
  }

  const onVisibility = () => { if (running) startDriver(); };

  return {
    start() {
      if (running) return;
      running = true;
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibility);
      }
      startDriver();
    },
    stop() {
      running = false;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      stopDriver();
    },
    get mode() { return mode; }
  };
}
