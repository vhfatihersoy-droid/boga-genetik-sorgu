# Boğa Genetik Kusur Takibi (HAYGEM)

Bu paket, **Boğa Genetik Kusur Takibi** uygulamasının güncel kaynak kodunu, başlangıç veri setini (`seed.json`), D1/SQLite şemasını, yerel çalışma sunucusunu ve NAAB AISS tarama betiklerini içerir.

- Dışa aktarma zamanı: {{EXPORTED_AT}}
- Canlı boğa kaydı: {{BULL_COUNT}}
- Atanmış kullanıcı: {{USER_COUNT}}
- Site: https://boga-genetik-sorgu.engin-umut-ufuk.chatgpt.site
- Veri tabanı: Cloudflare D1 / SQLite `site_state` tablosu

## Öne Çıkan Özellikler
- **Sıkı Kimlik & Irk Doğrulama:** Yalnızca tam küpe/ülke kaydı veya NAAB numarası ve uyumlu ırk eşleşmesi kabul edilir.
- **Genetik Kod Çözümleme:** NAAB / CDCB / Holstein USA kodlarını (`CD/HCD1`, `MW/HMW`, `TL`, `TV`, `TY`, `TD`, `TC`, `TE`, `JNSF`, `JH1F`, `HH1–HH7`) otomatik renkli etiketlerle çözümler.
- **Tarayıcı İçi AISS Tarama:** `Aug122026-CompleteAISS.txt` gibi NAAB AISS dosyalarını sunucuya yüklemeden doğrudan tarayıcıda eşleştirir.
- **Excel / CSV İçe & Dışa Aktarım:** RFC 4180 uyumlu CSV ve SheetJS destekli `.xlsx` içe aktarım önizlemesi ile filtrelenmiş dışa aktarım.
- **İşlem Geçmişi ve Rol Bazlı Erişim:** `Yönetici`, `Araştırmacı` ve `Görüntüleyici` yetki katmanları; yönetici olmayan rollerde kullanıcı e-posta gizliliği.

## Yerel Olarak Çalıştırma (Node.js gerekmez)
```bash
python3 site/local_server.py
```
Tarayıcıda `http://127.0.0.1:8787` adresini açın. Farklı rollerle test etmek için:
```bash
python3 site/local_server.py --role Araştırmacı
python3 site/local_server.py --role Görüntüleyici
```

## Cloudflare Worker Derlemesi (Node.js)
```bash
node site/scripts/build-worker.mjs
```

## NAAB AISS Tarama ve Raporlama Betiği
```bash
python3 calisma/build_report.py
```

Yedek, indirme anındaki veri tabanı durumunu kapsar. ZIP içinde parola veya oturum belirteci bulunmaz.
