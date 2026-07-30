/* ==========================================================================
   Metin Kartları

   Kartlar canvas'a değil DOM'a çiziliyor. Sebebi:
   - Yazı tipi keskin kalıyor (canvas'ta ölçeklenince bulanıklaşır)
   - Metni değiştirmek CSS işi, kod işi değil
   - Ekran okuyucular ve metin seçimi çalışır

   Yazı-makinesi efekti Director'dan gelen `reveal` sayısıyla sürülüyor —
   yani zamanın saf fonksiyonu. Geri sarsan, yazı da geri sarılır.
   ========================================================================== */

const POS_CLASS = {
  bottom: 'cine-card--bottom',
  top: 'cine-card--top',
  center: 'cine-card--center',
  left: 'cine-card--left',
  right: 'cine-card--right'
};

export class CardLayer {
  constructor(root) {
    this.root = root;
    this.nodes = new Map();
  }

  render(cards) {
    const seen = new Set();

    for (const c of cards) {
      seen.add(c.key);
      let node = this.nodes.get(c.key);

      if (!node) {
        node = document.createElement('div');
        node.className = `cine-card ${POS_CLASS[c.pos] || POS_CLASS.bottom} cine-card--${c.style}`;
        node.innerHTML = `
          <div class="cine-card-inner">
            <span class="cine-card-rule"></span>
            <p class="cine-card-speaker"></p>
            <p class="cine-card-text"></p>
          </div>`;
        this.root.appendChild(node);
        this.nodes.set(c.key, {
          el: node,
          speakerEl: node.querySelector('.cine-card-speaker'),
          textEl: node.querySelector('.cine-card-text'),
          last: -1,
          lastSpeaker: null
        });
        node = this.nodes.get(c.key);
      }

      if (node.lastSpeaker !== c.speaker) {
        node.speakerEl.textContent = c.speaker;
        node.speakerEl.hidden = !c.speaker;
        node.lastSpeaker = c.speaker;
      }

      /* Yazı-makinesi: sadece değişince DOM'a dokun */
      if (node.last !== c.reveal) {
        const shown = c.text.slice(0, c.reveal);
        const rest = c.text.slice(c.reveal);
        /* Kalan metni görünmez ama yer kaplar halde bırak → satır zıplaması olmaz */
        node.textEl.innerHTML =
          `<span class="cine-typed">${escapeHtml(shown)}</span>` +
          `<span class="cine-untyped">${escapeHtml(rest)}</span>`;
        node.last = c.reveal;
      }

      node.el.style.opacity = c.alpha.toFixed(3);
      node.el.style.transform = `translate3d(0, ${c.rise.toFixed(2)}px, 0)`;
    }

    /* Süresi dolan kartları kaldır */
    for (const [key, node] of this.nodes) {
      if (seen.has(key)) continue;
      node.el.remove();
      this.nodes.delete(key);
    }
  }

  clear() {
    for (const [, node] of this.nodes) node.el.remove();
    this.nodes.clear();
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
