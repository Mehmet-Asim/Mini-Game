# Quest of Legends — Yol Haritası ve İlerleme

Bu dosya projenin **nereden başladığını, ne yapıldığını ve ne kaldığını**
tutar. Teknik açıklamalar ve "nasıl çalışır" soruları `README.md`'de.

**Durum:** Planlanan dört fazın tamamı bitti. Oyun uçtan uca iki kişilik
oynanabilir durumda. Kalan işler [Kalan adımlar](#kalan-adımlar) bölümünde —
hiçbiri temel işlevi engellemiyor, hepsi cila ve saha doğrulaması.

Son güncelleme: dört faz tamamlandığında.

---

## Başlangıç noktası

Proje başladığında elde olan: Vite + vanilla JS, tek canvas, **tek kişilik**
platform oyunu. Üç bölüm, bir ejderha, prosedürel sprite çizimi. Config URL'e
base64 olarak gömülüydü, akış `setup → splash → game → proposal` şeklindeydi.

İstenen: oyunu **iki tarayıcıdan senkron oynanan co-op'a** çevirmek ve başına /
sonuna **sinematik sahneler** koymak. Teklif sahnesinde seçim hakkı yalnızca
karşı tarafta olmalıydı.

### Baştan alınan dört karar

| Karar | Seçilen | Neden |
|---|---|---|
| Ağ modeli | **Host-authoritative + relay sunucu** | Sunucu oyunu simüle etmiyor; fizik host'un tarayıcısında. İki kişilik özel bir oyunda hile riski konu dışı, kazanılan basitlik büyük. |
| Co-op derinliği | **Hibrit** — mevcut bölümler + co-op kapıları | Bölümleri sıfırdan bulmaca odaklı tasarlamak yerine var olanların üstüne 2-3 iş birliği noktası eklendi. |
| Sanat yönü | **Önce kodla çizim**, sonra yağlı boya ile değiştirilebilir | Katman soyutlaması sayesinde geçiş tek satır. |
| Sıra | **Sinematikler önce** | Erken görsel sonuç; co-op altyapısından bağımsız ilerleyebiliyordu. |

---

## Yapılanlar

### Faz 1 — Sinematik motoru ✅

Oyundan tamamen bağımsız, `#cine` adresinden tek başına çalışan bir sahne
motoru. **~3.900 satır.**

**Ne yapıldı**

- `director.js` — timeline motoru. Sahneler kod değil **veri**: her sahne bir
  `{ layers, camera, actors, cards, fades, shakes, cues, choice }` nesnesi.
- **Determinizm kuralı** — hiçbir yerde "önceki kareye göre ilerlet" yok, her
  şey `t`'nin saf fonksiyonu. Bu sayede `seek(t)` mümkün ve co-op senkronu
  bunun üstüne kuruldu.
- `stage.js` — 1280×720 sanal uzay, parallax'lı sanal kamera, post efektler.
- `layers.js` — **katman soyutlaması**: `proc()` / `image()` / `hybrid()`.
  Prosedürel çizim ile görsel dosyası aynı arayüzden işleniyor.
- `art/` — palet, gökyüzü, tepeler, ot tarlası, figürler, ejderha, atmosfer
  efektleri. Hepsi prosedürel, tohumlanmış rastgelelikle.
- 4 sahne: **intro** (30 sn, maceraya davet), **outro-ask** (15.5 sn, teklif +
  seçim), **outro-yes** (21 sn, gün batımı), **outro-no** (14 sn, ejderha dirilir).
- Metin kartları ve seçim kartları DOM'da — yazı keskin kalsın, metin
  değiştirmek kod işi olmasın diye.
- Tüm metinler tek dosyada: `src/cinematic/script.js`.

**Karşılaşılan sorunlar**

İlk render tamamen çalışıyordu ama sanat yönü zayıftı. PNG kare alıp gözle
bakınca çıkanlar: figürler ufuk çizgisinin altında kaldığı için çukurda duruyor
gibiydi, ışık huzmeleri yatay uçuyordu, "elini uzat" pozu kolu arkaya atıyordu,
bulutlar halka çıkarıyordu, güneş halesi gökyüzünde dikey bir kenar bırakıyordu,
ejderhanın sırt dikenleri gövdeden kopup çam ağacına benziyordu. Hepsi düzeltildi
ve kurallar README'ye yazıldı.

Ayrıca üç gerçek hata: **"Atla" tuşu teklifi tamamen es geçiyordu** (en kötüsü —
oyunun tek amacı o soru), CSS'te `margin-left: -min(...)` geçersiz olduğu için
kartlar ortalanmıyordu, ses işaretleri hiçbir metoda eşleşmediği için sinematikler
sessizdi.

Performans: ot katmanı kare maliyetinin %58'ini yiyordu (~5000 ayrı `stroke()`).
Renk+kalınlık kovalarına toplanınca 5 kat hızlandı, kare 15.2 → 9-11 ms.

---

### Faz 2 — Oda sunucusu ✅

Node + `ws`. **~950 satır sunucu + ~900 satır istemci ağ katmanı.**

**Ne yapıldı**

- `server/protocol.js` — hem Node hem tarayıcının import ettiği **tek kaynak**:
  mesaj tipleri, hata kodları, input bit maskesi, ağ sabitleri.
- `server/rooms.js` — oda yaşam döngüsü, soketten habersiz saf veri işlemleri
  (bu sayede soket açmadan test edilebiliyor).
- `server/store.js` — **depolama adaptörü**. `REDIS_URL` varsa Redis, yoksa
  bellek. Kod tarafında hiçbir fark yok.
- `server/index.js` — HTTP + WebSocket, mesaj aktarımı, jeton kovası ile hız
  sınırı, presence takibi, çok-instance için Redis pub/sub.
- `src/net/client.js` — `NetClient`: üstel geri çekilmeyle yeniden bağlanma,
  token ile odaya geri girme, heartbeat, RTT ölçümü.
- `src/views/lobbyView.js` — bekleme salonu: oda kodu, davet linki, iki koltuğun
  bağlantı/hazır durumu, ağ göstergesi.
- `setupView` oda açacak şekilde güncellendi; sunucu erişilemezse **tek kişilik
  yedek link** üretiyor.

**Önemli karar: Redis zorunlu değil.** Yerelde geliştirirken Redis kurdurmak
gereksiz bir engeldi. Sunucu tek instance çalıştığı sürece bellek deposu birebir
aynı işi görüyor.

**Karşılaşılan sorun**

Sunucu testinin ilk çalıştırmasında 5 kontrol düştü: aktarılan mesajlar karşı
tarafa hiç ulaşmıyordu. Sebep `encode(m.t, { ...m, t: undefined })` — spread,
`encode`'un koyduğu tipi eziyordu ve mesaj tipsiz gidiyordu.

---

### Faz 3a — Motoru iki oyunculuya çevirme ✅

861 satırlık motorun tek oyuncudan iki oyuncuya dönüşümü.

**Ne yapıldı**

- `player` → `players[]`, `input` → `inputs[]`. Tüm döngüler oyuncu sayısından
  bağımsız hale getirildi; `player` ve `input` eski kodun bozulmaması için takma
  ad olarak duruyor.
- Üç mod: `solo` (eski davranış), `local` (aynı klavyede iki kişi — bölüm
  tasarımını ağsız test etmek için), `net`.
- **Ortak can havuzu** ve **yere serilme**: co-op'ta can bitince oyuncu ölmüyor,
  yere seriliyor. Yoldaşı 46px yakınına gelip 1.15 sn durursa kaldırıyor;
  kimse gelmezse 14 sn sonra tur bitiyor; ikisi de yerdeyse hemen bitiyor.
  Kurtarma ödülü ortak cana +1.
- `camera.followGroup()` — iki oyuncuyu birden kadraja alan, mesafe açılınca
  yumuşakça uzaklaşan kamera.
- Ekran dışı yoldaş oku + mesafe göstergesi, karakter başına renk paleti,
  yerdeyken kaldırma halkası ve geri sayım.
- Düşman ve boss hedeflemesi: her varlık kendine **en yakın** oyuncuyu
  hedefliyor (AI kodu hiç değişmedi), yerdeki oyuncu son tercih.
- Bölüm sonu artık **ikisi de geçitte** olduğunda.

**Tasarım gerekçesi:** bu bir hediye, zorluk sınavı değil. Birinin hatası oyunu
bitirmemeli, "gel beni kurtar" anına dönüşmeli.

---

### Faz 3b — Co-op kapıları ✅

**Ne yapıldı**

- Üç yeni varlık: `Plate` (basınç plakası), `Gate` (kapı), `CoopLift` (ortak
  asansör). Çizimleri `world.js`'e eklendi, ortak bir "ikili halka" nişanıyla
  görsel dilde ayrıştırıldı.
- Üç bölüme de yerleştirildi:
  - **B1** — 284px arayla iki plaka + kapı (öğretici), ortak asansör
  - **B2** — uçurumun iki yakasında iki plaka (en güçlü co-op anı)
  - **B3** — biri zeminde biri raftaki platformda iki plaka
- Tek oyunculu modda bu diziler **hiç yüklenmiyor**; aynı bölüm dosyası her iki
  modda da oynanabiliyor.

**İki önemli karar**

1. **Kapılar bir kez açılınca kilitleniyor.** Yoksa klasik tuzak: ikisi
   plakalara basıp kapıyı açıyor, geçmek için plakadan iniyorlar, kapı
   kapanıyor — çözülemez bulmaca.
2. **Zamanlama hassasiyeti düşük.** Misafirin tuşları host'a 50-150 ms sonra
   ulaşıyor; "aynı anda bas" isteyen bir bulmaca internet üzerinden işkence
   olurdu. Her şey "basılı tut" mantığıyla çalışıyor.

**Karşılaşılan sorun**

İlk yerleşimler kötüydü: B1'de plaka bir dikenin dibindeydi, B3'te plakalar
uçurumun üstünde havada duruyordu, bir plakanın üstünde platform vardı. Uygun
noktaları hesaplayan bir script yazıldı, sonra bu kontroller kalıcı bir
**yerleşim denetleyicisine** dönüştürüldü (`test:coop` içinde). Ayrıca B1'deki
walker'ın devriye alanı plakayla çakışıyordu; devriye 1300 → 1430'a çekildi ve
bu bölüm tasarım kurallarına 7. madde olarak eklendi.

---

### Faz 3c — Netcode ✅

**Ne yapıldı**

- `snapshot.js` — 20 Hz dünya özeti. Alan adları tek harf, sayılar yuvarlanmış;
  paket ~10 kat küçüldü (max 4 KB, 13 KB/sn bant).
- **İnterpolasyon tamponu** — misafir 100 ms geçmişi oynatıyor, paketler arası
  harmanlama yapılıyor.
- **Uyarlanabilir gecikme** — paketler arası dalgalanma ölçülüyor, tampon ona
  göre büyüyor (kötüleşmeye hızlı, iyileşmeye yavaş tepki).
- **Client-side prediction** — misafir kendi tuşlarını anında uyguluyor, sonra
  host'un dediğiyle uzlaştırıyor. 90px'e kadar yumuşak düzeltme, üstü ışınlama.
- **Ölü hesap** — paket gecikirse son bilinen hızla en fazla 90 ms devam.
  Dondurmak daha kötü görünüyordu.
- `RemoteInput` — klavyeye değil ağa bağlı bir Input. `Player.update()` ikisini
  ayırt edemiyor; simülasyon hiçbir şeyin farkında olmadan dönüyor.
- `session.js` — `CoopSession`: motoru ve sinematiği ağa bağlayan katman.
  Motor ağdan habersiz, ağ oyundan habersiz.

**Misafir dünyayı simüle etmiyor.** Düşman/boss/mermi yapay zekâsı yalnızca
host'ta çalışıyor; iki tarayıcıda kayan noktalı fizik asla birebir aynı kalmaz.

**Karşılaşılan sorunlar**

Simülasyon testi iki gerçek hata yakaladı:

1. **Sırasız paketler yoldaşı geri sardırıyordu.** Gecikme dalgalanması paket
   sırasını bozunca tampon eski bir kareyi yeni sanıp aralarında interpolasyon
   yapıyordu. Oyuncunun "ışınlanma" diye gördüğü şey buydu. Geç kalan paketi
   atınca kötü ağdaki takılma 19 → 12 px düştü.
2. **Klavye sabit index 0'a bağlıydı**, `localIndex`'e değil. Misafir kendi
   karakterini oynatamıyordu.

---

### Faz 4 — Akış birleştirme ✅

```
#setup → oda aç → BEKLEME SALONU → host "BAŞLA"
   → INTRO SİNEMATİĞİ (senkron)
   → BÖLÜM 1 → 2 → 3 (co-op)
   → OUTRO-ASK + SEÇİM (kartlar yalnız misafirde tıklanabilir)
   → OUTRO-YES | OUTRO-NO
```

**Ne yapıldı**

- Sinematik saati host tarafından 4 Hz yayınlanıyor, misafir `syncTo()` ile
  kilitleniyor.
- **Seçim yetkisi misafirde.** Host'un ekranında kartlar görünüyor ama
  tıklanamıyor ve altında "Karar onun" yazıyor. Misafirin cevabı ağdan host'a
  gidiyor, host kendi yönetmenini o cevapla sürüyor — yoksa host'un sahnesi
  seçim ekranında sonsuza dek beklerdi.
- Atlama yetkisi host'ta (iki taraf ayrı ayrı atlarsa sahneler ayrışır).
- Yoldaşın bağlantısı koparsa oyun duraklıyor ve kaplama beliriyor.
- Co-op HUD: yoldaşın adı, rengi, yerdeyse kaldırma çubuğu ve geri sayım.
- Tek kişilik akış (`?d=` linki) hiç bozulmadan duruyor.

---

## Test altyapısı

Dört paket, **97 kontrol**, `npm test` ile ~15 saniyede tamamı.

| Paket | Kontrol | Bağımlılık | Ne doğruluyor |
|---|---|---|---|
| `check:scenes` | — | yok | NaN/bozuk renk/çizim hatası, `seek()` determinizmi, kart çakışması, seçim akışı |
| `test:server` | 31 | `ws` | Gerçek sunucu + gerçek soketler: oda akışı, aktarım, yetki, kopma/geri dönme, token sızıntısı |
| `test:coop` | 50 | yok | Motor başsız çalıştırılıyor: kapılar tek kişiyle açılamıyor mu, kaldırma döngüsü, solo mod bozulmadı mı, yerleşim denetimi |
| `test:net` | 15 | yok | İki motor + yapay ağ (gecikme, dalgalanma, kayıp, sıra bozulması): sapma, takılma, bant genişliği |

Ek araçlar: `npm run shots` (sahnelerden PNG kare — sinematik sanatı gözle
görmeden ayarlanamıyor), `npm run perf` (kare maliyeti ve en pahalı katman).

**Ölçülen netcode performansı**

| Senaryo | Yoldaş sapması | Kendi sapması | Düşman | Bant |
|---|---|---|---|---|
| İyi ağ (45 ms) | 8 px | 20 px | 1 px | 13 KB/sn |
| Kötü ağ (150 ms, %5 kayıp) | 17 px | 28 px | 3 px | 13 KB/sn |

---

## Kalan adımlar

Hiçbiri temel işlevi engellemiyor. Öncelik sırasına göre:

### 1. Saha doğrulaması (yapılmadı — en önemlisi)

- [ ] **İki gerçek cihazda uçtan uca oynanış.** Şu ana kadar her şey başsız
      simülasyonla doğrulandı; tarayıcıda iki pencere açıp baştan sona
      oynanmadı.
- [ ] **Oyun ortasında yeniden bağlanma.** Sunucu testinde token akışı
      doğrulandı ama bölüm ortasında sekme kapatıp geri dönme tarayıcıda
      denenmedi.
- [ ] **Mobil dokunmatik kontroller co-op'ta.** Dokunmatik katman yerel
      oyuncuya bağlanıyor ama iki cihazda test edilmedi.
- [ ] Gerçek internet üzerinden gecikme ölçümü (simülasyon 45/150 ms
      varsayıyor).

### 2. Dağıtım

- [ ] WebSocket destekli bir barındırıcı seç (Railway / Fly.io / Render —
      **Vercel serverless olmaz**).
- [ ] Redis bağla (Upstash ücretsiz katmanı yeterli) ve `REDIS_URL` ver.
- [ ] `npm run build && npm run server:dist` ile tek servis dağıtımı dene —
      sunucu hem WebSocket'i hem `dist/`'i servis eder, CORS derdi kalmaz.
- [ ] Sunucu uyku modundan kalkarken bekleme salonuna "sunucu uyanıyor"
      durumu ekle (ücretsiz katmanlarda ilk istek yavaş).

### 3. İçerik ve cila

- [ ] **Metinleri gözden geçir.** Şu anki metinler yer tutucu kalitesinde;
      `src/cinematic/script.js` tek dosya, düzenlemesi 10 saniyelik iş.
- [ ] **Eksik üç ses**: `windSwell` (rüzgâr yükselişi), `duskAmbience`
      (alacakaranlık ambiyansı), `sunsetTheme` (kapanış teması). `CUE_MAP`
      içinde `null` duruyorlar; `audio.js` dosya kullanmıyor, WebAudio ile
      sentezlenmeleri gerekiyor.
- [ ] Sahne temposunu birlikte ayarla (kart süreleri, kamera hareketleri).
- [ ] Zemin dokusu biraz düz — yağlı boya görsellere geçilecekse zaten
      değişecek, o yüzden ertelendi.

### 4. Opsiyonel — yağlı boya görseller

Altyapı hazır. Yapılacak:

- [ ] 6-8 görsel üret (gökyüzü, tepeler, çayır — sahne başına arka plan).
- [ ] `public/cine/` altına koy.
- [ ] İlgili sahnede `proc(...)` satırını `image(...)` ya da `hybrid(...)` yap.
- [ ] O sahnenin paletini görselden örneklenen renklere güncelle (prosedürel
      kalan katmanlar rengi paletten alıyor).

**Ön plan otları, polen ve ışık huzmeleri kodda kalmalı** — statik bir görselin
üstünde hareket eden tek şey onlar olacak.

### 5. Opsiyonel — oynanış derinliği

- [ ] Boss savaşı için açık bir co-op rol mekaniği. Şu an ejderha en yakın
      oyuncuyu hedeflediği için doğal olarak "biri dikkat çeker, diğeri vurur"
      oluyor ama bu bilinçli tasarım değil, yan etki.
- [ ] Bölüm 2 ve 3'e ortak asansör. Şu an yok çünkü o bölümlerde 200px'lik boş
      dikey sütun bulunamadı; zorla sıkıştırmak yerine plaka/kapıyla bırakıldı.
      Bölüm geometrisi değiştirilirse eklenebilir.
- [ ] Bekleme salonuna sohbet (protokolde `chat` mesajı zaten var, arayüzü yok).

### 6. Temizlik

- [ ] `.attic/` klasöründeki kullanılmayan dosyaları sil (Vite şablonu
      artıkları ve `game/render.js` — `render/renderer.js` ile çakışan eski
      çizim hattı).
- [ ] `node_modules/@napi-rs` altında sandbox'tan kalma kırık bir sembolik
      bağlantı olabilir; zararsız, silinebilir.
- [ ] `dist/` klasöründe eski bir derleme olabilir; `npm run build` ile tazele.

---

## Proje büyüklüğü

| Alan | Satır |
|---|---|
| Sinematik motoru | ~3.900 |
| Oyun motoru | ~3.300 |
| Çizim | ~2.700 |
| Test araçları | ~1.500 |
| Görünümler | ~1.400 |
| Sunucu | ~950 |
| İstemci ağ katmanı | ~900 |
| Çekirdek (input, kamera, parçacık) | ~770 |
| **Toplam** | **~16.300 satır / 55 dosya** |
