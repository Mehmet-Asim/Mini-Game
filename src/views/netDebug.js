/* ==========================================================================
   Ağ Teşhis Paneli

       ?debug=1  ile açılır, oyun içinde F3 ile açılıp kapanır.

   NEDEN VAR: "misafir hareket ediyor ama host'ta yerinden kımıldamıyor"
   şikâyeti hem sahte taşımayla hem GERÇEK sunucuyla kurulan testlerde
   üretilemedi. İki tarayıcı arasındaki farkı ancak iki tarayıcının kendisi
   gösterebilir. Bu panel, hangi halkanın koptuğunu tek bakışta söyleyen
   sayıları veriyor:

     · girdi gönderiliyor mu        → GİDEN girdi/sn
     · sunucuyu geçiyor mu          → host'ta GELEN girdi/sn
     · host motoruna işliyor mu     → lastSeq artıyor mu, kuyruk boş mu
     · host simüle ediyor mu        → DONMUŞ satırı
     · geri dönüyor mu              → snapshot/sn ve sapma

   Kural: panel hiçbir şeyi değiştirmez, yalnızca okur.
   ========================================================================== */

const FMT = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export function shouldAutoOpen() {
  try {
    return new URLSearchParams(location.search).get('debug') === '1';
  } catch { return false; }
}

/**
 * @param host   panelin ekleneceği DOM düğümü
 * @param engine GameEngine
 * @param session CoopSession | null
 * @returns { toggle(), destroy() }
 */
