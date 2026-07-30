/* ==========================================================================
   Teklif Ekranı — sürpriz + kaçamayan "Hayır"
   ========================================================================== */

import { audioManager } from '../audio.js';

const OBSTACLES = [
  { icon: '🐉', title: 'Ejderha Saldırıyor!', text: '"Hayır" butonunu ejderha yaktı. Tekrar dene.', dismiss: 'Dumanı dağıt' },
  { icon: '🧙‍♂️', title: 'Büyücü Engeli!', text: 'Büyücü bu butonu büyüledi. Artık çalışmıyor.', dismiss: 'Büyüyü kır' },
  { icon: '🏰', title: 'Kale Kapısı Kapandı!', text: 'Bu yol kapatıldı. Başka bir seçenek dene.', dismiss: 'Geri çekil' },
  { icon: '⚔️', title: 'Şövalye Düellosu!', text: 'Bir şövalye bu butonu savunuyor. Geçemezsin.', dismiss: 'Geri adım at' },
  { icon: '👑', title: 'Kral Fermanı!', text: '"Hayır" seçeneği kraliyet fermanıyla yasaklandı.', dismiss: 'Kabul et' }
];

export function renderProposalView(container, config, stats) {
  let obstacleIdx = 0;
  const hearts = stats?.hearts ?? 0;

  container.innerHTML = `
    <div class="glass-panel proposal-card" id="proposal-box" style="opacity:0; transform:scale(0.95); transition: all 0.9s cubic-bezier(0.16,1,0.3,1);">
      <div class="proposal-eyebrow">GİZLİ MESAJ AÇILDI</div>

      <h1 class="title-medieval" style="font-size: 1.9rem; margin-bottom: 14px;">${esc(config.targetName)}</h1>

      <div class="proposal-stats">
        <div class="pstat">
          <svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-10.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3.6C20 15.8 12 21 12 21z"/></svg>
          <b>${hearts}</b> kalp
        </div>
        <div class="pstat">⚔ <b>3</b> bölüm</div>
        <div class="pstat">🐉 ejderha yenildi</div>
      </div>

      <p style="color: var(--text-dim); font-size: 0.92rem; margin-bottom: 24px; line-height: 1.65;">
        Bu macera baştan sona senin için hazırlandı.
      </p>

      <div class="proposal-question">"${esc(config.proposalText)}"</div>
      <div class="proposal-from">— ${esc(config.heroName)}</div>

      <div class="proposal-actions" id="actions-area">
        <button class="btn-yes" id="btn-yes">EVET</button>
        <button class="btn-no" id="btn-no"><span>Hayır</span></button>
      </div>
    </div>
  `;

  const box = container.querySelector('#proposal-box');
  requestAnimationFrame(() => {
    setTimeout(() => { box.style.opacity = '1'; box.style.transform = 'scale(1)'; }, 150);
  });

  const actionsArea = container.querySelector('#actions-area');
  const btnYes = container.querySelector('#btn-yes');
  const noBtn = container.querySelector('#btn-no');

  const handleYes = () => {
    audioManager.playProposalYes();
    showCelebration(box, config, hearts);
    spawnConfetti();
  };

  const handleNo = (e) => {
    if (e) e.preventDefault();
    audioManager.playUiClick();

    if (obstacleIdx >= OBSTACLES.length) {
      noBtn.innerHTML = '<span>EVET</span>';
      noBtn.style.cssText += `
        background: linear-gradient(135deg, rgba(212,168,83,0.22), rgba(212,168,83,0.06));
        color: var(--gold-lt); border-color: var(--gold);
        font-size: 1rem; letter-spacing: 2px; padding: 14px 32px;`;
      noBtn.removeEventListener('click', handleNo);
      noBtn.addEventListener('click', handleYes);
      return;
    }

    const obs = OBSTACLES[obstacleIdx];
    obstacleIdx++;

    const popup = document.createElement('div');
    popup.className = 'obstacle-popup';
    popup.innerHTML = `
      <div class="obstacle-icon">${obs.icon}</div>
      <div class="obstacle-text">
        <strong style="display:block;margin-bottom:6px;color:var(--gold);font-size:1.05rem;">${obs.title}</strong>
        ${obs.text}
      </div>
      <button class="obstacle-dismiss">${obs.dismiss}</button>
    `;
    box.style.position = 'relative';
    box.appendChild(popup);

    popup.querySelector('.obstacle-dismiss').addEventListener('click', () => {
      popup.style.opacity = '0';
      setTimeout(() => {
        popup.remove();
        const areaRect = actionsArea.getBoundingClientRect();
        const r = noBtn.getBoundingClientRect();
        const maxX = Math.max(10, areaRect.width - r.width - 10);
        const maxY = Math.max(10, areaRect.height - r.height - 10);
        noBtn.style.position = 'absolute';
        noBtn.style.left = `${Math.random() * maxX}px`;
        noBtn.style.top = `${Math.random() * maxY}px`;
        noBtn.style.fontSize = `${Math.max(0.65, 0.86 - obstacleIdx * 0.04)}rem`;
        noBtn.style.opacity = `${Math.max(0.35, 1 - obstacleIdx * 0.13)}`;
      }, 300);
    });
  };

  noBtn.addEventListener('click', handleNo);
  btnYes.addEventListener('click', handleYes);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showCelebration(box, config, hearts) {
  const now = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  const msgs = config.messages || [];

  box.innerHTML = `
    <div class="celebration">
      <div class="celebration-crown">
        <svg viewBox="0 0 24 24"><path d="M3 8l4 4 5-7 5 7 4-4v10H3z"/><circle cx="12" cy="3" r="1.4"/></svg>
      </div>
      <h1 class="celebration-title">${esc(config.heroName)} &amp; ${esc(config.targetName)}</h1>
      <p class="celebration-date">${now}</p>

      <div class="memory-card">
        <p class="memory-quote">"${esc(config.proposalText)}"</p>
        ${msgs.length ? `
          <div class="memory-list">
            ${msgs.map(m => `
              <div>
                <svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-10.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3.6C20 15.8 12 21 12 21z"/></svg>
                <span>${esc(m)}</span>
              </div>`).join('')}
          </div>` : ''}
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);
                    font-size:0.72rem;color:var(--text-dim);letter-spacing:1.5px;font-family:var(--f-head);">
          ${hearts} KALP · 3 BÖLÜM · 1 EJDERHA
        </div>
      </div>
    </div>
  `;
}

function spawnConfetti() {
  const canvas = document.createElement('canvas');
  canvas.id = 'confetti-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ['#d4a853', '#f2dba0', '#c41e3a', '#a76bff', '#e9e3d6', '#3ddc84', '#ff4d6d'];
  const pieces = [];

  for (let i = 0; i < 180; i++) {
    pieces.push({
      x: Math.random() * W,
      y: Math.random() * -H * 1.2,
      w: Math.random() * 9 + 4,
      h: Math.random() * 6 + 3,
      color: colors[(Math.random() * colors.length) | 0],
      vy: Math.random() * 160 + 110,
      vx: (Math.random() - 0.5) * 90,
      rot: Math.random() * 6.28,
      vrot: (Math.random() - 0.5) * 9,
      heart: Math.random() < 0.22,
      sway: Math.random() * 6.28
    });
  }

  let t = 0, last = performance.now();
  const animate = (now) => {
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now; t += dt;
    ctx.clearRect(0, 0, W, H);

    for (const p of pieces) {
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(t * 2 + p.sway) * 30) * dt;
      p.rot += p.vrot * dt;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, (5.5 - t) / 1.4));
      if (p.heart) {
        const s = p.w * 0.32;
        ctx.scale(s, s);
        ctx.beginPath();
        ctx.moveTo(0, 1.4);
        ctx.bezierCurveTo(-2.2, -0.4, -1.2, -2.2, 0, -1.1);
        ctx.bezierCurveTo(1.2, -2.2, 2.2, -0.4, 0, 1.4);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    if (t < 5.5) requestAnimationFrame(animate);
    else canvas.remove();
  };
  requestAnimationFrame(animate);
}
