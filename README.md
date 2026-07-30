# Quest of Legends

Bir çıkma teklifi, **iki kişilik** orta çağ fantezi platform oyunu kılığında.

Teklifi hazırlayan kişi gizli bir kurulum ekranından adları ve soruyu girer,
çıkan davet linkini karşı tarafa gönderir. Karşı taraf sadece bir macera oyunu
görür: üç bölüm, bazı kapılar tek başına açılmıyor, sonunda bir ejderha. Oyun
bitince gerçek amaç ortaya çıkar ve soru sorulur — cevabı **yalnızca karşı taraf
verebilir**.

> Bu dosya, projeyi devralacak bir geliştirici ya da AI ajanı için yazıldı.
> Sadece "ne var" değil, **neden böyle** ve **nereye dokunursan ne kırılır** da
> anlatılıyor.

---

## Hızlı başlangıç

```bash
npm install
npm run server     # 1. terminal — oda sunucusu (:8787)
npm run dev        # 2. terminal — istemci (:5173)
```

İki tarayıcı penceresi aç:

1. Birinci pencerede `http://localhost:5173/#setup` → formu doldur → **ODAYI AÇ**
2. Bekleme salonundaki daveti kopyala, ikinci pencereye yapıştır
3. Birinci pencerede **MACERAYA BAŞLA**

Sunucu çalışmıyorsa kurulum ekranı tek kişilik yedek link üretir; oyun co-op
olmadan yine oynanır.

| Adres | Ne gösterir |
|---|---|
| `/#setup` | Gizli kurulum. Oda açar. **Başlangıç adresi.** |
| `/?r=ABCDE` | Co-op daveti — misafir buraya gelir |
| `/?d=<base64>` | Tek kişilik yedek link (sunucusuz) |
| `/#cine` | Sinematik sahne galerisi (4 sahne, oyundan bağımsız) |
| `/#cine=intro` | Tek sahneyi doğrudan oynat |
| `:8787/health` | Sunucu durumu (JSON) |

### Komutlar

```bash
npm run dev            # istemci geliştirme sunucusu
npm run server         # oda sunucusu
npm run server:dist    # sunucu + dist/ klasörünü de servis et (tek servis dağıtımı)
npm run build          # üretim derlemesi

npm test               # dört test paketinin tamamı (~15 sn)
npm run check:scenes   # sahne denetimi     — bağımlılıksız
npm run test:server    # sunucu uçtan uca   — ws gerekir
npm run test:coop      # co-op motor testi  — bağımlılıksız
npm run test:net       # netcode simülasyonu— bağımlılıksız

npm run shots          # sahnelerden PNG kare al (npm i -D @napi-rs/canvas)
npm run perf           # kare maliyeti + en pahalı katman
```

