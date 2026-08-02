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

**8 yedek kare** (`hero-seated`, `companion-seated`, `*-sit-transition`,
`*-walk-down`, `companion-offer-settle`, `companion-reach-anticipate`)

Boru hattının ürettiği ama hiçbir animasyona bağlanmamış pozlar.
`pixelSprites.js` içindeki `SOURCES` bunları saymıyor. Bir animasyonda
kullanmak istersen oraya ekleyip `public/cine/sprites/` altına kayıpsız
WebP olarak koyman yeterli.

> **`dragon-bank` BURADA DEĞİL — `public/cine/sprites/` altında ve
> gereklidir.** Bir ara yanlışlıkla "kullanılmıyor" sayılmıştı: `SOURCES`
> içinde adı geçmiyor ama kanat çırpma döngüsünün ortasındaki kare o ve
> döngüde iki kez kullanılıyor. Eksik olduğunda ejderha geçerken kanatlar
> bir anlığına kayboluyor. Bir kareyi "kullanılmıyor" diye ayıklamadan
> önce sadece `SOURCES`'a değil, dosya adını doğrudan yazan yerlere de
> bakmak gerekiyor.

## Neden public/ altında değiller?

Vite `public/`i olduğu gibi kopyalıyor. Burası `public/` olsaydı 8 MB
her dağıtıma binerdi — hiçbir tarayıcı bu dosyaları istemediği hâlde.
Oyuncunun yükleme süresine etkisi yoktu, dağıtım boyutuna vardı.

## Biçim notu

Bunlar PNG olarak kalıyor (arşiv/düzenleme kolaylığı). Oyunun yüklediği
kareler kayıpsız WebP — piksel piksel aynı, ~%43 küçük.
