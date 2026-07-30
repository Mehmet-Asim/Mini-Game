/* ==========================================================================
   Oyun Görünümü — HUD, duraklat menüsü, bölüm geçişleri, hikaye açılışları
   ========================================================================== */

import { GameEngine } from '../game/engine.js';
import { LEVELS } from '../game/levels.js';
import { audioManager } from '../audio.js';
import { attachNetDebug } from './netDebug.js';

const LEVEL_TITLES = ['I · Karanlık Orman', 'II · Kale Surları', 'III · Ejderha İni'];

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param opts.mode        'solo' | 'local' | 'net'
 * @param opts.netMode     'host' | 'guest' | null
 * @param opts.localIndex  bu tarayıcıdaki oyuncunun sırası
 * @param opts.names       [hostAdı, misafirAdı]
 * @param opts.session     CoopSession (ağ modunda)
 */
export function renderGameView(container, config, onComplete, opts = {}) {
  const chatEnabled = !!opts.session;
  container.innerHTML = `
    <div class="game-shell">
      <div class="game-frame" id="game-frame">

        <!-- HUD -->
        <div class="hud">
          <div class="hud-left">
            <div class="hud-lives" id="hud-lives"></div>
            <div class="hud-chip">
              <svg viewBox="0 0 24 24" class="hud-icon-heart"><path d="M12 21s-8-5.2-8-10.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3.6C20 15.8 12 21 12 21z"/></svg>
              <span id="hud-hearts">0</span><span class="hud-dim" id="hud-hearts-total"></span>
            </div>
            <div class="hud-chip hud-shield" id="hud-shield">
              <svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/></svg>
              <span>L</span>
            </div>
          </div>
          <div class="hud-right">
            <div class="hud-chip hud-level" id="hud-level">Bölüm I</div>
            ${chatEnabled ? `
            <button class="hud-btn hud-chat-btn" id="btn-chat" aria-label="Sohbeti aç" aria-expanded="false">
              <svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4V4zm4 5h8M8 12h5"/></svg>
              <span class="hud-chat-badge" id="chat-badge"></span>
            </button>` : ''}
            <button class="hud-btn" id="btn-pause" aria-label="Duraklat">
              <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            </button>
          </div>
        </div>

        <!-- Boss can barı -->
        <div class="boss-bar" id="boss-bar">
          <div class="boss-bar-name" id="boss-name">VHAERIX</div>
          <div class="boss-bar-track"><div class="boss-bar-fill" id="boss-fill"></div></div>
        </div>

        <!-- Toast -->
        <div class="toast" id="toast"></div>

        ${chatEnabled ? `
        <section class="game-chat" id="game-chat" aria-label="Oyun içi sohbet">
          <header>
            <strong>YOLDAŞ SOHBETİ</strong>
            <button type="button" id="chat-close" aria-label="Sohbeti kapat">×</button>
          </header>
          <div class="game-chat-messages" id="chat-messages" aria-live="polite"></div>
          <form class="game-chat-form" id="chat-form" autocomplete="off">
            <input id="chat-input" type="text" maxlength="240" enterkeyhint="send"
                   placeholder="Bir mesaj yaz..." aria-label="Mesaj" />
            <button type="submit" aria-label="Gönder">Gönder</button>
          </form>
        </section>` : ''}

        <!-- Bölüm ilerleme -->
        <div class="level-progress" id="level-progress">
          <div class="lp-dot" data-i="0"></div>
          <div class="lp-line"></div>
          <div class="lp-dot" data-i="1"></div>
          <div class="lp-line"></div>
          <div class="lp-dot" data-i="2"></div>
        </div>

        <!-- Kanvas buraya -->
        <div class="canvas-host" id="canvas-host"></div>

        <!-- Mobil kontroller -->
        <div class="touch-layer" id="touch-layer">
          <div class="touch-cluster touch-left">
            <button class="tbtn" id="t-left" aria-label="Sol">
              <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>
            </button>
            <button class="tbtn" id="t-right" aria-label="Sağ">
              <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
          <div class="touch-cluster touch-right">
            <button class="tbtn tbtn-block" id="t-block" aria-label="Siper al">
              <svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/></svg>
            </button>
            <button class="tbtn tbtn-shoot" id="t-shoot" aria-label="Ok at">
              <svg viewBox="0 0 24 24"><path d="M4 20L20 4M20 4h-6M20 4v6M4 20l3-1-2-2z"/></svg>
            </button>
            <button class="tbtn tbtn-attack" id="t-attack" aria-label="Saldır">
              <svg viewBox="0 0 24 24"><path d="M4 20l6-6M14 4l6 6-9 9-3-3z"/></svg>
            </button>
            <button class="tbtn tbtn-jump" id="t-jump" aria-label="Zıpla">
              <svg viewBox="0 0 24 24"><path d="M12 19V6M5 12l7-7 7 7"/></svg>
            </button>
          </div>
        </div>

        <!-- Kaplamalar -->
        <div class="overlay" id="overlay"></div>
      </div>
    </div>
  `;

  const frame = container.querySelector('#game-frame');
  const host = container.querySelector('#canvas-host');
  const overlay = container.querySelector('#overlay');
  const toastEl = container.querySelector('#toast');
  const livesEl = container.querySelector('#hud-lives');
  const heartsEl = container.querySelector('#hud-hearts');
  const heartsTotalEl = container.querySelector('#hud-hearts-total');
  const levelEl = container.querySelector('#hud-level');
  const shieldBadge = container.querySelector('#hud-shield');
  const bossBar = container.querySelector('#boss-bar');
  const bossFill = container.querySelector('#boss-fill');
  const lpDots = [...container.querySelectorAll('.lp-dot')];

  let toastTimer = null;
  let paused = false;
  let offChat = null;

  /* ---------- Co-op göstergesi ----------
     İki karakter varken HUD'un cevaplaması gereken tek soru: "yoldaşım
     ne durumda?" Ortak can zaten solda; buraya yoldaşın adı, rengi ve
     yere serilmişse kaldırma sayacı geliyor. */
  const coop = opts.mode && opts.mode !== 'solo';
  let coopEl = null;
  let lastCoop = null;
  if (coop) {
    coopEl = document.createElement('div');
    coopEl.className = 'hud-coop';
    container.querySelector('.hud-left').appendChild(coopEl);
  }

  /* ---------- Oyun içi sohbet ----------
     Mesaj önce sunucuya gider; gönderen dahil iki tarayıcı da aynı doğrulanmış
     CHAT paketini alınca ekrana basar. */
  if (chatEnabled) {
    const chatEl = container.querySelector('#game-chat');
    const chatBtn = container.querySelector('#btn-chat');
    const chatClose = container.querySelector('#chat-close');
    const chatForm = container.querySelector('#chat-form');
    const chatInput = container.querySelector('#chat-input');
    const chatMessages = container.querySelector('#chat-messages');
    const chatBadge = container.querySelector('#chat-badge');
    let unread = 0;
    let lastSentAt = 0;

    const setChatOpen = (open) => {
      chatEl.classList.toggle('is-open', open);
      chatBtn.setAttribute('aria-expanded', String(open));
      if (open) {
        unread = 0;
        chatBadge.textContent = '';
        chatBadge.classList.remove('show');
        setTimeout(() => chatInput.focus(), 40);
      } else {
        chatInput.blur();
      }
    };

    const appendChat = (message) => {
      const localRole = opts.session.isHost ? 'host' : 'guest';
      const self = message.from === localRole;
      const roleIndex = message.from === 'host' ? 0 : 1;
      const name = opts.names?.[roleIndex] || (self ? 'Sen' : 'Yoldaşın');
      const item = document.createElement('article');
      item.className = `game-chat-message ${self ? 'is-self' : 'is-peer'}`;

      const meta = document.createElement('div');
      meta.className = 'game-chat-meta';
      const who = document.createElement('strong');
      who.textContent = self ? 'Sen' : name;
      const time = document.createElement('time');
      time.textContent = new Date(message.ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      meta.append(who, time);

      const text = document.createElement('p');
      text.textContent = message.text;
      item.append(meta, text);
      chatMessages.appendChild(item);
      while (chatMessages.children.length > 40) chatMessages.firstElementChild.remove();
      chatMessages.scrollTop = chatMessages.scrollHeight;

      if (!chatEl.classList.contains('is-open')) {
        unread = Math.min(99, unread + 1);
        chatBadge.textContent = String(unread);
        chatBadge.classList.add('show');
      }
    };

    chatBtn.addEventListener('click', () => setChatOpen(!chatEl.classList.contains('is-open')));
    chatClose.addEventListener('click', () => setChatOpen(false));
    chatInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); setChatOpen(false); }
    });
    chatForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = chatInput.value.trim();
      const now = Date.now();
      if (!text || now - lastSentAt < 500) return;
      if (opts.session.sendChat(text)) {
        lastSentAt = now;
        chatInput.value = '';
      }
    });
    offChat = opts.session.onChat(appendChat);
  }

  const renderCoop = (c) => {
    if (!coopEl || !c) return;
    const mate = c.players.find(p => p.index !== c.localIndex);
    if (!mate) { coopEl.innerHTML = ''; return; }
    const aura = mate.palette?.aura || '127,216,232';
    const name = mate.name || 'Yoldaşın';

    if (mate.downed) {
      const pct = Math.round((mate.revive || 0) * 100);
      coopEl.className = 'hud-coop is-down';
      coopEl.innerHTML = `
        <span class="hud-coop-dot" style="background: rgba(255,95,122,1)"></span>
        <span class="hud-coop-name">${esc(name)} yerde</span>
        <span class="hud-coop-bar"><i style="width:${pct}%"></i></span>
        <span class="hud-coop-timer">${Math.ceil(mate.downLeft)}s</span>`;
    } else {
      coopEl.className = 'hud-coop';
      coopEl.innerHTML = `
        <span class="hud-coop-dot" style="background: rgba(${aura},1)"></span>
        <span class="hud-coop-name">${esc(name)}</span>`;
    }
  };

  const showToast = (msg, ms = 2600) => {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  };

  const renderLives = (lives, maxLives) => {
    const n = Math.max(lives, maxLives, 3);
    let html = '';
    for (let i = 0; i < n; i++) {
      html += `<svg viewBox="0 0 24 24" class="life ${i < lives ? 'on' : 'off'}">
        <path d="M12 21s-8-5.2-8-10.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3.6C20 15.8 12 21 12 21z"/></svg>`;
    }
    livesEl.innerHTML = html;
  };

  /* ---------- Yerel duraklatma ----------
     Bu tarayıcıdaki insan duraklattığında karşı taraf da durmalı; yoksa
     donmuş karakteri sahada yalnız kalıyor ve ORTAK candan kaybettiriyor.
     Bildirimi motor yapıyor (engine.onHalt → CoopSession), burada sadece
     "bunu ben istedim" demek yeterli. */
  const localPause = () => engine.pause('local');
  const localResume = () => engine.resume('local');

  /* ---------- Motor geri çağrıları ---------- */
  const callbacks = {
    onHud(s) {
      renderLives(s.lives, s.maxLives);
      // Kalkan rozeti + mobil siper butonu
      shieldBadge.classList.toggle('show', !!s.hasShield);
      if (blockBtn) blockBtn.style.display = s.hasShield ? '' : 'none';
      heartsEl.textContent = s.hearts;
      heartsTotalEl.textContent = ` / ${s.totalHearts}`;
      levelEl.textContent = LEVEL_TITLES[s.level] || 'Bölüm';
      lpDots.forEach((d, i) => {
        d.classList.toggle('done', i < s.level);
        d.classList.toggle('active', i === s.level);
      });
      if (s.boss) {
        bossBar.classList.add('show');
        bossFill.style.width = `${(s.boss.hp / s.boss.maxHp) * 100}%`;
      } else {
        bossBar.classList.remove('show');
      }
      lastCoop = s.coop;
      renderCoop(s.coop);
    },

    /* Her karede, fizikten önce — ağ katmanının giriş noktası.
       Misafir burada host'un anlık görüntüsünü dünyaya işliyor. */
    onFrame() {
      opts.session?.applyIncoming();
    },

    /* Her sabit simülasyon adımında: misafirin tuşları host'a gider.
       Zamanlayıcı yerine adıma bağlı olması, host'un işlediği girdi
       dizisinin misafirin tahmininde kullandığıyla birebir aynı olmasını
       sağlıyor (bkz. engine._step → onInputTick). */
    onInputTick(inp) {
      opts.session?.sendInputTick(inp);
    },

    onToast: showToast,

    /* Hatıra kartı — İKİ TARAFTA DA açılır.
       Misafirde bunu tetikleyen şey ağdan gelen `sy` listesi (bkz.
       snapshot.js). Kalbi kim topladıysa toplasın, kart ikisinde de
       çıkar; oyunun asıl anlatısı bu kartlarda. */
    onStory(index) {
      const msgs = config.messages || [];
      const text = msgs[index];
      if (!text) { showToast('Gizli bir hatıra buldun...', 2800); return; }
      showStoryCard(overlay, text, index, () => localResume());
      localPause();
    },

    onBossStart() {
      audioManager.playTrack('boss');
      showBanner(overlay, 'VHAERIX', 'Kızıl Ejderha uyandı', 'boss');
    },

    onDeath(gameOver) {
      if (gameOver) {
        showBanner(overlay, 'YENİLDİN', 'Bölüm baştan başlıyor', 'death');
      } else {
        overlay.classList.add('flash-red');
        setTimeout(() => overlay.classList.remove('flash-red'), 500);
      }
    },

    onLevelComplete(idx, next) {
      const nextIdx = idx + 1;
      opts.session?.setPhase?.('game', nextIdx);
      showLevelTransition(overlay, nextIdx, () => {
        audioManager.playTrack(LEVELS[nextIdx].theme);
        next();
      });
    },

    onGameComplete(stats) {
      showBanner(overlay, 'ZAFER', 'Efsane tamamlandı', 'win');
      setTimeout(() => onComplete(stats), 2400);
    },

    onPause() { togglePause(); }
  };

  const engine = new GameEngine(host, callbacks, {
    mode: opts.mode || 'solo',
    netMode: opts.netMode || null,
    localIndex: opts.localIndex ?? 0,
    names: opts.names || []
  });
  /* attachEngine host'ta oda evresini levelIndex ile günceller — yeniden
     bağlanmada bölüm 0'a çekmesin diye başlangıç bölümü önceden yazılır. */
  engine.levelIndex = Math.min(Math.max(opts.startLevel ?? 0, 0), LEVELS.length - 1);
  opts.session?.attachEngine(engine);
  engine.setAudio(audioManager);

  engine.bindTouch({
    leftBtn: container.querySelector('#t-left'),
    rightBtn: container.querySelector('#t-right'),
    jumpBtn: container.querySelector('#t-jump'),
    attackBtn: container.querySelector('#t-attack'),
    shootBtn: container.querySelector('#t-shoot'),
    blockBtn: container.querySelector('#t-block')
  });

  // Kalkan butonu sadece kalkan toplandığında görünür
  const blockBtn = container.querySelector('#t-block');
  if (blockBtn) blockBtn.style.display = 'none';

  /* ---------- Duraklat ---------- */
  function togglePause() {
    paused = !paused;
    if (paused) {
      localPause();
      showPauseMenu(overlay, {
        onResume: () => { paused = false; overlay.innerHTML = ''; overlay.classList.remove('active'); localResume(); },
        onRestart: () => {
          paused = false; overlay.innerHTML = ''; overlay.classList.remove('active');
          engine.loadLevel(engine.levelIndex); localResume();
        },
        onToggleAudio: () => audioManager.toggle()
      });
    } else {
      overlay.innerHTML = '';
      overlay.classList.remove('active');
      localResume();
    }
  }

  container.querySelector('#btn-pause').addEventListener('click', () => {
    audioManager.playUiClick();
    togglePause();
  });

  /* Tıklanan butonun odağını bırak.
     Odakta kalan buton iki ayrı soruna yol açıyor: tarayıcı Boşluk/Enter'ı
     ona yönlendiriyor (zıplamak duraklatıyor), ve odak yüzünden tuşları
     yok sayan eski koruma karakteri tamamen kilitliyordu. */
  frame.addEventListener('click', (e) => {
    const btn = e.target.closest?.('button');
    if (btn && !btn.closest('.game-chat')) btn.blur();
  });

  // Dokunmatik cihazda kontrolleri göster
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    frame.classList.add('is-touch');
  }

  /* Teşhis paneli — ?debug=1 ile açık gelir, oyun içinde F3 ile açılır. */
  const netDebug = attachNetDebug(frame, engine, opts.session || null);

  const startLevel = engine.levelIndex;
  audioManager.playTrack(LEVELS[startLevel].theme);
  engine.start(startLevel);

  return () => {
    if (toastTimer) clearTimeout(toastTimer);
    offChat?.();
    netDebug.destroy();
    engine.stop();
  };
}

