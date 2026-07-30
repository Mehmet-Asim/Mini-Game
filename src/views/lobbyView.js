/* ==========================================================================
   Bekleme Salonu

   İki tarafın buluştuğu ekran. Host linki paylaşır, misafir girer, host
   başlatır.

   Tasarım notu: misafir bu ekranda da hiçbir şeyden şüphelenmemeli.
   Onun gördüğü "iki kişilik macera oyunu davetinden" ibaret. Teklifle ilgili
   tek kelime geçmiyor.
   ========================================================================== */

import { MSG } from '../net/client.js';

export function renderLobbyView(container, { net, onStart, onCancel }) {
  const isHost = net.isHost;

  container.innerHTML = `
    <div class="glass-panel lobby" style="max-width: 520px; width: 100%;">
      <div class="lobby-head">
        <div class="lobby-eyebrow">${isHost ? 'ODA HAZIR' : 'MACERAYA DAVET'}</div>
        <h1 class="title-medieval" style="font-size: 1.5rem;">
          ${isHost ? 'Yoldaşını Bekle' : 'Yoldaşın Hazırlanıyor'}
        </h1>
        <p class="subtitle" style="margin-top:8px;">
          ${isHost
            ? 'Aşağıdaki linki gönder. O girince başlatabilirsin.'
            : 'İki kişilik bir macera. Bazı kapılar tek başına açılmaz.'}
        </p>
      </div>

      ${isHost ? `
        <div class="lobby-code-box">
          <div class="lobby-code-label">ODA KODU</div>
          <div class="lobby-code" id="lobby-code">—</div>
          <div class="lobby-link" id="lobby-link"></div>
          <button class="btn-primary" id="btn-copy-link" style="margin-top:12px;">
            <svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
            <span>Daveti Kopyala</span>
          </button>
        </div>` : ''}

      <div class="lobby-seats">
        <div class="lobby-seat" id="seat-host">
          <span class="lobby-dot"></span>
          <span class="lobby-seat-name">—</span>
          <span class="lobby-seat-role">Yoldaş 1</span>
          <span class="lobby-seat-state">bekleniyor</span>
        </div>
        <div class="lobby-seat" id="seat-guest">
          <span class="lobby-dot"></span>
          <span class="lobby-seat-name">—</span>
          <span class="lobby-seat-role">Yoldaş 2</span>
          <span class="lobby-seat-state">bekleniyor</span>
        </div>
      </div>

      <div class="lobby-actions">
        ${isHost
          ? `<button class="btn-primary" id="btn-start" disabled>
               <svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg>
               <span>MACERAYA BAŞLA</span>
             </button>`
          : `<button class="btn-primary" id="btn-ready">
               <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
               <span>HAZIRIM</span>
             </button>`}
        <button class="lobby-cancel" id="btn-cancel">Vazgeç</button>
      </div>

      <div class="lobby-status" id="lobby-status">
        <span class="lobby-net-dot"></span>
        <span id="lobby-status-text">bağlanıyor...</span>
      </div>
    </div>
  `;

  const el = {
    code: container.querySelector('#lobby-code'),
    link: container.querySelector('#lobby-link'),
    copy: container.querySelector('#btn-copy-link'),
    host: container.querySelector('#seat-host'),
    guest: container.querySelector('#seat-guest'),
    start: container.querySelector('#btn-start'),
    ready: container.querySelector('#btn-ready'),
    cancel: container.querySelector('#btn-cancel'),
    status: container.querySelector('#lobby-status'),
    statusText: container.querySelector('#lobby-status-text')
  };

  let inviteUrl = '';
  let iAmReady = false;

  /* ---------- Davet linki ---------- */
  function refreshInvite() {
    if (!isHost || !net.room) return;
    inviteUrl = `${location.origin}${location.pathname}?r=${net.room}`;
    el.code.textContent = net.room;
    el.link.textContent = inviteUrl;
  }
  refreshInvite();

  el.copy?.addEventListener('click', async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      el.copy.querySelector('span').textContent = 'Kopyalandı!';
    } catch {
      /* Clipboard API https olmadan çalışmaz — kullanıcı elle seçsin */
      el.copy.querySelector('span').textContent = 'Linki elle kopyala';
      selectText(el.link);
    }
    setTimeout(() => { el.copy.querySelector('span').textContent = 'Daveti Kopyala'; }, 2200);
  });

  /* ---------- Koltuk durumu ---------- */
  function paintSeat(node, seat, fallbackName) {
    const nameEl = node.querySelector('.lobby-seat-name');
    const stateEl = node.querySelector('.lobby-seat-state');
    if (!seat) {
      node.classList.remove('is-online', 'is-ready');
      nameEl.textContent = fallbackName || '—';
      stateEl.textContent = 'bekleniyor';
      return;
    }
    nameEl.textContent = seat.name || fallbackName || '—';
    node.classList.toggle('is-online', !!seat.connected);
    node.classList.toggle('is-ready', !!seat.ready);
    stateEl.textContent = !seat.connected ? 'bağlantı koptu' : (seat.ready ? 'hazır' : 'salonda');
  }

  function paintLobby(lobby) {
    if (!lobby) return;
    paintSeat(el.host, lobby.host, lobby.config?.heroName);
    paintSeat(el.guest, lobby.guest, lobby.config?.targetName);

    if (el.start) {
      const canStart = !!(lobby.guest && lobby.guest.connected);
      el.start.disabled = !canStart;
      el.start.querySelector('span').textContent =
        canStart ? 'MACERAYA BAŞLA' : 'YOLDAŞ BEKLENİYOR';
    }
  }

  /* ---------- Ağ olayları ---------- */
  const offs = [];
  let startFired = false;

  const fireStart = (lobby) => {
    if (startFired) return;
    startFired = true;
    onStart?.(lobby);
  };

  offs.push(net.on(MSG.LOBBY, (m) => {
    paintLobby(m.lobby);
    refreshInvite();
    /* Oyun zaten başlamışsa (yeniden bağlanma) lobide bekletme —
       evre bilgisi kaldığı yerden devam etmeyi sağlar. */
    const phase = m.lobby?.phase;
    if (m.started || (phase && phase !== 'lobby' && phase !== 'done')) fireStart(m.lobby);
  }));

  offs.push(net.on(MSG.PEER, (m) => {
    const who = m.role === 'host' ? 'Yoldaşın' : (m.name || 'Yoldaşın');
    const text = {
      joined:   `${who} katıldı`,
      rejoined: `${who} geri döndü`,
      dropped:  `${who} bağlantısı koptu`,
      left:     `${who} ayrıldı`
    }[m.event];
    if (text) flash(text);
  }));

  offs.push(net.on('status', ({ status }) => paintStatus(status)));
  offs.push(net.on(MSG.ERROR, (m) => flash(m.message || m.code, true)));

  paintStatus(net.status);

  function paintStatus(status) {
    el.status.className = 'lobby-status is-' + status;
    el.statusText.textContent = {
      idle: 'hazırlanıyor...',
      connecting: 'bağlanıyor...',
      online: net.rtt ? `bağlı · ${net.rtt} ms` : 'bağlı',
      reconnecting: 'bağlantı koptu, yeniden deneniyor...',
      closed: 'bağlantı kapandı'
    }[status] || status;
  }

  /* RTT'yi periyodik tazele */
  const rttTimer = setInterval(() => {
    if (net.status === 'online') paintStatus('online');
  }, 3000);

  /* ---------- Butonlar ---------- */

  el.start?.addEventListener('click', () => {
    el.start.disabled = true;
    net.startGame();
  });

  el.ready?.addEventListener('click', () => {
    iAmReady = !iAmReady;
    net.setReady(iAmReady);
    el.ready.classList.toggle('is-on', iAmReady);
    el.ready.querySelector('span').textContent = iAmReady ? 'HAZIRIM ✓' : 'HAZIRIM';
  });

  el.cancel.addEventListener('click', () => onCancel?.());

  /* ---------- Bildirim ---------- */
  let flashTimer = null;
  function flash(text, isError = false) {
    let node = container.querySelector('.lobby-flash');
    if (!node) {
      node = document.createElement('div');
      node.className = 'lobby-flash';
      container.querySelector('.lobby').appendChild(node);
    }
    node.textContent = text;
    node.classList.toggle('is-error', isError);
    node.classList.add('is-visible');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => node.classList.remove('is-visible'), 3200);
  }

  /* ---------- Temizlik ---------- */
  return () => {
    offs.forEach(off => off());
    clearInterval(rttTimer);
    clearTimeout(flashTimer);
  };
}

function selectText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
