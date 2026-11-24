# Boğa Genetik Kusur Takibi (HAYGEM)

İthal boğa spermalarının uluslararası kayıtlar (NAAB AISS, CDCB, Holstein USA, Lactanet, ANAFIBJ, Rinderzucht Austria) üzerinden **tam kimlik + ırk eşleşmesi** ile genetik kusur taraması ve doğrulama paneli.

🌐 **Canlı Site (GitHub Pages):** https://vhfatihersoy-droid.github.io/boga-genetik-sorgu/

## Özellikler
- **Genetik Kod Çözümleme:** `CD/HCD1`, `MW/HMW`, `BL/TL`, `CV/TV`, `BY/TY`, `DP/TD`, `TC`, `TE`, `JNSF/JNSC`, `JH1F`, `HH1–HH7` kodlarını otomatik renkli etiketlerle çözümler.
- **Tarayıcı İçi NAAB AISS Tarama:** `Aug122026-CompleteAISS.txt` gibi NAAB AISS dosyalarını doğrudan tarayıcıda tarayıp tam kimlik + ırk eşleşmelerini listeler.
- **Excel / CSV İçe & Dışa Aktarım:** Önizlemeli RFC 4180 CSV / `.xlsx` içe aktarma ve filtrelenmiş dışa aktarma.
- **Çift Çalışma Modu:**
  - **GitHub Pages (Statik Mod):** `./seed.json` + tarayıcı `localStorage` kalıcılığı ve JSON yedek indirme.
  - **Sunucu Modu (Cloudflare Worker + D1 veya Yerel Python Sunucusu):** Merkezi veri tabanı, rol bazlı erişim ve tam ZIP yedekleme.

## Yerel Çalıştırma
```bash
python3 site/local_server.py
```
Tarayıcıda `http://127.0.0.1:8787` adresini açın.

## NAAB AISS Tarama Betiği
```bash
python3 calisma/build_report.py
```

## Boğa Kataloğu ve özgün pedigri belgeleri

Boğa Kataloğu ad, kayıt numarası ve NAAB ile arama sunar. Kaynak Belge sekmesi, yalnızca kimliği doğrulanan yayıncı sayfalarını ve desteklenen özgün PDF önizlemelerini gösterir. Resmî katalog dosyalarının kopyaları bu depoya veya GitHub Pages'e yüklenmez. Özel çalışma alanı için NAAB ve HAYGEM bağdaştırıcıları `catalog-sync/` altında bulunur.