/* ==========================================================================
   Kaplama bileşenleri
   ========================================================================== */

function showBanner(overlay, title, subtitle, kind) {
  overlay.classList.add('active');
  overlay.innerHTML = `
    <div class="banner banner-${kind}">
      <div class="banner-title">${title}</div>
      <div class="banner-sub">${subtitle}</div>
    </div>
  `;
  setTimeout(() => {
    overlay.innerHTML = '';
    overlay.classList.remove('active');
  }, kind === 'boss' ? 2200 : 1800);
}

function showLevelTransition(overlay, nextIdx, done) {
  const lv = LEVELS[nextIdx];
  overlay.classList.add('active', 'solid');
  overlay.innerHTML = `
    <div class="transition">
      <div class="transition-num">BÖLÜM ${['I', 'II', 'III'][nextIdx]}</div>
      <h2 class="transition-name">${lv.name}</h2>
      <p class="transition-sub">${lv.subtitle}</p>
      <div class="transition-bar"><div class="transition-bar-fill"></div></div>
    </div>
  `;
  setTimeout(() => {
    overlay.innerHTML = '';
    overlay.classList.remove('active', 'solid');
    done();
  }, 2600);
}

function showStoryCard(overlay, text, index, done) {
  overlay.classList.add('active', 'solid');
  overlay.innerHTML = `
    <div class="story-card">
      <div class="story-seal">
        <svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-10.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3.6C20 15.8 12 21 12 21z"/></svg>
      </div>
      <div class="story-label">HATIRA ${index + 1}</div>
      <p class="story-text">"${text}"</p>
      <button class="story-btn" id="story-close">Devam Et</button>
    </div>
  `;
  const close = () => {
    overlay.innerHTML = '';
    overlay.classList.remove('active', 'solid');
    done();
  };
  overlay.querySelector('#story-close').addEventListener('click', close);
  setTimeout(close, 7000);
}

