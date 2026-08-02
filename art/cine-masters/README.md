# Sinematik ana sayfaları — ARŞİV

Buradaki dosyalar **oyun tarafından yüklenmiyor**. `public/` altında
olmadıkları için dağıtıma (`dist/`) da girmiyorlar. Bilerek böyle.

## Ne bunlar?

**5 atlas** (`heroes-atlas`, `heroes-motion-atlas`, `heroes-gesture-atlas`,
`dragon-atlas`, `dragon-motion-atlas`)

`tools/process-cine-assets.py` üretimden gelen ham sayfaların dama tahtası
zeminini temizliyor ve *temizlenmiş tam sayfayı* buraya kaydediyor. Sonra
aynı sayfayı kesip tek tek kareleri `public/cine/sprites/`e yazıyor — oyunun
yüklediği onlar.

Saklanma sebebi: ham üretim dosyaları (`cine-*.png`) kaybolursa kareleri
yeniden kesebileceğin tek kaynak bunlar. Temizlik zaten yapılmış hâlde.

**9 yedek kare** (`hero-seated`, `companion-seated`, `*-sit-transition`,
`*-walk-down`, `dragon-bank`, `companion-offer-settle`,
`companion-reach-anticipate`)

Boru hattının ürettiği ama hiçbir animasyona bağlanmamış pozlar.
`pixelSprites.js` içindeki `SOURCES` bunları saymıyor. Bir animasyonda
kullanmak istersen oraya ekleyip `public/cine/sprites/` altına kayıpsız
WebP olarak koyman yeterli.

## Neden public/ altında değiller?

Vite `public/`i olduğu gibi kopyalıyor. Burası `public/` olsaydı 8 MB
her dağıtıma binerdi — hiçbir tarayıcı bu dosyaları istemediği hâlde.
Oyuncunun yükleme süresine etkisi yoktu, dağıtım boyutuna vardı.

## Biçim notu

Bunlar PNG olarak kalıyor (arşiv/düzenleme kolaylığı). Oyunun yüklediği
kareler kayıpsız WebP — piksel piksel aynı, ~%43 küçük.