**Her commit öncesi `npm test`.** Neden bu kadar önemli olduğu
[Test ve araçlar](#test-ve-araçlar) bölümünde.

---

## Proje durumu

| Faz | İş | Durum |
|---|---|---|
| **1** | Sinematik motoru + 4 sahne | ✅ Bitti |
| **2** | Node + ws + Redis oda sunucusu, bekleme salonu | ✅ Bitti |
| **3a** | Motoru iki oyunculuya çevirme, ortak can, dinamik kamera | ✅ Bitti |
| **3b** | Co-op kapıları (plaka, kapı, ortak asansör) | ✅ Bitti |
| **3c** | Netcode: snapshot, interpolasyon, prediction, reconnect | ✅ Bitti |
| **4** | Akış birleştirme: kurulum → salon → intro → oyun → final | ✅ Bitti |

Kalan işler [Bilinen eksikler](#bilinen-eksikler) bölümünde.

---

## Mimarinin tamamı tek bakışta

```
  TEKLİFİ HAZIRLAYAN (host)                    KARŞI TARAF (misafir)
  ────────────────────────────                 ────────────────────────────
  #setup → oda aç                              ?r=KOD → odaya katıl
        │                                            │
        └────────────► BEKLEME SALONU ◄──────────────┘
                            │  host "BAŞLA" der
                            ▼
                    INTRO SİNEMATİĞİ          (host saati yayınlar,
                            │                  misafir kilitlenir)
                            ▼
                   BÖLÜM 1 → 2 → 3 (boss)     (host simüle eder,
                            │                  misafir tahmin + görüntü)
                            ▼
                    OUTRO-ASK + SEÇİM          (kartlar SADECE misafirde
                            │                   tıklanabilir)
              ┌─────────────┴─────────────┐
              ▼                           ▼
        OUTRO-YES                   OUTRO-NO
     (gün batımı)                (ejderha dirilir → tekrar)
```

**Yetki modeli: host-authoritative.** Sunucu oyunu simüle etmez; oda
eşleştirme, varlık takibi ve mesaj aktarımı yapar. Fizik host'un tarayıcısında
döner. İki kişilik özel bir oyun için hile riski konu dışı, karşılığında
kazanılan basitlik çok büyük.

---

## Dizin haritası

```
server/                        Oda sunucusu (Node)
├── index.js                   HTTP + WebSocket, mesaj aktarımı, hız sınırı
├── rooms.js                   Oda yaşam döngüsü — soketten habersiz, saf veri
├── store.js                   Depolama adaptörü: bellek ↔ Redis
└── protocol.js                ★ İSTEMCİYLE PAYLAŞILAN tek kaynak
                                 (mesaj tipleri, input bit maskesi, sabitler)

src/
├── main.js                    Yönlendirici + akış orkestrasyonu (Faz 4)
├── style.css                  Tasarım sistemi + sinematik + salon + co-op HUD
├── audio.js                   WebAudio ile prosedürel ses (dosya yok)
│
├── net/                       İstemci ağ katmanı
│   ├── client.js              NetClient: bağlan, yeniden bağlan, heartbeat
│   ├── snapshot.js            Anlık görüntü serileştirme + interpolasyon tamponu
│   └── session.js             CoopSession: motoru ve sinematiği ağa bağlar
│
├── views/                     Ekranlar. (container) alır, cleanup() döner.
│   ├── setupView.js           Gizli kurulum → oda açar (yedek: base64 link)
│   ├── lobbyView.js           Bekleme salonu
│   ├── splashView.js          Tek kişilik "Başla" ekranı
│   ├── gameView.js            HUD, duraklat, co-op göstergesi — motoru sarar
│   ├── proposalView.js        Tek kişilik teklif ekranı (kaçan "Hayır")
│   ├── cinematicView.js       Sinematik oynatıcı
│   └── cineGalleryView.js     #cine test tezgâhı
│
├── core/
│   ├── input.js               Klavye (3 tuş şeması) + RemoteInput (ağ)
│   ├── camera.js              Takip + followGroup (iki oyuncuyu kadraja alma)
│   ├── particles.js
│   └── utils.js
│
├── game/
│   ├── engine.js              Ana döngü, durum makinesi, çarpışma, co-op mantığı
│   ├── player.js              Fizik (PHYS) + yere serilme/kaldırma
│   ├── entities.js            Düşmanlar, platformlar + Plate / Gate / CoopLift
│   ├── boss.js                Ejderha savaşı
│   └── levels.js              ★ Veri odaklı bölümler + tasarım kuralları
│
├── render/
│   ├── renderer.js            Çizim hattı + co-op göstergeleri
│   ├── background.js          Tema bazlı parallax
│   ├── sprites.js             Şövalye (palet destekli), düşmanlar, ejderha
│   └── world.js               Platform, diken, kalp + plaka/kapı/asansör
│
└── cinematic/                 Sinematik motoru (Faz 1)
    ├── director.js            Timeline motoru — zaman → sahne durumu
    ├── stage.js               Katman kompozitörü, sanal kamera, post efektler
    ├── layers.js              Katman soyutlaması (prosedürel ↔ görsel)
    ├── cards.js / choice.js   Metin ve seçim kartları (DOM)
    ├── script.js              ★ TÜM SİNEMATİK METİNLERİ
    ├── easing.js / rng.js
    ├── art/                   palette, sky, hills, grass, figures, dragon, fx
    └── scenes/                intro, outro-ask, outro-yes, outro-no

tools/                         Geliştirme araçları (üretime girmez)
├── scene-check.mjs            Sahne denetimi
├── server-test.mjs            Sunucu uçtan uca testi
├── coop-test.mjs              Co-op motor testi (başsız)
├── net-sim-test.mjs           Netcode simülasyonu (yapay gecikme)
├── scene-shots.mjs            PNG kare alma
└── scene-perf.mjs             Performans ölçümü
```

---

## Co-op

### Oyuncu modelleri

`GameEngine` üç modda çalışır. **Tek oyunculu oyun hiç bozulmadı** — tüm
döngüler oyuncu sayısından bağımsız.

| `mode` | Ne yapar |
|---|---|
| `solo` | Tek oyuncu. Co-op kapıları hiç yüklenmez, ölüm eski davranış. |
| `local` | Aynı klavyede iki kişi. Bölüm tasarımını ağ olmadan test etmek için. |
| `net` | İkinci oyuncu ağdan. `netMode` ile `host` / `guest` ayrımı. |

`localIndex` bu tarayıcıdaki oyuncunun sırası (host 0, misafir 1). **Klavye her
zaman `localIndex`'e bağlanır** — ilk sürümde sabit 0'a bağlıydı ve misafir
kendi karakterini oynatamıyordu.

### Yere serilme ve kaldırma

Tek oyuncuda can bitince ölüm. Co-op'ta can bitince oyuncu **yere serilir**:

- Yoldaşı 46px yakınına gelip 1.15 saniye durursa kaldırır
- Kimse gelmezse 14 saniye sonra tur biter
- İkisi de yerdeyse tur hemen biter
- Kurtarma ödülü: ortak cana +1

Neden böyle: bu bir hediye, zorluk sınavı değil. Birinin hatası oyunu bitirmemeli,
"gel beni kurtar" anına dönüşmeli.

### Co-op mekanizmaları

| Mekanizma | Kural | Nerede |
|---|---|---|
| **Basınç plakası** | Üstünde biri durdukça aktif | 3 bölümde de |
| **Kapı** | `needs` içindeki TÜM plakalar aktifken açılır, sonra **açık kalır** | 3 bölümde de |
| **Ortak asansör** | Yalnızca iki oyuncu da üstündeyken yükselir | B1 |

**Kapılar neden kilitleniyor?** Klasik tuzak: ikisi plakalara basıp kapıyı
açıyor, geçmek için plakadan iniyorlar, kapı kapanıyor — çözülemez bulmaca.
`once: true` (varsayılan) bunu engelliyor.

**Zamanlama hassasiyeti neden düşük?** Misafirin tuşları host'a 50-150 ms sonra
ulaşıyor. "Aynı anda bas" isteyen bir bulmaca internet üzerinden işkence olurdu.
Her şey "basılı tut" mantığıyla çalışıyor.

Bölüm verisine ekleme (`src/game/levels.js`):

```js
plates: [
  { id: 'p1', x: 1000, y: GROUND_Y - 12, w: 48 },
  { id: 'p2', x: 1290, y: GROUND_Y - 12, w: 56 }
],
gates: [
  { x: 1390, y: GROUND_Y - 150, w: 24, h: 150, needs: ['p1', 'p2'], label: 'Orman Kapısı' }
],
coopLifts: [
  { x: 2140, y: GROUND_Y - 18, w: 120, rise: 150, speed: 58 }
]
```

> Yerleşim `npm run test:coop` tarafından denetleniyor: plaka havada mı, dikenin
> dibinde mi, üstünde platform var mı, asansörün yolu açık mı, iki plaka tek
> oyuncuyla kapsanabiliyor mu. **Yeni bölüm mekanizması eklerken testi çalıştır** —
> bu kontrollerin hepsi gerçek hatalardan doğdu.

---

## Ağ katmanı

### Protokol

`server/protocol.js` hem Node hem tarayıcı tarafından import edilir. İçinde
Node'a veya DOM'a özgü hiçbir şey olamaz.

| Mesaj | Yön | İçerik |
|---|---|---|
| `create` / `join` / `resume` | istemci → sunucu | oda aç / katıl / token ile geri dön |
| `ready` / `start` | istemci → sunucu | salon durumu, oyunu başlat (yalnız host) |
| `input` | misafir → host | `{ seq, bits }` — 30 Hz, tuşlar tek sayıya paketli |
| `snap` | host → misafir | `{ k, d }` — 20 Hz dünya özeti |
| `scene` | host → misafir | sinematik saati, 4 Hz |
| `choice` | misafir → host | teklif cevabı |
| `halt` | misafir → host | `{ on }` — misafir duraklattı / devam etti |
| `lobby` / `peer` / `error` | sunucu → istemci | salon durumu, karşı taraf olayları |

Tuş durumu `packInput()` ile 10 bitlik tek sayıya paketleniyor: JSON'da ~60 bayt
yerine ~1 bayt. Saniyede 30 paket × 2 saat oyun düşünülünce fark ediyor.

### Anlık görüntü ve interpolasyon

Misafir **100 ms geçmişi oynatır**. Gelen paketler doğrudan ekrana basılmaz;
tampona konur, aralarında interpolasyon yapılır. Bedeli 100 ms gecikme, karşılığı
pürüzsüz hareket.

Üç mekanizma bunu ayakta tutuyor:

1. **Uyarlanabilir tampon** — paketler arası dalgalanma ölçülür, tampon ona göre
   büyür (kötüleşmeye hızlı, iyileşmeye yavaş tepki).
2. **Sırasız paket atılır** — gecikme dalgalanması paket sırasını bozabiliyor;
   eski paket işlenirse yoldaş bir an **geri sarıyor**. Oyuncunun "ışınlanma"
   diye gördüğü şey tam olarak buydu; `npm run test:net` bunu yakaladı.
3. **Ölü hesap (dead reckoning)** — paket gecikirse son bilinen hızla en fazla
   90 ms devam ettirilir. Dondurmak daha kötü görünüyor.

**Kendi karakterin istisna:** misafir kendi tuşlarını anında uygular
(client-side prediction), sonra host'un dediğiyle uzlaştırır. 90px'e kadar sapma
yumuşak düzeltilir, üstü ışınlanır.

**Misafir dünyayı simüle etmez.** Düşman/boss/mermi yapay zekâsı yalnızca
host'ta çalışır. İki tarayıcıda kayan noktalı fizik asla birebir aynı kalmaz;
birkaç saniyede düşmanlar iki ekranda farklı yerlere giderdi.

### Ölçülen performans (`npm run test:net`)

| Senaryo | Yoldaş sapması | Kendi sapması | Düşman | Bant |
|---|---|---|---|---|
| İyi ağ (45 ms) | 8 px | 20 px | 1 px | 13 KB/sn |
| Kötü ağ (150 ms, %5 kayıp) | 17 px | 28 px | 3 px | 13 KB/sn |

### Sunucu ve dağıtım

**Redis zorunlu değil.** `REDIS_URL` tanımlıysa Redis, değilse bellek deposu
kullanılır — kod tarafında hiçbir fark yok. Redis şu iki durumda gerekli:

- Sunucu birden fazla instance ile çalışacaksa (iki oyuncu farklı instance'a
  düşerse bellek deposu onları birbirinden habersiz bırakır)
- Sunucu yeniden başlatıldığında devam eden odalar kaybolmasın isteniyorsa

Dağıtım notları:

- **WebSocket destekli barındırıcı şart** — Vercel serverless olmaz.
  Railway / Fly.io / Render uygun.
- Redis için Upstash ücretsiz katmanı yeterli.
- Tek servis dağıtımı: `npm run build && npm run server:dist` → sunucu hem
  WebSocket'i hem `dist/` klasörünü servis eder, CORS derdi kalmaz.
- İstemci sunucu adresini `VITE_WS_URL` ile de alabilir; verilmezse aynı
  origin'den türetir (geliştirmede 5173 → 8787).

---

## Sinematik motoru

### Temel kural: her şey zamanın saf fonksiyonudur

Hiçbir yerde "önceki kareye göre ilerlet" yok. Aktör konumu, kamera, kart
opaklığı, sarsıntı — hepsi `t` verildiğinde hesaplanır.

```js
director.evaluate(12.4)   // 12.4. saniyedeki sahne durumunun tamamı
```

Bu yüzden `seek(t)` mümkün ve **co-op senkronu bunun üstüne kurulu**: host
`time` yayınlar, misafir `syncTo(time)` çağırır, iki tarayıcı kare kare aynı
sahneyi gösterir. Rastgelelik de tohumlanmış (`rng.js`); `Math.random()`
kullanılsaydı ot yaprakları titrer ve iki tarayıcıda farklı manzara çıkardı.

`npm run check:scenes` bu determinizmi doğrular. **Bozulursa co-op çalışmaz.**

### Koordinat sistemi

Her şey **1280 × 720 sanal uzayda** çizilir, kadraja "cover" ile oturur.

| Sabit | Değer | Anlamı |
|---|---|---|
| `VW`, `VH` | 1280, 720 | Sanal kadraj |
| `HORIZON` | 432–446 | Ufuk çizgisi |
| `GROUND` | **596** | Aktörlerin bastığı çizgi |
| Figür boyu | `108 × scale` (≈205 px) | |

`GROUND = 596` keyfi değil: ayak 596 + boy 205 → baş 391, yani ufkun ~40px
üstünde. İlk denemede baş ufkun altındaydı ve karakterler çukurda duruyor gibi
görünüyordu.

### Sahne şeması

Sahneler kod değil **veri**:

```js
{
  id, duration, next, clear, letterbox, grain, vignette,
  layers:  [ ... ],                                    // bkz. layers.js
  camera:  [ { t, x, y, zoom, ease } ],
  actors:  { hero: { keys: [ { t, x, y, facing, anim, alpha, scale, ease } ] } },
  cards:   [ { t, dur, text, pos, style, typeDur } ],
  fades:   [ { t, dur, from, to, color } ],
  flashes: [ { t, dur, color, power } ],
  shakes:  [ { t, dur, power } ],
  cues:    [ { t, sfx } ],
  choice:  { t, question, options: [ { id, label, hint, glyph } ] }
}
```

- `actors[].keys`: `x, y, alpha, scale, rot` interpolasyona girer;
  `facing, anim` **basamak** değerdir (bir keyframe'den sonrakine kadar geçerli).
- `cards.pos`: `bottom` | `top` | `center` | `left` | `right`
- `cards.style`: `normal` | `whisper` | `hero`
- `choice`: varsa `t` anında **sahne durur**, cevap gelene kadar zaman akmaz.
- Aynı `pos`'ta iki kart aynı anda görünürse üst üste binerler — `check:scenes`
  bunu yakalar.

### Katman sistemi — yağlı boyaya geçiş

Projenin en önemli mimari kararı: **bugün kodla çizilen her katman, yarın yağlı
boya bir görselle tek satır değiştirilebilsin.**

```js
proc('sky', 0, 0.04, (ctx, api) => drawSky(ctx, P, api.t))   // prosedürel
image('sky', 0, 0.04, 'cine/sky.webp')                       // görsel
hybrid('sky', 0, 0.04, 'cine/sky.webp', drawSkyFallback)     // varsa görsel, yoksa çizim
```

İmza: `(id, z, parallax, draw|src, extra?)`. Timeline, kamera, kartlar, sesler
**hiç değişmez** — sadece o katmanın piksel kaynağı değişir.

| Katman | parallax | Görselle değişir mi? |
|---|---|---|
| Gökyüzü / güneş / bulut | 0.04 | ✅ ilk aday |
| Dağlar / tepeler / pus | 0.09–0.18 | ✅ |
| Çayır zemini | 0.52–0.55 | ✅ |
| Aktörler | 1.00 | ✅ (ayrı PNG) |
| Işık huzmeleri | 0.28 | ❌ **kodda kalsın** |
| Zerreler / polen | 1.05 | ❌ **kodda kalsın** |
| **Ön plan otları** | 1.30–1.35 | ❌ **kesinlikle kodda kalsın** |

Son üçü statik bir görselin üstünde hareket eden tek şey olacak. Kaldırırsan
manzara fotoğrafa döner.

### Ses

Sahneler soyut işaret adı verir (`dragonWake`); `cinematicView.js` içindeki
`CUE_MAP` bunu `audioManager` metoduna eşler. Karşılığı olmayanlar `null`.
**Yeni ses eklerken sadece bu tabloyu güncelle.**

---

## Sık yapılan işler

| İş | Nereye dokun |
|---|---|
| Sinematik metinlerini değiştir | `src/cinematic/script.js` |
| Sahne temposunu ayarla | İlgili sahne dosyasındaki `cards[].t` / `camera[].t` |
| Yeni sahne ekle | `scenes/yeni.js` → `scenes/index.js` → `cineGalleryView.js` |
| Yeni aktör pozu | `art/figures.js` → `getPose()`. **Pozitif açı = öne** |
| Yeni palet | `art/palette.js` — tüm alanlar dolu olmalı |
| Co-op kapısı ekle | `levels.js` → `plates` / `gates` / `coopLifts`, sonra `npm run test:coop` |
| Yeni ağ mesajı | `server/protocol.js` (tek kaynak) → sunucuda `handle()` → istemcide `session.js` |
| Bölüm geometrisi | `levels.js` — dosya başındaki 6 sert kural |

---

## Test ve araçlar

### `npm run check:scenes` — bağımlılıksız, ~2 sn

Her sahneyi 20 Hz'de baştan sona sahte bir 2D context'e çizdirir.

**Neden gerekli:** Canvas API'si NaN koordinat veya bozuk renk stringi aldığında
**hata vermez, sadece çizmez.** `rgba(255, NaN, 0, 1)` sessizce yok sayılır; bir
matematik hatası aylarca fark edilmeden durabilir.

Yakaladıkları: NaN/Infinity değerler, bozuk renkler, çizim istisnaları,
doldurulmamış `{hero}` yer tutucuları, üst üste binen kartlar, **`seek()`
determinizmi**, seçim akışı (duruyor mu, atlanabiliyor mu).

### `npm run test:server` — gerçek sunucu, gerçek soketler

Sunucuyu başlatır, iki WebSocket istemcisi bağlar, oda akışının tamamını
doğrular: oluşturma/katılma, salon yayını, mesaj aktarımı (ve gönderene geri
dönmemesi), dolu oda, hazır durumu, yetki (misafir başlatamaz), kopma → token
ile geri dönme, geçersiz token, bozuk mesaj dayanıklılığı, **token sızıntısı**.

### `npm run test:coop` — motor, başsız

Minik bir DOM taklidi kurup motoru gerçek fizik adımlarıyla döndürür.
"Tarayıcıda bir bakarım" ile doğrulanamayacak şeyleri ölçer:

- Çift plakalı kapı **tek oyuncuyla açılamıyor** mu ← co-op'un tüm anlamı
- Bir oyuncu iki plakaya birden basabiliyor mu
- Ortak asansör tek kişiyle kalkıyor mu
- Yere serilme → kaldırma döngüsü
- Bölüm yalnızca ikisi de geçitteyken bitiyor mu
- **Tek oyunculu mod bozulmadı mı**
- Co-op yerleşim denetimi (plaka havada mı, asansörün yolu açık mı...)
- Teklif akışı: misafir seçiyor, host ağdan gelen cevapla devam ediyor

> Mekanizma testlerinde düşmanlar kapatılıyor: rastgele başlangıç fazları
> yüzünden bir yarasa oyuncuyu plakadan itebiliyor ve test kararsız oluyordu.

### `npm run test:net` — netcode simülasyonu

İki `GameEngine` örneği (host + misafir) arasına yapay ağ koyar: gecikme,
dalgalanma, paket kaybı, **sıra bozulması**. Sonra misafirin ekranındaki
dünyanın host'un 100 ms önceki haline ne kadar benzediğini ölçer.

Ölçtükleri: yoldaş/kendi/düşman konum sapması, **fazladan takılma** (misafirin
kare farkı eksi host'un kare farkı), kapı tutarlılığı, paket boyutu, bant
genişliği.

> Bu test iki gerçek hata yakaladı: sırasız paketlerin yoldaşı geri sardırması
> ve sabit tamponun kötü ağda yetersiz kalması.

### `npm run shots` / `npm run perf`

`@napi-rs/canvas` gerektirir (opsiyonel: `npm i -D @napi-rs/canvas`).
`shots` sahnelerin kritik anlarını `tools/shots/` klasörüne PNG olarak yazar —
sinematik sanatı gözle görmeden ayarlanamıyor. `perf` kare maliyetini ve en
pahalı katmanı raporlar; şu an kare başına ~9-12 ms.

---

## Acı çekerek öğrenilen kurallar

Hepsi gerçek hatalardan doğdu. Bu koda dokunan herkes okumalı.

### Oyun / ağ

| Kural | Neden |
|---|---|
| **Klavye `localIndex`'e bağlanır, index 0'a değil** | Sabit 0'a bağlıydı; misafir kendi karakterini oynatamıyordu. |
| **Sırasız ağ paketini at** | Gecikme dalgalanması sırayı bozunca eski kare işleniyor ve yoldaş geri sarıyordu. |
| **Misafir dünyayı simüle etmemeli** | Kayan noktalı fizik iki tarayıcıda birebir aynı kalmaz; saniyeler içinde ayrışır. |
| **Co-op kapıları bir kez açılınca kilitlensin** | Yoksa plakadan inip geçmeye çalışırken kapı kapanıyor — çözülemez bulmaca. |
| **`{ ...m, t: undefined }` mesaj tipini siler** | Spread, `encode`'un koyduğu tipi eziyordu; aktarılan mesajlar tipsiz gidiyordu. |
| **Zamanlama hassasiyeti düşük tut** | Ağ gecikmesi "aynı anda bas" bulmacalarını işkenceye çeviriyor. |
| **Atla tuşu teklifi es geçmemeli** | Sona değil, SORUYA atlamalı; oyunun tek amacı o soru. |
| **Duraklatmanın SAHİBİ olmalı (`'local'` \| `'net'`)** | Sahipsiz duraklatmada misafir host'un duraklatmasıyla donuyor, host devam edince bir daha çıkamıyordu — oyun onun için orada bitiyordu. |
| **Misafirin duraklatması host'a da gitmeli (`HALT`)** | Tek yönlüyken misafir menü açıkken donmuş karakteri sahada savunmasız kalıyor ve ORTAK candan kaybettiriyordu. |
| **Geçici host durumlarını (`levelDone`) misafir kendi temposunda bitirir** | Host o durumda 1.4 sn kalıyor; misafir ~100 ms geç giriyor. Dışarı çekilirse geçişi hiç tamamlamıyor, kilitlenmezse perde 4 kez açılıyor. İkisi de ölçüldü. |
| **Anlık görüntüyle durum değişince `stateTimer` sıfırlanır** | Sıfırlanmazsa misafir bölüm sonu perdesine devraldığı sayaçla girip animasyonu hiç görmüyor. |
| **Bölümü baştan yükleme kararı host'ta (`rs` sayacı)** | Toplanma bit maskesi yalnızca "toplandı" yönünde taşınıyor; sinyal olmadan misafir kalpsiz, kalkansız bir bölümde dolaşıyordu. |
| **Anlatı verisi (hatıralar) ağdan geçmeli** | `storyUnlocked` yalnızca host'ta işleniyordu: teklifi ALAN kişi tek bir hatıra kartı görmüyor, final ekranına hatırasız giriyordu. |

### Prosedürel sanat

| Kural | Neden |
|---|---|
| **Figürün başı ufkun üstünde olmalı** | Altında kalırsa karakter çukurda duruyor gibi görünür. |
| **Kol açısında pozitif = öne** | Negatif açı eli arkaya atıyordu; "elini uzat" pozu ters çalışıyordu. |
| **Kenar ışığı bakış yönüne değil IŞIK yönüne bakar** | Karakter sola dönünce çizim uzayı aynalanıyor, parıltı yanlış tarafta kalıyor. |
| **Gradyan dolgu dikdörtgeni yarıçaptan büyük olmalı** | Küçükse parıltı kenarda kesiliyor, gökyüzünde dikey çizgi beliriyor. |
| **Eş merkezli üst üste geçişler halka konturu yapar** | Bulutlar donut gibi görünüyordu. Doğrusu: tek path, tek dolgu, dikey gradyan. |
| **Sis SADECE bir bantta kalmalı** | Ekranın altına kadar dolduran sis tüm zemini bej perdeye çeviriyordu. |
| **Üçgen dizerek dağ olmaz** | Piramit gibi görünür; `hills.js` "sırtlı gürültü" kullanıyor. |
| **Diken/çıkıntı gövde eğrisine otursun** | Sabit y'ye dizilince gövdeden kopup çam ağacına benziyorlar. |
| **Perspektif hem konumda hem BOYUTTA olmalı** | Sadece konum ölçeklenirse tarla "çıkartma" gibi görünür. |
| **`Math.random()` yasak** | Her karede farklı sonuç → titreme + iki tarayıcıda farklı manzara. |
| **Detaylı karakter yerine ışık almış siluet** | Canvas'ta prosedürel yüz/kostüm neredeyse her zaman kötü çıkar. |
| **CSS'te `-min(...)` geçersiz** | Satır sessizce atılıyor; `calc()` kullan ya da flex ile ortala. |

---

## Bölüm tasarım kuralları

`src/game/levels.js` başındaki kurallar **ölçülmüş zıplama menziline** dayanır
(tek zıplama 231px yatay / 115px dikey, çift zıplama 358 / 199) ve ihlal
edilirse bölüm geçilemez hale gelebilir:

1. Uçurumlar 140px (≈%40 güvenlik payı)
2. Dikey adımlar ≤ 90px
3. Dikenler devriye alanlarıyla çakışmaz
4. **Uçurumların üstüne alçak platform konmaz** — zıplayan oyuncu altına çarpıp
   düşer
5. Platformlar birbiriyle çakışmaz
6. **Yürüme koridoru (y 476–520) boş kalır** — dikey asansörler y ∈ [350, 440]

Co-op eklendiğinde bir kural daha çıktı:
**7. Co-op mekanizmaları düşman devriye alanlarıyla çakışmaz** — plaka üstünde
beklemek zorunda olan oyuncu sürekli dövülmemeli. (B1'deki walker'ın devriyesi
bu yüzden 1300→1430'a çekildi.)

---

## Bilinen eksikler

- Sinematiklerin `windSwell`, `duskAmbience` ve `sunsetTheme` işaretleri
  WebAudio ile sentezleniyor; ses açık değilse tarayıcı politikası gereği sessiz kalır.
- Boss savaşı için ayrı bir co-op rol mekaniği yok; ejderha en yakın oyuncuyu
  hedeflediği için doğal olarak "biri dikkat çeker, diğeri vurur" oluyor ama
  bu bilinçli bir tasarım değil, yan etki.
- Bölüm 2 ve 3'te ortak asansör yok — dikey sütun bulunamadı. Zorla sıkıştırmak
  yerine bölümlerin kendi ritmine güvenildi.
- Misafirin yeniden bağlanması test edildi (sunucu testi), ama **oyun ortasında**
  yeniden bağlanma tarayıcıda uçtan uca denenmedi.
- `dist/` klasöründe eski bir derleme olabilir; `npm run build` ile tazele.
- Kullanılmayan eski dosyalar `.attic/` altında (Vite şablonu artıkları ve
  `game/render.js` — `render/renderer.js` ile çakışan eski çizim hattı).
- Açılış ve final sahneleri `public/cine/` altındaki pixel-art katmanları kullanır;
  görsel yüklenemezse prosedürel çizim otomatik yedek olarak devreye girer.
