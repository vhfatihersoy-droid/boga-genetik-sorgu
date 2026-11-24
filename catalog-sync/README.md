# NAAB AISS eşitlemesi

- Kaynak: NAAB Database Files sayfasındaki, herkese açık tarihli Complete AISS arşivi. CDCB, Holstein USA ve Lactanet linkleri elle doğrulama içindir; otomatik bağlayıcı değildir.
- Uygulama yalnızca repodaki takip kimliklerini, tam NAAB/kayıt numarası ve uyumlu ırk üzerinden eşleştirir. Ad benzerliği kullanılmaz, geçerli adaylar çelişirse sonuç aktarılmaz. Yeni veya belirsiz formatta kayıt yazılmaz.
- Worker geçerli sürümü Sites R2'de saklar. HAYGEM statüsü, başlangıç dosyası ve tarayıcı değişiklikleri değişmez. Kaynak sürümü ve kontrol zamanı ayrı görünür.
- Yalnızca özel Site: Sites servis erişimiyle HEAD veya GET ana sayfa ve GET /api/aiss; POST /api/aiss-sync zorlandığında resmî kaynağı kontrol eder (gövde gerekmez). Uygulama çerezleri veya kullanıcı kimlik bilgileri kaynakla paylaşılmaz. Önceki başarılı sürüm hata durumunda tutulur. Site herkese açık hale gelirse bu yazma uç noktası yeniden yetkilendirilmeden zamanlanmış iş çalıştırılmamalıdır.
- Yerel derleme: node sync/build.mjs. Çıktı dist/server/index.js. Kimlik bilgileri kaynakta veya zamanlama talimatında tutulmaz.

## Boğa Kataloğu
- Özel Site, NAAB Complete AISS arşivindeki doğrulanabilen tüm satırların gerekli kimlik, soy, test kodu ve gösterim alanlarını, HAYGEM duyurusundaki son izin listesiyle ayrı kayıtlarda tutar. Her kaynağın sürümü ve bağlantısı ayrıdır. İzin gerçekleşmiş ithalat değildir.
- HAYGEM izin satırları birleştirilip doz toplamı yapılmaz; birden çok yayımlanan satır ayrı ayrı gösterilir. Yalnızca kimlik ve ırk eşleşirse NAAB satırına izin bilgisi eklenir. Eşleşmeyen veya çelişkili kayıtlar aykırı bir onay üretmez.
- Haftalık mevcut Site çağrısı iki kaynağı da yeniler. Her kaynak kendi son geçerli sürümünü tutar ve diğeri başarısız olsa bile güncellenebilir. NAAB'da güncel dosyadan çıkan kayıtlar önceki sürüm etiketiyle aranabilir. HAYGEM'de görünmeyen satır için iptal veya ithal edilmedi çıkarımı yapılmaz.
- Resmî kaynak dosyaları ve hayvan kataloğu, GitHub Pages'e kopyalanmaz. Açık sürüm mevcut çalışma verisini gösterir; API yalnızca özel Site'tadır. Tarayıcıda yerel çalışma kayıtları otomatik eşitlemeyle üzerine yazılmaz.
- Özgün PDF önizlemesi yalnızca doğrulanmış doğrudan yayıncı dosyalarını, kullanıcı açtığında gösterir. Dosyalar uygulama içinde barındırılmaz. Kaynak sayfa bağlantısı veya özgün PDF bağlantısı her zaman kalır.
- CDCB, Holstein USA ve Lactanet bu yayına toplu olarak alınmamıştır; veri kullanım ve yeniden gösterim kapsamı doğrulanmadan kaynaklar eklenmez.
