/* ==========================================================================
   Quest of Legends — Giriş & Yönlendirici

   #setup      → Gizli kurulum paneli (yalnızca teklifi hazırlayan görür)
   ?d=...      → Oyun (karşı taraf sadece orta çağ macera oyunu görür)
   #cine       → Sinematik sahne galerisi (Faz 1 test tezgâhı)
   #cine=intro → Tek sahne, oyundan bağımsız izleme
   ========================================================================== */

import './style.css';
import { audioManager } from './audio.js';
import { renderSetupView, decodeConfigFromURL, roomCodeFromURL } from './views/setupView.js';
import { renderSplashView } from './views/splashView.js';
import { renderGameView } from './views/gameView.js';
import { renderProposalView } from './views/proposalView.js';
import { renderCinematicView } from './views/cinematicView.js';
import { renderCineGalleryView } from './views/cineGalleryView.js';
import { renderLobbyView } from './views/lobbyView.js';

let appConfig = null;
let cleanupFn = null;
let lastStats = null;
let cineSceneId = null;
let cineConfig = null;
/** Co-op oturumu — oda açıldıysa/katılındıysa burada durur */
let net = null;
let session = null;
/** Yeniden bağlanmada oyuna kaldığı bölümden devam etmek için */
let gameStartLevel = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function getCinematicConfig() {
  const base = cineConfig || appConfig || {};
  const unlocked = new Set(lastStats?.story || []);
  return {
    ...base,
    unlockedMemories: (base.messages || []).filter((message, index) => message && unlocked.has(index))
  };
}

