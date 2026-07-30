/* ==========================================================================
   Sahne Galerisi — #cine

   Faz 1'in test tezgâhı. Dört sahneyi oyunu hiç açmadan tek tek izlemek,
   metinleri ve tempoyu ayarlamak için. Oyuna bağlanmadan önce sahnelerin
   burada tek başına düzgün çalışması gerekiyor.
   ========================================================================== */

const SCENE_CARDS = [
  {
    id: 'intro',
    no: 'I',
    title: 'Maceraya Davet',
    desc: 'Uçsuz bucaksız çayır, yaklaşan kahraman, gökten geçen ejderha gölgesi.',
    dur: '32 sn'
  },
  {
    id: 'outro-ask',
    no: 'II',
    title: 'Soru',
    desc: 'Devrilmiş ejderha, alacakaranlık, diz çöküş. Sahne durur, karar karşı tarafa geçer.',
    dur: '15 sn + seçim'
  },
  {
    id: 'outro-yes',
    no: 'III-A',
    title: 'Kabul',
    desc: 'Yan yana oturmuş iki figür, gerçekten batan bir güneş, geri çekilen kamera.',
    dur: '21 sn'
  },
  {
    id: 'outro-no',
    no: 'III-B',
    title: 'Ret',
    desc: 'Aynı ejderha, üç sayı 0\'dan 1\'e: göz açılır, boyun kalkar, kadraj ağzın içinde kararır.',
    dur: '14 sn'
  }
];

export function renderCineGalleryView(container, onPlay) {
  container.innerHTML = `
    <div class="glass-panel" style="max-width: 720px; width: 100%;">
      <div style="margin-bottom: 20px;">
        <h1 class="title-medieval" style="font-size: 1.45rem;">Sinematik Sahneler</h1>
        <p class="subtitle" style="margin-top: 8px;">
          Faz 1 test tezgâhı. Sahneler oyundan bağımsız çalışır.<br/>
          Metinler <code style="color:var(--text-gold);font-size:0.8em;">src/cinematic/script.js</code> içinde.
        </p>
      </div>

      <div class="cine-gallery">
        ${SCENE_CARDS.map(s => `
          <button class="cine-gal-card" data-scene="${s.id}" type="button">
            <span class="cine-gal-no">${s.no}</span>
            <span class="cine-gal-body">
              <span class="cine-gal-title">${s.title}</span>
              <span class="cine-gal-desc">${s.desc}</span>
            </span>
            <span class="cine-gal-dur">${s.dur}</span>
          </button>
        `).join('')}
      </div>

      <div class="cine-gal-names">
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label" for="gal-hero">Kahraman adı</label>
          <input type="text" id="gal-hero" class="form-input" value="Mehmet" />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" for="gal-target">Karşı tarafın adı</label>
          <input type="text" id="gal-target" class="form-input" value="Yolcu" />
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('.cine-gal-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const heroName = container.querySelector('#gal-hero').value.trim() || 'Kahraman';
      const targetName = container.querySelector('#gal-target').value.trim() || 'Yolcu';
      onPlay(btn.dataset.scene, { heroName, targetName, proposalText: 'Benimle çıkar mısın?' });
    });
  });
}
