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
  let prev = { sent: 0, received: 0, seq: 0, lastSeq: 0 };
  let rate = { out: 0, in: 0 };

  const tick = () => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    if (dt >= 0.5) {
      last = now;
      const s = session?.stats || { sent: 0, received: 0 };
      rate.out = (s.sent - prev.sent) / dt;
      rate.in = (s.received - prev.received) / dt;
      prev.sent = s.sent;
      prev.received = s.received;
    }
    if (open) el.innerHTML = render();
  };

  function render() {
    if (!session) {
      return row('MOD', 'tek kişilik — ağ yok');
    }
    const isHost = session.isHost;
    const me = engine.players[engine.localIndex];
    const mate = engine.players[engine.localIndex === 0 ? 1 : 0];
    const net = session.net;

    const lines = [
      row('ROL', `${isHost ? 'HOST' : 'MİSAFİR'} · oyuncu ${engine.localIndex}`),
      row('BAĞLANTI', `${net?.status || '—'} · ${FMT(net?.rtt)} ms`),
      row('DURUM', `${engine.state}${engine.pausedBy ? ` (${engine.pausedBy})` : ''}`)
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
        row('  sapma', `${FMT(session.stats?.drift, 1)} px`, (session.stats?.drift ?? 0) < 40)
      );
    }

    lines.push(
      row('BEN', `x=${FMT(me?.x)} y=${FMT(me?.y)}`),
      row('YOLDAŞ', mate ? `x=${FMT(mate.x)} y=${FMT(mate.y)}` : '—')
    );

    return lines.join('');
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