/* ---------- Menü arka planı (yalnızca oyun dışı ekranlarda) ---------- */
function initBackground() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];
  let w = 0, h = 0, t = 0;

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  };

  function build() {
    particles = [];
    const n = Math.min(70, Math.round(w / 18));
    for (let i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.6 + 0.5,
        vy: -(Math.random() * 12 + 4),
        vx: (Math.random() - 0.5) * 8,
        p: Math.random() * 6.28,
        gold: Math.random() > 0.18
      });
    }
  }

  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  (function animate(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    ctx.clearRect(0, 0, w, h);

    // Derinlik ışıması
    const g = ctx.createRadialGradient(w / 2, h * 0.42, 20, w / 2, h * 0.42, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(60, 40, 90, 0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(t * 0.6 + p.p) * 10) * dt;
      if (p.y < -20) { p.y = h + 20; p.x = Math.random() * w; }
      const a = 0.18 + Math.sin(t * 1.6 + p.p) * 0.16;
      ctx.fillStyle = p.gold
        ? `rgba(212, 168, 83, ${Math.max(0.04, a)})`
        : `rgba(196, 30, 58, ${Math.max(0.04, a * 0.8)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(animate);
  })(performance.now());
}

/* ---------- Ses butonu ---------- */
function initAudioBtn() {
  const btn = document.getElementById('audio-toggle-btn');
  const on = document.getElementById('icon-on');
  const off = document.getElementById('icon-off');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const playing = audioManager.toggle();
    btn.classList.toggle('playing', playing);
    on.style.display = playing ? '' : 'none';
    off.style.display = playing ? 'none' : '';
  });
}

/* ---------- Yönlendirme ---------- */
function navigateTo(view) {
  const container = document.getElementById('view-container');
  const app = document.getElementById('app');
  if (cleanupFn) { cleanupFn(); cleanupFn = null; }

  app.classList.toggle('in-game', view === 'game' || view === 'cinematic');

  switch (view) {
    case 'setup':
      cleanupFn = renderSetupView(container, {
        onRoomCreated: (client) => { net = client; navigateTo('lobby'); }
      });
      break;

    case 'joining':
      renderJoiningView(container);
      break;

    case 'lobby':
      cleanupFn = renderLobbyView(container, {
        net,
        onStart: async (lobby) => {
          appConfig = net.config || appConfig;
          /* Oturum: motoru ve sinematiği ağa bağlayan katman */
          const { CoopSession } = await import('./net/session.js');
          session?.destroy();
          session = new CoopSession(net, {
            onPeerState: (online) => {
              if (!online) showNetOverlay('Yoldaşının bağlantısı koptu — bekleniyor...');
              else hideNetOverlay();
            },
            /* Yoldaş duraklattığında ekran sebepsiz donmasın. Sessiz donma,
               oyuncuya "oyun bozuldu" hissi veriyordu. */
            onNetPause: (paused) => {
              if (paused) showNetOverlay('Yoldaşın oyunu duraklattı');
              else hideNetOverlay();
            }
          });
          /* Yeniden bağlananlar kaldıkları evreden devam eder; lobide
             takılıp intro'yu baştan izlemek yok. */
          const phase = lobby?.phase;
          if (phase === 'game') {
            gameStartLevel = lobby?.levelIndex ?? 0;
            navigateTo('game');
          } else if (phase === 'outro') {
            cineSceneId = 'outro-ask';
            navigateTo('cinematic');
          } else {
            cineSceneId = 'intro';
            navigateTo('cinematic');
          }
        },
        onCancel: async () => {
          const { clearSession } = await import('./net/client.js');
          clearSession();          /* yoksa sayfa açılışında odaya geri çekiliriz */
          net?.close(); net = null;
          location.href = location.pathname;
        }
      });
      break;

    case 'cine-gallery':
      renderCineGalleryView(container, (sceneId, cfg) => {
        cineSceneId = sceneId;
        cineConfig = cfg;
        navigateTo('cinematic');
      });
      break;

    case 'cinematic': {
      const sceneId = cineSceneId || 'intro';
      /* Teklife SADECE misafir cevap verir. Host'un ekranında kartlar
         görünür ama tıklanamaz — kimse kendi adına "Evet" diyemesin. */
      const canChoose = !session || session.isHost === false;

      const ctrl = renderCinematicView(container, {
        sceneId,
        config: getCinematicConfig(),
        canChoose,
        /* Ağ oyununda atlama yetkisi host'ta; iki taraf ayrı ayrı
           atlarsa sahneler ayrışır. */
        showSkip: !session || session.isHost,
        onChoice: (id) => session?.sendChoice(id),
        onEnd: () => afterCinematic(sceneId, null),
        onSceneChange: (nextId, choice) => afterCinematic(sceneId, nextId, choice)
      });
      session?.attachDirector(ctrl.director);

      /* Host, misafirin cevabını ağdan alıp KENDİ yönetmenine uygular.
         Yoksa host'un sahnesi seçim ekranında sonsuza dek beklerdi:
         cevabı veren o değil. */
      let offChoice = null;
      if (session?.isHost) {
        offChoice = session.onChoice((id) => ctrl.submitChoice(id));
      }

      cleanupFn = () => { offChoice?.(); ctrl(); };
      break;
    }

    case 'proposal-done':
      {
        const finalConfig = getCinematicConfig();
        const memories = finalConfig.unlockedMemories || [];
        const date = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
      container.innerHTML = `
        <div class="proposal-done-pixel" style="--final-art:url('${import.meta.env.BASE_URL}cine/yes-bg.webp')">
          <div class="proposal-done-shade"></div>
          <div class="proposal-done-card">
            <div class="proposal-eyebrow">YENİ MACERA AÇILDI</div>
            <div class="proposal-done-heart">♥</div>
            <h1 class="proposal-done-title">
              ${esc(finalConfig.targetName || '')} <span>&amp;</span> ${esc(finalConfig.heroName || '')}
            </h1>
            <p class="proposal-done-date">${esc(date)}</p>
            <p class="proposal-done-copy">
              Ejderha yenildi. Soru soruldu.<br/>Asıl hikâye şimdi başlıyor.
            </p>
            ${memories.length ? `
              <div class="proposal-done-memories">
                ${memories.map((memory, index) => `
                  <div><b>0${index + 1}</b><span>${esc(memory)}</span></div>
                `).join('')}
              </div>` : ''}
            <div class="proposal-done-rule"></div>
            <p class="proposal-done-stats">${lastStats?.hearts ?? 0} KALP · 3 DİYAR · 1 EJDERHA · 2 YOLCU</p>
          </div>
        </div>`;
      }
      break;

    case 'splash':
      renderSplashView(container, () => navigateTo('game'));
      break;

    case 'game':
      session?.detachDirector();
      cleanupFn = renderGameView(container, appConfig, (stats) => {
        lastStats = stats;
        /* Solo ve co-op aynı sinematik finale girer. Teklif seçimini
           solo'da oyuncu kendisi, co-op'ta yalnızca misafir verir. */
        cineSceneId = 'outro-ask';
        navigateTo('cinematic');
      }, session ? {
        mode: 'net',
        netMode: session.isHost ? 'host' : 'guest',
        localIndex: session.localIndex,
        names: [appConfig?.heroName, appConfig?.targetName],
        startLevel: gameStartLevel,
        session
      } : {});
      gameStartLevel = 0;
      break;
    case 'proposal':
      renderProposalView(container, appConfig, lastStats);
      break;
  }
}

/* ==========================================================================
   Sinematik → sonraki adım

   Akış:  intro → oyun → outro-ask → (seçim) → outro-yes | outro-no

   Seçimi misafir yapıyor ama İKİ TARAFIN da aynı finali görmesi gerek.
   Bu yüzden host, misafirin CHOICE mesajını dinliyor ve kendi ekranını
   ona göre çeviriyor.
   ========================================================================== */
function afterCinematic(sceneId, nextId, choice) {
  if (sceneId === 'intro') { navigateTo('game'); return; }

  if (sceneId === 'outro-ask') {
    /* Cevap yoksa varsayılan "evet"e düşme — teklifi yeniden sor. */
    const resolved = nextId
      || (choice === 'no' ? 'outro-no' : choice === 'yes' ? 'outro-yes' : null);
    if (!resolved) {
      cineSceneId = 'outro-ask';
      navigateTo('cinematic');
      return;
    }
    cineSceneId = resolved;
    navigateTo('cinematic');
    return;
  }

  /* outro-yes / outro-no bittiğinde: kabul edildiyse kutlama ekranı,
     reddedildiyse "tekrar dene". */
  if (sceneId === 'outro-yes') {
    session?.setPhase?.('done');
    navigateTo('proposal-done');
    return;
  }
  if (sceneId === 'outro-no')  { showRewindTransition(); return; }

  navigateTo('proposal');
}

function showRewindTransition() {
  const container = document.getElementById('view-container');
  container.insertAdjacentHTML('beforeend', `
    <div class="cine-rewind-transition">
      <div class="cine-rewind-icon">↶</div>
      <p>Bir can daha...</p>
      <span>Hikâye geri sarılıyor</span>
    </div>`);
  setTimeout(() => {
    cineSceneId = 'outro-ask';
    navigateTo('cinematic');
  }, 1800);
}

/* ---------- Ağ kesintisi kaplaması ---------- */
function showNetOverlay(text) {
  let el = document.getElementById('net-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'net-overlay';
    el.className = 'net-overlay';
    el.innerHTML = `<div class="net-overlay-box">
      <div class="joining-spinner"></div>
      <p id="net-overlay-text"></p>
    </div>`;
    document.getElementById('app').appendChild(el);
  }
  el.querySelector('#net-overlay-text').textContent = text;
  el.classList.add('is-visible');
}

function hideNetOverlay() {
  document.getElementById('net-overlay')?.classList.remove('is-visible');
}

/* ---------- Misafirin "bağlanıyor" ekranı ---------- */
function renderJoiningView(container) {
  container.innerHTML = `
    <div class="glass-panel" style="max-width: 400px; text-align:center;">
      <div class="joining-spinner"></div>
      <h1 class="title-medieval" style="font-size:1.25rem;margin-top:16px;">Maceraya Katılıyorsun</h1>
      <p class="subtitle" style="margin-top:10px;">Yoldaşının odası aranıyor...</p>
      <p class="setup-note" id="joining-note"></p>
    </div>`;
}

/* ---------- Adres çözümleme ---------- */
async function routeFromLocation() {
  const hash = window.location.hash;

  /* Sinematik: #cine veya #cine=intro */
  if (hash === '#cine' || hash.startsWith('#cine=')) {
    const id = hash.startsWith('#cine=') ? hash.slice(6) : null;
    if (id) {
      cineSceneId = id;
      cineConfig = cineConfig || decodeConfigFromURL() || {
        heroName: 'Kahraman', targetName: 'Yolcu', proposalText: 'Benimle çıkar mısın?'
      };
      navigateTo('cinematic');
    } else {
      navigateTo('cine-gallery');
    }
    return;
  }

  if (hash === '#setup') {
    /* Kurulum bilinçli açıldıysa eski odaya geri çekme — aksi halde
       "ODA AÇILIYOR / Maceraya Katılıyorsun" ekranında takılı kalınıyordu. */
    navigateTo('setup');
    return;
  }

  /* Sayfa yenilendiyse ve bu sekmenin açık bir odası varsa (host dahil)
     odaya sessizce geri dön. Eskiden host yenileyince kurulum ekranına
     düşüyor, oda sahipsiz kalıyor ve misafir oyunda tek başına donuyordu. */
  const roomCode = roomCodeFromURL();
  if (!roomCode && !net && !hash) {
    const { loadSession, clearSession } = await import('./net/client.js');
    const saved = loadSession();
    if (saved?.room && saved?.token) {
      navigateTo('joining');
      try {
        const { NetClient } = await import('./net/client.js');
        net = new NetClient();
        await net.connect();
        const resumed = await net.waitResume();
        if (net.room === saved.room && resumed?.phase !== 'done') {
          appConfig = net.config || appConfig;
          navigateTo('lobby');
          return;
        }
        /* Macera bitmiş ya da oda ölmüş — normal akışa dön */
        clearSession();
        net.close(); net = null;
      } catch {
        const { clearSession } = await import('./net/client.js');
        clearSession();
        net?.close(); net = null;
      }
    }
  }

  if (roomCode) {
    if (net?.room === roomCode) { navigateTo('lobby'); return; }
    navigateTo('joining');
    try {
      const { NetClient } = await import('./net/client.js');
      net = new NetClient();
      await net.connect();
      /* Sayfa yenilenmişse bağlantı açılırken kayıtlı token'la RESUME
         gönderilir ve koltuk geri alınır. Bunu beklemeden JOIN atarsak
         kendi koltuğumuza "oda dolu" diye toslarız — eskiden misafir
         burada hata kartına saplanıp oyuna hiç giremiyordu. */
      await net.waitResume();
      const joined = net.room === roomCode
        ? { config: net.config }
        : await net.joinRoom(roomCode).catch((err) => {
            if (net.room === roomCode) return { config: net.config };
            throw err;
          });
      appConfig = joined.config || null;
      navigateTo('lobby');
    } catch (err) {
      const note = document.getElementById('joining-note');
      if (note) {
        note.className = 'setup-note is-warn';
        note.textContent = err.code === 'ROOM_FULL'
          ? 'Bu odada zaten iki kişi var.'
          : err.code === 'ROOM_NOT_FOUND'
            ? 'Oda bulunamadı. Link eskimiş olabilir — yoldaşından yenisini iste.'
            : 'Sunucuya ulaşılamadı. Biraz sonra tekrar dene.';
      }
    }
    return;
  }

  /* Tek kişilik yedek link: ?d=base64 */
  const decoded = decodeConfigFromURL();
  if (decoded) {
    appConfig = decoded;
    navigateTo('splash');
  } else {
    navigateTo('setup');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initBackground();
  initAudioBtn();
  routeFromLocation();
});

window.addEventListener('hashchange', routeFromLocation);
