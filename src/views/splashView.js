/* ==========================================================================
   Açılış Ekranı — gerçek bir oyun menüsü gibi
   ========================================================================== */

import { audioManager } from '../audio.js';

export function renderSplashView(container, onPlay) {
  container.innerHTML = `
    <div class="splash">
      <div class="splash-crest">
        <svg viewBox="0 0 64 64" class="crest-svg">
          <path class="crest-shield" d="M32 4 L56 12 V32 C56 46 44 56 32 60 C20 56 8 46 8 32 V12 Z"/>
          <path class="crest-sword" d="M32 16 L35 22 V40 L32 46 L29 40 V22 Z"/>
          <path class="crest-guard" d="M23 24 H41"/>
          <circle class="crest-gem" cx="32" cy="14" r="2.6"/>
        </svg>
      </div>

      <h1 class="splash-title">Quest of Legends</h1>
      <div class="splash-rule"><span></span><i></i><span></span></div>
      <p class="splash-tag">
        Karanlık ormanı aş. Surları tırman.<br/>Ejderhayı alt et.
      </p>

      <button class="play-btn" id="btn-play">
        <span class="play-btn-glow"></span>
        <span class="play-btn-label">MACERAYA BAŞLA</span>
      </button>

      <div class="splash-controls">
        <div class="sc-item"><kbd>← →</kbd><span>Hareket</span></div>
        <div class="sc-item"><kbd>Boşluk</kbd><span>Zıpla ×2</span></div>
        <div class="sc-item"><kbd>J</kbd><span>Kılıç</span></div>
      </div>

      <div class="splash-meta">3 Bölüm · Boss Savaşı · Gizli Hatıralar</div>
    </div>
  `;

  const btn = container.querySelector('#btn-play');
  btn.addEventListener('click', () => {
    audioManager.init();
    audioManager.setEnabled(true);
    audioManager.playUiClick();

    // Ses butonunu senkronla
    const ab = document.getElementById('audio-toggle-btn');
    if (ab) {
      ab.classList.add('playing');
      const on = document.getElementById('icon-on');
      const off = document.getElementById('icon-off');
      if (on) on.style.display = '';
      if (off) off.style.display = 'none';
    }

    btn.classList.add('pressed');
    container.querySelector('.splash').classList.add('leaving');
    setTimeout(onPlay, 420);
  });
}