export function attachNetDebug(host, engine, session) {
  const el = document.createElement('div');
  el.className = 'net-debug';
  el.setAttribute('aria-hidden', 'true');
  host.appendChild(el);

  let open = shouldAutoOpen();
  el.style.display = open ? '' : 'none';

  /* Saniyelik hız ölçümü için sayaç örnekleri */
  let last = performance.now();
  let prev = { sent: 0, received: 0, steps: 0 };
  let rate = { out: 0, in: 0, steps: 0 };

  const tick = () => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    if (dt >= 0.5) {
      last = now;
      const s = session?.stats || { sent: 0, received: 0 };
      rate.out = (s.sent - prev.sent) / dt;
      rate.in = (s.received - prev.received) / dt;
      rate.steps = ((engine.stepCount || 0) - prev.steps) / dt;
      prev.sent = s.sent;
      prev.received = s.received;
      prev.steps = engine.stepCount || 0;
    }
    if (open) el.innerHTML = render();
  };

  /* ------------------------------------------------------------------------
     ÇİZİM bölümü

     Ağ satırlarından AYRI ve her modda görünüyor: takılmanın kaynağı çoğu
     zaman ağ değil, kare maliyeti. Ölçümde bir kare 1280x720'de ~9.7 ms
     sürüyor; aynı kare dpr=2 olan bir ekranda dört kat pahalı çünkü maliyet
     piksel sayısıyla büyüyor. O yüzden dpr ve gerçek tuval çözünürlüğü de
     burada — "neden onun bilgisayarında daha kötü?" sorusunun cevabı
     genelde bu satırda yazıyor.

     ORTALAMA YOK, yüzdelik var: tökezleme nadir bir olay ve ortalamanın
     içinde kayboluyor (bkz. core/perf.js).
     ------------------------------------------------------------------------ */
  function drawRows() {
    const p = engine.perf?.read();
    if (!p || p.samples < 10) return row('ÇİZİM', 'ölçülüyor...');

    const r = engine.renderer;
    const px = r?.canvas ? `${r.canvas.width}x${r.canvas.height}` : '—';
    /* 16.7 ms = 60 fps bütçesi. Çizim bunun yarısını geçiyorsa geri kalan
       her şeye (simülasyon, ağ, tarayıcının kendi işi) yer kalmıyor. */
    const budget = (p.drawP95 / 16.67) * 100;

    return [
      row('KARE', `${FMT(p.fps)} fps · medyan ${FMT(p.frameMedian, 1)} ms`, p.fps >= 55),
      row('  p95 / en kötü', `${FMT(p.frameP95, 1)} / ${FMT(p.frameMax, 1)} ms`, p.frameP95 < 20),
      row('  takılma (3 sn)', `${p.janky} kare >20ms · ${p.severe} kare >33ms`, p.severe === 0),
      /* DİKKAT: bu yalnızca CPU tarafı — canvas komutlarını sıraya koyma
         süresi. Asıl raster işini GPU sonradan yapıyor, o maliyet buraya
         YANSIMIYOR. Bu satır düşükken KARE satırı kötüyse darboğaz GPU'da
         (doldurma maliyeti) demektir; gerçek hüküm hep KARE satırınındır. */
      row('ÇİZİM (cpu)', `medyan ${FMT(p.drawMedian, 1)} ms · p95 ${FMT(p.drawP95, 1)} ms`, p.drawP95 < 8),
      row('  cpu bütçe payı', `%${FMT(budget)} (16.7 ms üzerinden)`, budget < 50),
      row('  tuval', `${px} · dpr ${FMT(r?.dpr, 2)}`)
    ].join('');
  }

  /* Sapma satırı — değerin yanında YAŞI da var.
     1 saniyeden eskiyse "bayat" damgası basılıp iyi/kötü rengi
     kaldırılıyor: o sayı artık şu anki durumu anlatmıyor. */
  function driftRow(session) {
    const d = session.stats?.drift ?? 0;
    const at = session.stats?.driftAt ?? 0;
    if (!at) return row('  sapma', 'henüz ölçülmedi');
    const age = performance.now() - at;
    if (age > 1000) {
      return row('  sapma', `${FMT(d, 1)} px · ${FMT(age / 1000, 1)} sn önce (bayat)`);
    }
    return row('  sapma', `${FMT(d, 1)} px`, d < 40);
  }

  function render() {
    if (!session) {
      return row('MOD', 'tek kişilik — ağ yok') + drawRows();
    }
    const isHost = session.isHost;
    const me = engine.players[engine.localIndex];
    const mate = engine.players[engine.localIndex === 0 ? 1 : 0];
    const net = session.net;

    const lines = [
      row('ROL', `${isHost ? 'HOST' : 'MİSAFİR'} · oyuncu ${engine.localIndex}`),
      row('BAĞLANTI', `${net?.status || '—'} · ${FMT(net?.rtt)} ms`),
      row('DURUM', `${engine.state}${engine.pausedBy ? ` (${engine.pausedBy})` : ''}`),
      /* EN ÖNEMLİ SATIR.
         Simülasyon dönmüyorsa başka hiçbir şeyin anlamı yok. Sekmeyi arka
         plana alıp geri geldiğinde bu sayının 60 civarında kalmış olması
         gerekir — kaynak `raf`'ten `worker`'a geçer ama hız düşmez.
         Düşüyorsa "misafir hayalet" hatası geri gelmiş demektir. */
      row('SİMÜLASYON', `${FMT(rate.steps)} adım/sn · ${engine.ticker?.mode || '—'}`,
        rate.steps > 45)
    ];

    if (isHost) {
      const ri = engine.inputs[session.remoteIndex];
      const stale = ri?.lastAppliedAt ? Date.now() - ri.lastAppliedAt : -1;
      lines.push(
        row('GELEN girdi', `${FMT(rate.in)}/sn`, rate.in > 20),
        row('  son seq', `${ri?.lastSeq ?? '—'}`, (ri?.lastSeq ?? -1) > 0),
        row('  kuyruk', `${ri?.queue?.length ?? '—'} · hazır=${ri?.primed ? 'evet' : 'HAYIR'}`, !!ri?.primed),
        row('  açlık', `${ri?.starved ?? '—'} · kurtarılan=${ri?.recovered ?? 0}`),
        row('  bayatlık', stale < 0 ? 'hiç girdi gelmedi' : `${stale} ms`, stale >= 0 && stale < 500),
        row('DONMUŞ', engine._frozen?.size ? [...engine._frozen].join(',') : 'yok', !engine._frozen?.size),
        row('GİDEN snapshot', `${FMT(rate.out)}/sn`, rate.out > 10)
      );
    } else {
      const ack = session.pendingInputs?.length ?? 0;
      lines.push(
        row('GİDEN girdi', `${FMT(rate.out)}/sn · seq ${session.inputSeq}`, rate.out > 20),
        row('GELEN snapshot', `${FMT(rate.in)}/sn`, rate.in > 10),
        row('  tampon', `${session.buffer?.depth ?? 0} kare · ${FMT(session.buffer?.delay)} ms`),
        row('  sırasız', `${session.buffer?.outOfOrder ?? 0}`),
        row('ONAY (ack)', engine.remoteAckSeen ? `seq ${engine.remoteAckSeen}` : 'HİÇ ONAY GELMEDİ',
          !!engine.remoteAckSeen),
        row('  bekleyen', `${ack}`, ack < 60),
        /* Sapma yalnızca uzlaştırma ÇALIŞTIĞINDA tazeleniyor; oyuncu
           yerdeyken/ölüyken ve duraklamada güncellenmiyor. Yaşını
           göstermezsek bayat bir sayı taze sanılıyor (bkz. session.js). */
        driftRow(session)
      );
    }

    lines.push(
      row('BEN', `x=${FMT(me?.x)} y=${FMT(me?.y)}`),
      row('YOLDAŞ', mate ? `x=${FMT(mate.x)} y=${FMT(mate.y)}` : '—')
    );

    return lines.join('') + drawRows();
  }

  function row(k, v, ok) {
    const cls = ok === undefined ? '' : (ok ? ' is-ok' : ' is-bad');
    return `<div class="net-debug-row${cls}"><b>${k}</b><span>${v}</span></div>`;
  }

  const timer = setInterval(tick, 250);
  tick();

  /* F3 bazı tarayıcılarda "sonrakini bul" — bu yüzden ` (Backquote) de
     çalışıyor. Hiçbir tuş şemasında kullanılmıyor. */
  const onKey = (e) => {
    if (e.code !== 'F3' && e.code !== 'Backquote') return;
    if (e.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    open = !open;
    el.style.display = open ? '' : 'none';
    if (open) tick();
  };
  window.addEventListener('keydown', onKey);

  return {
    toggle: () => onKey({ code: 'F3', preventDefault() {} }),
    destroy: () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      el.remove();
    }
  };
}
