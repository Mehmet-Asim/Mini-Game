/* ==========================================================================
   Seçim Kartları

   Finalin can alıcı anı. İki kural var:

   1. Seçim geldiğinde sahne DURUR (Director.awaitingChoice). Zaman akmaz,
      müzik askıda kalır. Karar verilene kadar dünya bekler.
   2. Sadece YETKİLİ taraf tıklayabilir. Co-op'ta bu misafir oluyor —
      teklifi yapan kişi karşı tarafın adına "Evet"e basamasın diye.
      Yetkisiz tarafta kartlar görünür ama sönük ve tıklanamaz, altında
      "Karar onun" notu belirir.
   ========================================================================== */

export class ChoiceLayer {
  constructor(root, onPick) {
    this.root = root;
    this.onPick = onPick;
    this.el = null;
    this.currentKey = null;
    this.locked = false;
    this.typingTimer = null;
  }

  /**
   * choice: Director.evaluate() içinden gelen { question, options, alpha }
   * opts.canChoose: bu tarayıcı karar verebilir mi
   */
  render(choice, opts = {}) {
    if (!choice) { this.clear(); return; }

    const canChoose = opts.canChoose !== false;
    const key = choice.options.map(o => o.id).join('|') + '::' + canChoose;

    if (this.currentKey !== key) {
      this.clear();
      this.currentKey = key;
      this.locked = false;

      const wrap = document.createElement('div');
      wrap.className = 'cine-choice' + (canChoose ? '' : ' cine-choice--locked');
      wrap.innerHTML = `
        ${choice.speaker ? `<p class="cine-choice-speaker">${escapeHtml(choice.speaker)}</p>` : ''}
        <p class="cine-choice-q" aria-label="${escapeHtml(choice.question)}">
          <span class="cine-choice-typed"></span><span class="cine-untyped">${escapeHtml(choice.question)}</span>
        </p>
        <div class="cine-choice-row"></div>
        ${canChoose ? '' : '<p class="cine-choice-wait">Karar onun. Bekliyorsun...</p>'}
      `;

      const row = wrap.querySelector('.cine-choice-row');
      const buttons = [];
      for (const opt of choice.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `cine-opt cine-opt--${opt.id}`;
        btn.disabled = true;
        btn.innerHTML = `
          <span class="cine-opt-glyph">${opt.glyph || ''}</span>
          <span class="cine-opt-label">${escapeHtml(opt.label)}</span>
          ${opt.hint ? `<span class="cine-opt-hint">${escapeHtml(opt.hint)}</span>` : ''}
        `;
        if (canChoose) {
          btn.addEventListener('click', () => {
            if (this.locked) return;
            this.locked = true;
            wrap.classList.add('cine-choice--picked');
            btn.classList.add('is-picked');
            /* Seçim animasyonu bitsin, sonra sahne devam etsin */
            setTimeout(() => this.onPick && this.onPick(opt.id), 520);
          });
        }
        row.appendChild(btn);
        buttons.push(btn);
      }

      this.root.appendChild(wrap);
      this.el = wrap;

      const typed = wrap.querySelector('.cine-choice-typed');
      let reveal = 0;
      this.typingTimer = setInterval(() => {
        reveal = Math.min(choice.question.length, reveal + 1);
        typed.textContent = choice.question.slice(0, reveal);
        if (reveal < choice.question.length) return;
        clearInterval(this.typingTimer);
        this.typingTimer = null;
        wrap.classList.add('is-ready');
        if (canChoose) buttons.forEach(button => { button.disabled = false; });
      }, 18);
    }

    if (this.el) this.el.style.opacity = (choice.alpha ?? 1).toFixed(3);
  }

  clear() {
    if (this.typingTimer) clearInterval(this.typingTimer);
    this.typingTimer = null;
    if (this.el) { this.el.remove(); this.el = null; }
    this.currentKey = null;
    this.locked = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
