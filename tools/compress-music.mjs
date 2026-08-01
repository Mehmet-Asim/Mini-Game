import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', 'public', 'music');

let ffmpegPath;
try {
  ffmpegPath = require('ffmpeg-static');
} catch (e) {
  console.error("Hata: 'ffmpeg-static' bulunamadı. Lütfen şu komutla çalıştırın:");
  console.error("npx --yes --package=ffmpeg-static node tools/compress-music.mjs");
  process.exit(1);
}

const files = ['muzik-3.mp3', 'muzik-4.mp3', 'muzik-6.mp3'];

console.log("🎵 Müzik dosyaları sıkıştırılıyor...\n");

let totalBefore = 0;
let totalAfter = 0;

for (const file of files) {
  const filePath = path.join(rootDir, file);
  if (!fs.existsSync(filePath)) {
    console.warn(`[UYARI] Dosya bulunamadı: ${file}`);
    continue;
  }

  const statBefore = fs.statSync(filePath);
  totalBefore += statBefore.size;
  const beforeMB = (statBefore.size / (1024 * 1024)).toFixed(2);

  const tempPath = path.join(rootDir, `temp_${file}`);

  console.log(`⏳ İşleniyor: ${file} (Mevcut Boyut: ${beforeMB} MB)...`);

  // -ac 1 -b:a 48k sabiti, web tabanlı oyun müziğini tek kanal (mono) 48kbps yapar.
  // Mono kodlama sayesinde kanal başına düşen veri miktarı korunur, toplam boyut ~3.7 MB'a (hedefi bulacak şekilde %75 tasarrruf) düşer.
  try {
    execFileSync(ffmpegPath, ['-y', '-i', filePath, '-c:a', 'libmp3lame', '-ac', '1', '-b:a', '48k', tempPath], { stdio: 'ignore' });
    
    // Eski dosyanın yerine sıkıştırılmış dosyayı koy
    fs.renameSync(tempPath, filePath);

    const statAfter = fs.statSync(filePath);
    totalAfter += statAfter.size;
    const afterMB = (statAfter.size / (1024 * 1024)).toFixed(2);

    console.log(`✅ Tamamlandı: ${file} -> Yeni Boyut: ${afterMB} MB (Tasarruf: %${Math.round((1 - statAfter.size/statBefore.size)*100)})\n`);
  } catch (err) {
    console.error(`❌ ${file} sıkıştırılırken hata oluştu:`, err.message);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

console.log(`🎉 Özet:`);
console.log(`📦 Toplam Boyut: ${(totalBefore / (1024 * 1024)).toFixed(2)} MB -> ${(totalAfter / (1024 * 1024)).toFixed(2)} MB`);
console.log(`⚡ Boyut Azalma Oranı: %${Math.round((1 - totalAfter / totalBefore) * 100)} tasarruf sağlandı!`);