function showPauseMenu(overlay, { onResume, onRestart, onToggleAudio }) {
  overlay.classList.add('active', 'solid');
  overlay.innerHTML = `
    <div class="pause-menu">
      <h2 class="pause-title">Duraklatıldı</h2>
      <div class="pause-controls">
        <div class="ctrl-row"><kbd>← →</kbd><span>Hareket</span></div>
        <div class="ctrl-row"><kbd>Boşluk</kbd><span>Zıpla · havada tekrar bas: çift zıplama</span></div>
        <div class="ctrl-row"><kbd>J</kbd><span>Kılıç · mermileri sektirir</span></div>
        <div class="ctrl-row"><kbd>K</kbd><span>Ok at · uzaktaki düşmanlar için</span></div>
        <div class="ctrl-row"><kbd>L</kbd><span>Siper al · Ejderha Kalkanı gerekir (3. bölüm)</span></div>
        <div class="ctrl-row"><kbd>↓</kbd><span>Tahta platformdan aşağı in</span></div>
        <div class="ctrl-row"><kbd>Esc</kbd><span>Duraklat</span></div>
      </div>
      <button class="pause-btn primary" id="p-resume">Devam Et</button>
      <button class="pause-btn" id="p-audio">Müziği Aç / Kapat</button>
      <button class="pause-btn ghost" id="p-restart">Bölümü Yeniden Başlat</button>
    </div>
  `;
  overlay.querySelector('#p-resume').addEventListener('click', onResume);
  overlay.querySelector('#p-restart').addEventListener('click', onRestart);
  overlay.querySelector('#p-audio').addEventListener('click', onToggleAudio);
}
