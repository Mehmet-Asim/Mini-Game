/* ==========================================================================
   Gizli Kurulum — yalnızca teklifi hazırlayan görür (#setup)

   Form dolduruluca sunucuda bir oda açılır ve bekleme salonuna geçilir.
   Davet linki orada gösterilir.

   Sunucuya ulaşılamazsa TEK KİŞİLİK yedek moda düşer: eski `?d=base64`
   linki üretilir. Böylece sunucu uyurken ya da barındırma bozukken teklif
   tamamen kullanılamaz hale gelmez — sadece co-op özelliği kapanır.
   ========================================================================== */

export function renderSetupView(container, { onRoomCreated } = {}) {
  container.innerHTML = `
    <div class="glass-panel" style="max-width: 480px;">
      <div style="margin-bottom: 22px;">
        <svg viewBox="0 0 24 24" style="width:30px;height:30px;color:var(--gold);margin-bottom:10px;">
          <rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
        </svg>
        <h1 class="title-medieval" style="font-size: 1.5rem;">Gizli Kurulum</h1>
        <p class="subtitle" style="margin-top:8px;">
          Bilgileri doldur, oluşan linki gönder.<br/>
          O sadece iki kişilik bir macera oyunu görecek.
        </p>
      </div>

      <form id="setup-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label" for="hero-name">Senin Adın</label>
          <input type="text" id="hero-name" class="form-input" placeholder="Örn: Ahmet" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="target-name">Karşı Tarafın Adı</label>
          <input type="text" id="target-name" class="form-input" placeholder="Örn: Ayşe" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="proposal-text">Son Sahnedeki Soru</label>
          <input type="text" id="proposal-text" class="form-input" value="Benimle çıkar mısın?" />
        </div>
        <div class="form-group">
          <label class="form-label">Gizli Hatıralar</label>
          <p style="font-size:0.72rem;color:var(--text-dim);margin-bottom:8px;line-height:1.5;">
            Her bölümde saklı bir hatıra kalbi var. Bulduğunuzda bu notlar tek tek açılır.
          </p>
          <input type="text" id="msg-1" class="form-input" style="margin-bottom: 8px;" placeholder="1. hatıra (Bölüm 1'de açılır)" />
          <input type="text" id="msg-2" class="form-input" style="margin-bottom: 8px;" placeholder="2. hatıra (Bölüm 2'de açılır)" />
          <input type="text" id="msg-3" class="form-input" placeholder="3. hatıra (Bölüm 3'te açılır)" />
        </div>

        <button type="submit" class="btn-primary" id="btn-generate">
          <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18 15l.9 2.4L21 18l-2.1.6L18 21l-.9-2.4L15 18l2.1-.6z"/></svg>
          <span>ODAYI AÇ</span>
        </button>
      </form>

      <p class="setup-note" id="setup-note"></p>

      <div id="link-result" style="display: none; margin-top: 20px;">
        <div style="background: rgba(0,0,0,0.4); border: 1px solid var(--line-strong); border-radius: 10px; padding: 14px; word-break: break-all;">
          <p style="font-size: 0.68rem; color: var(--text-dim); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1.5px;">
            Tek Kişilik Yedek Link
          </p>
          <p id="generated-link" style="font-size: 0.76rem; color: var(--text-gold); font-family: monospace; line-height:1.5;"></p>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 12px;">
          <button class="btn-primary" id="btn-copy" style="flex: 1;">
            <svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
            <span>Kopyala</span>
          </button>
          <button class="btn-primary" id="btn-test" style="flex: 1; background: rgba(196,30,58,0.1); border-color: var(--crimson); color: #ff7f92;">
            <svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg>
            <span>Test Et</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector('#setup-form');
  const btn = container.querySelector('#btn-generate');
  const note = container.querySelector('#setup-note');
  const linkResult = container.querySelector('#link-result');
  const linkEl = container.querySelector('#generated-link');
  const btnCopy = container.querySelector('#btn-copy');
  const btnTest = container.querySelector('#btn-test');
  let fallbackUrl = '';

  function readConfig() {
    return {
      heroName: container.querySelector('#hero-name').value.trim(),
      targetName: container.querySelector('#target-name').value.trim(),
      proposalText: container.querySelector('#proposal-text').value.trim() || 'Benimle çıkar mısın?',
      messages: [
        container.querySelector('#msg-1').value.trim(),
        container.querySelector('#msg-2').value.trim(),
        container.querySelector('#msg-3').value.trim()
      ].filter(Boolean)
    };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const config = readConfig();

    btn.disabled = true;
    btn.querySelector('span').textContent = 'ODA AÇILIYOR...';
    note.textContent = '';
    note.className = 'setup-note';

    try {
      /* Ağ katmanı sadece burada yükleniyor — tek kişilik akış onu
         hiç indirmesin diye dinamik import */
      const { NetClient, clearSession } = await import('../net/client.js');
      /* Yeni oda açarken bayat oturumu at — aksi halde bağlantı açılır
         açılmaz RESUME gider ve CREATE "ODA AÇILIYOR..."da takılır. */
      clearSession();
      const net = new NetClient();
      await net.connect();
      await net.createRoom(config);
      onRoomCreated?.(net, config);
    } catch (err) {
      console.warn('[setup] oda açılamadı:', err);
      btn.disabled = false;
      btn.querySelector('span').textContent = 'ODAYI AÇ';
      note.className = 'setup-note is-warn';
      note.textContent = 'Sunucuya ulaşılamadı. Aşağıdaki tek kişilik link yine de çalışır.';
      showFallback(config);
    }
  });

  function showFallback(config) {
    const c = { h: config.heroName, t: config.targetName, p: config.proposalText, m: config.messages };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(c))));
    fallbackUrl = `${location.origin}${location.pathname}?d=${encoded}`;
    linkEl.textContent = fallbackUrl;
    linkResult.style.display = 'block';
  }

  btnCopy.addEventListener('click', () => {
    if (!fallbackUrl) return;
    navigator.clipboard.writeText(fallbackUrl).then(() => {
      btnCopy.querySelector('span').textContent = 'Kopyalandı!';
      setTimeout(() => { btnCopy.querySelector('span').textContent = 'Kopyala'; }, 2000);
    }).catch(() => { btnCopy.querySelector('span').textContent = 'Elle kopyala'; });
  });

  btnTest.addEventListener('click', () => { if (fallbackUrl) location.href = fallbackUrl; });

  return () => {};
}

/* --------------------------------------------------------------------------
   URL çözümleme
   -------------------------------------------------------------------------- */

/** Tek kişilik yedek link: ?d=base64 */
export function decodeConfigFromURL() {
  const params = new URLSearchParams(window.location.search);
  const data = params.get('d');
  if (!data) return null;
  try {
    const json = decodeURIComponent(escape(atob(data)));
    const c = JSON.parse(json);
    return {
      heroName: c.h || 'Birisi',
      targetName: c.t || 'Sen',
      proposalText: c.p || 'Benimle çıkar mısın?',
      messages: c.m || []
    };
  } catch { return null; }
}

/** Co-op daveti: ?r=ABCDE */
export function roomCodeFromURL() {
  const code = new URLSearchParams(window.location.search).get('r');
  if (!code) return null;
  const up = code.toUpperCase();
  return /^[A-Z2-9]{4,8}$/.test(up) ? up : null;
}
