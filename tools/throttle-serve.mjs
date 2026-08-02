/**
 * `dist/` klasörünü BANT GENİŞLİĞİ KISITLI olarak servis eder.
 *
 * Amaç: "10 Mbps indirme hızı olan biri oyunu açtığında ne oluyor?"
 * sorusunu ölçmek. Tarayıcının kendi throttle'ı bu ortamda kapalı, o
 * yüzden kısıtlamayı sunucu tarafında yapıyoruz.
 *
 * Model:
 *   · TÜM bağlantılar için ORTAK bir jeton kovası (gerçek hat gibi —
 *     paralel istekler hattı paylaşır, her biri ayrı 10 Mbps almaz).
 *   · Her yanıta tek yönlü gecikme eklenir (ilk bayta kadar).
 *
 * Kullanım:  npm run build && npm run serve:slow      (10 Mbps)
 *            node tools/throttle-serve.mjs [mbps] [rttMs] [port] [kök]
 *
 * 10 Mbps / 60 ms RTT ile ÖLÇÜLEN (2026-08-02):
 *
 *     ilk ekran (html+css+js+intro-bg, ~700 KB)   0.87 sn
 *     3 müzik + 3 sinematik arka planı (4.8 MB)   6.0  sn
 *     outro sprite'ları (69 PNG, 13 MB)          16.5  sn   ← sahneyi bloklar
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MBPS = Number(process.argv[2] || 10);
const RTT  = Number(process.argv[3] || 60);
const PORT = Number(process.argv[4] || 8099);
const ROOT = process.env.DIST_ROOT || process.argv[5]
  || path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist');

const BYTES_PER_SEC = (MBPS * 1_000_000) / 8;   // 10 Mbps → 1.25 MB/sn
const TICK_MS = 20;                              // kovayı 50 Hz doldur
const PER_TICK = BYTES_PER_SEC * (TICK_MS / 1000);

/* ---- Ortak jeton kovası ---- */
let tokens = PER_TICK;
const waiters = [];
setInterval(() => {
  tokens = Math.min(PER_TICK * 2, tokens + PER_TICK);   // en fazla 40 ms'lik burst
  while (waiters.length && tokens > 0) {
    const w = waiters[0];
    const give = Math.min(w.need, tokens);
    tokens -= give;
    w.need -= give;
    w.got += give;
    if (w.need <= 0) { waiters.shift(); w.resolve(w.got); }
    else break;
  }
}, TICK_MS).unref();

function take(n) {
  return new Promise(resolve => {
    if (tokens >= n) { tokens -= n; return resolve(n); }
    const give = Math.max(0, tokens);
    tokens -= give;
    waiters.push({ need: n - give, got: give, resolve });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm'
};

/* ---- Ölçüm defteri ---- */
const log = [];
const t0 = Date.now();

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath === '/__stats') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ mbps: MBPS, rttMs: RTT, sinceStartMs: Date.now() - t0, requests: log }, null, 1));
  }
  if (urlPath === '/__reset') {
    log.length = 0;
    res.writeHead(200, { 'cache-control': 'no-store' });
    return res.end('ok');
  }

  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('nope'); }

  let stat;
  try { stat = await fs.promises.stat(file); } catch { res.writeHead(404); return res.end('yok'); }
  if (stat.isDirectory()) { res.writeHead(404); return res.end('yok'); }

  /* Tek yön gecikme — ilk bayta kadar */
  await new Promise(r => setTimeout(r, RTT / 2));

  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size,
    /* Ölçüm her koşuda sıfırdan olsun; tarayıcı önbelleği sonucu yalan söyler */
    'cache-control': 'no-store, no-cache, must-revalidate',
    'accept-ranges': 'none'
  });

  const stream = fs.createReadStream(file, { highWaterMark: 32 * 1024 });
  let sent = 0;
  let firstByteAt = null;
  for await (const chunk of stream) {
    await take(chunk.length);
    if (firstByteAt === null) firstByteAt = Date.now();
    sent += chunk.length;
    if (!res.write(chunk)) await new Promise(r => res.once('drain', r));
  }
  res.end();

  log.push({
    url: urlPath,
    bytes: sent,
    startMs: started - t0,
    ttfbMs: (firstByteAt ?? Date.now()) - started,
    doneMs: Date.now() - t0,
    durMs: Date.now() - started
  });
  const kb = (sent / 1024).toFixed(0);
  console.log(`${String(Date.now() - t0).padStart(6)}ms  ${String(kb).padStart(6)}KB  ${String(Date.now() - started).padStart(6)}ms  ${urlPath}`);
});

server.listen(PORT, () => {
  console.log(`throttle-serve: ${MBPS} Mbps · ${RTT} ms RTT · kök=${ROOT}`);
  console.log(`http://localhost:${PORT}/   (istatistik: /__stats)`);
});
