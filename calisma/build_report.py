#!/usr/bin/env python3
"""
HAYGEM — İthal Boğa Sperması Genetik Kusur Tarama ve NAAB AISS Eşleştirme Betiği

Özellikler:
- Harici bağımlılık olmadan .xlsx okuma (openpyxl varsa biçimli .xlsx çıktısı da üretir;
  yoksa Excel uyumlu UTF-8 BOM'lu .csv çıktısı üretir).
- NAAB AISS Ağustos 2026 veri setini (Complete AISS) doğrudan okur ve sıkı normalize
  kimlik (ISO 840/USA 12 haneli kayıt no + sıfır dolgulu NAAB kodu) ve ırk uyumu ile eşleştirir.
- NAAB / Holstein USA / CDCB genetik kusur ve resesif kodlarını otomatik sınıflandırır
  (taşıyıcı kodları, kısmi testli arı kodları, özellik/dominant kodlar).
- Küpe/kayıt numarası ile NAAB kodunu doğru ayrıştırır ve olası yazım hatalarını (örn. H0 -> HO)
  otomatik olarak uyarı notuna ekler.
- HAYGEM 03.09.2026 eşleştirme ilkelerini korur: kısmi testli arı kodları tek başına
  "Arı" statüsü vermez; ad benzerliği veya aday öneri sütunları kesin kanıt sayılmaz.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from pathlib import Path

try:
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
except ImportError:
    openpyxl = None


# ---------------------------------------------------------------------------
# Resmi NAAB / Holstein USA / CDCB Genetik Kod Sözlüğü
# ---------------------------------------------------------------------------
CARRIER_CODES: dict[str, str] = {
    "CD": "HCD1 — Kolesterol Eksikliği (Cholesterol Deficiency) Taşıyıcı",
    "HCD1": "HCD1 — Kolesterol Eksikliği Taşıyıcı",
    "MW": "HMW — Erken Başlangıçlı Kas Zayıflığı (Muscle Weakness) Taşıyıcı",
    "MW1": "HMW — Erken Başlangıçlı Kas Zayıflığı Heterozigot Taşıyıcı",
    "MW2": "HMW — Erken Başlangıçlı Kas Zayıflığı Homozigot",
    "CV": "CVM — Kompleks Vertebral Malformasyon Taşıyıcı",
    "BY": "Brachyspina Taşıyıcı",
    "BL": "BLAD — Sığır Lökosit Adezyon Eksikliği Taşıyıcı",
    "DP": "DUMPS — Üridin Monofosfat Sentaz Eksikliği Taşıyıcı",
    "MF": "Mulefoot (Sindaktili) Taşıyıcı",
    "JNSC": "JNS — Jersey Nöropati (Splayed Forelimbs) Taşıyıcı",
    "HH1C": "HH1 Haplotip Taşıyıcı",
    "HH2C": "HH2 Haplotip Taşıyıcı",
    "HH3C": "HH3 Haplotip Taşıyıcı",
    "HH4C": "HH4 Haplotip Taşıyıcı",
    "HH5C": "HH5 Haplotip Taşıyıcı",
    "HH6C": "HH6 Haplotip Taşıyıcı",
    "HH7C": "HH7 Haplotip Taşıyıcı",
    "JH1C": "JH1 Jersey Haplotip Taşıyıcı",
    "BH2C": "BH2 Brown Swiss Haplotip Taşıyıcı",
}

TESTED_FREE_CODES: dict[str, str] = {
    "TL": "BLAD Testli Arı",
    "TD": "DUMPS Testli Arı",
    "TV": "CVM Testli Arı",
    "TY": "Brachyspina Testli Arı",
    "TC": "Kolesterol Eksikliği (CD) Testli Arı",
    "TR": "Kırmızı Faktör (Red) Testli Arı",
    "TE": "Kas Zayıflığı (MW/HMW) Testli Arı",
    "TP": "Boynuzsuzluk (Polled) Testli Arı (Boynuzlu)",
    "TM": "Mulefoot Testli Arı",
    "JNSF": "Jersey Nöropati (JNS) Testli Arı",
    "JH1F": "JH1 Haplotip Testli Arı",
}

TRAIT_CODES: dict[str, str] = {
    "PC": "Heterozigot Boynuzsuz (Polled Carrier)",
    "PP": "Homozigot Boynuzsuz (Homozygous Polled)",
    "PO": "Boynuzsuz (Polled)",
    "RC": "Kırmızı Faktör Taşıyıcı (Red Carrier)",
    "DR1": "Dominant Kırmızı (Heterozigot)",
    "B/R": "Siyah/Kırmızı",
}

BREED_NORMALIZE: dict[str, str] = {
    "HOLSTEIN": "Holstein",
    "HOLSTEİN": "Holstein",
    "HO": "Holstein",
    "KIRMIZI HOLSTEIN": "Kırmızı Holstein",
    "KIRMIZI HOLSTEİN": "Kırmızı Holstein",
    "RED HOLSTEIN": "Kırmızı Holstein",
    "RED HOLSTEİN": "Kırmızı Holstein",
    "JERSEY": "Jersey",
    "JE": "Jersey",
    "BROWN SWISS": "Brown Swiss",
    "ESMER": "Brown Swiss",
    "BS": "Brown Swiss",
    "SIMENTAL": "Simental",
    "SİMENTAL": "Simental",
    "FLECKVIEH": "Simental",
    "ANGUS": "Angus",
    "BELÇİKA MAVİSİ": "Belçika Mavisi",
    "BELCIKA MAVISI": "Belçika Mavisi",
    "LİMUZİN": "Limuzin",
    "LIMUZIN": "Limuzin",
    "IRK BELİRTİLMEMİŞ": "Irk Belirtilmemiş",
    "IRK BELIRTILMEMIS": "Irk Belirtilmemiş",
}

BREED_TO_AISS: dict[str, set[str]] = {
    "Holstein": {"HO", "RW"},
    "Kırmızı Holstein": {"HO", "RW"},
    "Jersey": {"JE"},
    "Brown Swiss": {"BS"},
    "Ayrshire": {"AY"},
    "Guernsey": {"GU"},
}

COUNTRY_TO_ISO3: dict[str, str] = {
    "US": "840",
    "USA": "840",
    "840": "840",
    "CA": "124",
    "CAN": "124",
    "124": "124",
    "DE": "DEU",
    "DEU": "DEU",
    "NL": "NLD",
    "NLD": "NLD",
    "IT": "ITA",
    "ITA": "ITA",
    "DK": "DNK",
    "DNK": "DNK",
    "FR": "FRA",
    "FRA": "FRA",
    "GB": "GBR",
    "GBR": "GBR",
    "CZ": "CZE",
    "CZE": "CZE",
}

# Doğrulanmış harici açık katalog notları (manuel inceleme kayıtları)
KNOWN_EXTERNAL: dict[str, tuple[str, str, str]] = {
    "507HO15337": (
        "TR TP TC TL TD TV TY TE; HH1T–HH6T",
        "NAAB sayfasındaki kodlar kısmi testli arı kodları gösterir; HH7 ve HAYGEM kapsamındaki diğer kusurların tamamı doğrulanmadığından toplam sonuç doğrulanamadı.",
        "https://www.naab-css.org/genomic-bull-database/HO840003148929351",
    ),
    "507HO15695": (
        "TP TC TL TR TD TY TV TM TE; HH1T–HH6T",
        "NAAB kaydında kısmi genetik kodlar ve HH1–HH6 testli arı kodları; toplam HAYGEM panel kapsamı doğrulanmadı.",
        "https://www.naab-css.org/genomic-bull-database/HO840003215097986",
    ),
    "614HO15831": (
        "TP TR TC TL TD TY TV TE; HH1T–HH6T",
        "NAAB kaydında kısmi genetik kodlar ve HH1–HH6 testli arı kodları; toplam HAYGEM panel kapsamı doğrulanmadı.",
        "https://www.naab-css.org/genomic-bull-database/HO840003209481389",
    ),
    "614HO14226": (
        "EOMW 0%, CD 1%, Brachyspina 0%, CVM 0%, BLAD 0%, DUMPS 0%, Mulefoot 1%; HH1–HH6 %1 olasılık",
        "Lactanet olasılık kayıtları mutlak DNA test sonucu değildir; %1 taşıyıcı olasılığı taşıyıcı kanıtı sayılmadı. Tam panel doğrulanamadı.",
        "https://www.lactanet.ca/en/genetics/",
    ),
    "551HO4671": (
        "TC TD TE TL TR TV TY; HH1T–HH6T",
        "NAAB kod formatı ve hayvan kimliği çapraz referansıyla tam kimlik; kısmi kodlar HAYGEM panelinin tamamını kapsamıyor.",
        "https://www.naab-css.org/genomic-bull-database/HO840003213126406",
    ),
    "HO840003213126406": (
        "TC TD TE TL TR TV TY; HH1T–HH6T",
        "Aynı Holstein hayvanına ait NAAB kaydı (551HO4671 ile aynı hayvan); kısmi kodlar HAYGEM panelinin tamamını kapsamıyor.",
        "https://www.naab-css.org/genomic-bull-database/HO840003213126406",
    ),
    "507HO15033": (
        "TD TC TL TR TP TV TY TE; HH1T–HH6T",
        "NAAB kaydındaki kısmi kodlar ve HH1–HH6 testli arı; HAYGEM tam panel kapsamı doğrulanmadı.",
        "https://www.naab-css.org/genomic-bull-database/HO840003206205232",
    ),
    "629HO18967": (
        "TR TV TL TD TC TY MW; HH1T–HH6T",
        "DİKKAT: NAAB kaydında MW (Early Onset Muscle Weakness / HMW taşıyıcı) kodu görünmektedir; ancak stok listesinde ırk 'Irk Belirtilmemiş' olduğundan kesin ırk+kimlik onayı için manuel doğrulama gereklidir.",
        "https://www.naab-css.org/genomic-bull-database/HO840003143627842",
    ),
    "IT003990162540": (
        "TY TV; HH1F HH2F HH3F HH4F HH5F HH6F HH7F",
        "ANAFIBJ kayıt lejandında F non portatore (taşıyıcı değil); yalnız listelenen kodlar için kısmi arı kanıtı. Tam panel yok.",
        "https://www.anafibj.it/",
    ),
    "551JE1885": (
        "JH1F",
        "Jersey kayıt/NAAB numarası ile boğa kimliği eşleşiyor; yalnız JH1 bilgisi mevcut. Genetik kusur paneli tam değil.",
        "https://www.usjersey.com/",
    ),
    "JE840M3254283371": (
        "JH1F JNSF",
        "Jersey boğa kataloğunda tam kayıt numarası; yalnız bildirilen kodlar mevcut, tam panel kanıtı değil.",
        "https://semex.com.br/touro/0200JE01485/285/JX%20COOL%7B6%7D",
    ),
    "DE001406512971": (
        "TL TV TY TM CF",
        "Katalog kaydında bu kodlar görünür; CF anlamı ve tam panel kapsamı doğrulanmadı.",
        "https://it.scribd.com/document/1070033157/Inseme-Cat-UNICO-Dic-2024",
    ),
    "NL000566130421": (
        "TL",
        "Katalog kaydında sınırlı kod bilgisi; tam kusur paneli doğrulanmadı.",
        "https://www.naab-css.org/database-files",
    ),
    "IT019991363560": (
        "",
        "Kimlik/ırk kaydı bulunuyor; ancak ilgili kaynak genetik kusur panel durumlarını raporlamıyor.",
        "https://www.izoo.krakow.pl/en/",
    ),
    "DE001604459503": (
        "CF TL",
        "Kimliğe yakın varyant ve Holstein kaydı var; ancak kodların kapsam/yorum teyidi tamamlanmadı.",
        "https://it.scribd.com/document/1070033157/Inseme-Cat-UNICO-Dic-2024",
    ),
}

NAAB_RE = re.compile(r"^0*(\d{1,3})(HO|JE|BS|AY|GU|MS|NR|RW|SM|AN|LM|BB)0*(\d{3,6})$")
OCR_NAAB_RE = re.compile(r"^(\d{1,3})H0(\d{3,7})$")
REG_RE = re.compile(r"^(HO|JE|BS|AY|GU)?(840|USA|US|CAN|CA|DEU|DE|NLD|NL|ITA|IT|DNK|DK|FRA|FR|GBR|GB|CZE|CZ)(M|F)?0*(\d+)$")


def normalize_breed(raw: str) -> str:
    clean = re.sub(r"\s+", " ", str(raw or "").strip())
    if not clean:
        return "Irk Belirtilmemiş"
    upper = clean.replace("i", "İ").upper() if "i" in clean else clean.upper()
    return BREED_NORMALIZE.get(clean.upper(), BREED_NORMALIZE.get(upper, clean.title()))


def classify_identifier(raw_id: str) -> tuple[str, str, str]:
    """
    Stok kimliğini (ear, naab, warning) olarak ayrıştırır.
    - 17 karakterli Interbull / ülke kayıt numaraları (HO840..., JE840..., USA..., DE..., IT...) -> ear
    - Standart NAAB kodları (507HO15337, 07HO14454, 551JE1885...) -> naab
    - Olası OCR/yazım hataları (614H015154 -> 'H0' yerine 'HO' şüphesi) -> ear + uyarı
    """
    cleaned = re.sub(r"[\s()（）]", "", str(raw_id or "")).upper()
    if not cleaned:
        return "", "", ""
    if NAAB_RE.match(cleaned):
        return "", cleaned, ""
    if OCR_NAAB_RE.match(cleaned):
        return (
            cleaned,
            "",
            f"Kimlik formatı uyarısı: '{cleaned}' içinde 'HO' yerine sıfır ('H0') yazılmış olabilir; ham kimlik değiştirilmeden korundu.",
        )
    return cleaned, "", ""


def read_xlsx_sheet_stdlib(path: Path, sheet_name: str) -> list[list[str]]:
    """openpyxl yüklü olmasa bile .xlsx dosyasından belirli bir sayfayı okur."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as zf:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            sst = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in sst.findall("m:si", ns):
                shared_strings.append("".join(si.itertext()))
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rid_map = {r.attrib["Id"]: r.attrib["Target"].lstrip("/") for r in rels}
        target = None
        for sheet in wb.findall(".//m:sheet", ns):
            if sheet.attrib.get("name") == sheet_name:
                rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
                rel_target = rid_map[rid]
                target = rel_target if rel_target.startswith("xl/") else f"xl/{rel_target}"
                break
        if not target:
            raise ValueError(f"Sayfa bulunamadı: {sheet_name}")
        ws = ET.fromstring(zf.read(target))
        rows: list[list[str]] = []
        for row in ws.findall(".//m:sheetData/m:row", ns):
            vals: dict[int, str] = {}
            max_col = 0
            for cell in row.findall("m:c", ns):
                ref = cell.attrib.get("r", "")
                col_letters = "".join(ch for ch in ref if ch.isalpha())
                col_idx = 0
                for ch in col_letters:
                    col_idx = col_idx * 26 + (ord(ch) - 64)
                max_col = max(max_col, col_idx)
                ctype = cell.attrib.get("t")
                v = cell.find("m:v", ns)
                if ctype == "s" and v is not None:
                    val = shared_strings[int(v.text)]
                elif ctype == "inlineStr":
                    val = "".join(cell.itertext())
                elif v is not None and v.text is not None:
                    val = v.text
                else:
                    val = ""
                vals[col_idx] = val
            rows.append([vals.get(i, "") for i in range(1, max_col + 1)])
        return rows


def load_aiss_index(aiss_path: Path) -> tuple[dict[str, dict], dict[tuple[str, str], dict], int]:
    """NAAB AISS August 2026 Complete dosyasını NAAB ve ISO kayıt numarasına göre indeksler."""
    by_naab: dict[str, dict] = {}
    by_reg: dict[tuple[str, str], dict] = {}
    total = 0
    if not aiss_path.exists():
        return by_naab, by_reg, 0
    with aiss_path.open("r", encoding="utf-8", errors="replace") as fh:
        for row in csv.reader(fh):
            if len(row) < 95:
                continue
            total += 1
            breed_code = row[0].strip().upper()
            country = row[1].strip().upper()
            reg_num = row[2].strip().zfill(12)
            stud = int(row[4].strip()) if row[4].strip().isdigit() else 0
            pbreed = row[5].strip().upper()
            pbull = int(row[6].strip()) if row[6].strip().isdigit() else 0
            full_naab = re.sub(r"\s+", "", row[7].strip().upper())
            rec = {
                "breed_code": breed_code,
                "country": country,
                "reg_num": reg_num,
                "full_id": f"{breed_code}{country}{reg_num}",
                "naab": full_naab,
                "name": row[8].strip(),
                "recessives": row[93].strip(),
            }
            if stud and pbreed and pbull:
                by_naab[f"{stud}{pbreed}{pbull}"] = rec
            if full_naab:
                by_naab[full_naab] = rec
            by_reg[(country, reg_num)] = rec
    return by_naab, by_reg, total


def match_aiss(raw_id: str, breed_std: str, by_naab: dict[str, dict], by_reg: dict[tuple[str, str], dict]) -> dict | None:
    """
    Sıkı normalize kimlik + ırk uyumu ile AISS kaydı arar.
    Yalnızca aynı kimlik numarası (sıfır dolgusu veya USA/840 ISO eşdeğeri) VE uyumlu ırk kabul edilir.
    """
    allowed_breeds = BREED_TO_AISS.get(breed_std)
    if not allowed_breeds:
        return None
    cleaned = re.sub(r"[\s()（）]", "", str(raw_id or "")).upper()
    if not cleaned:
        return None

    candidate = None
    m_naab = NAAB_RE.match(cleaned)
    if m_naab:
        norm_naab = f"{int(m_naab.group(1))}{m_naab.group(2)}{int(m_naab.group(3))}"
        candidate = by_naab.get(norm_naab) or by_naab.get(cleaned)

    if not candidate:
        m_reg = REG_RE.match(cleaned)
        if m_reg:
            cc = COUNTRY_TO_ISO3.get(m_reg.group(2), m_reg.group(2))
            num12 = m_reg.group(4).zfill(12)
            candidate = by_reg.get((cc, num12))

    if candidate and candidate["breed_code"] in allowed_breeds:
        return candidate
    return None


def analyze_codes(code_str: str) -> tuple[list[str], list[str]]:
    """
    Kod dizisinden taşıyıcı kodlarını ve testli arı kodlarını ayırır.
    Olasılık ifadeleri (örn. 'CD 1%', 'EOMW 0%') kesin DNA/taşıyıcı kodu sayılmaz.
    """
    cleaned = re.sub(r"\b[A-Za-z0-9–-]+\s+\d+(?:[.,]\d+)?%", " ", code_str or "")
    cleaned = re.sub(r"\b[A-Za-z0-9–-]+\s+%\d+(?:[.,]\d+)?", " ", cleaned)
    tokens = [t.strip().upper() for t in re.split(r"[\s,;|]+", cleaned) if t.strip()]
    carriers = [t for t in tokens if t in CARRIER_CODES]
    tested_free = [t for t in tokens if t in TESTED_FREE_CODES or re.match(r"^HH[1-7][TF]$", t)]
    return sorted(set(carriers)), sorted(set(tested_free))


def build_report(input_xlsx: Path, aiss_file: Path, out_xlsx: Path, out_csv: Path, out_json: Path) -> None:
    rows = read_xlsx_sheet_stdlib(input_xlsx, "İLERİ EŞLEŞTİRME")[1:]
    by_naab, by_reg, aiss_count = load_aiss_index(aiss_file)

    seed_items: list[dict] = []
    report_rows: list[list] = []
    stats = {"total": 0, "aiss_matched": 0, "carrier": 0, "attention": 0, "ocr_warnings": 0}

    for idx, row in enumerate(rows, start=1):
        padded = row + [""] * max(0, 9 - len(row))
        typ, breed_raw, name_raw, bullid_raw, qty, importer, matchedid, matchedname, otherno = padded[:9]
        bullid = str(bullid_raw or "").strip()
        raw_clean = re.sub(r"[\s()（）]", "", bullid).upper()
        breed_std = normalize_breed(breed_raw)
        name_clean = str(name_raw or "").strip()
        ear, naab, id_warn = classify_identifier(bullid)
        if id_warn:
            stats["ocr_warnings"] += 1

        aiss_hit = match_aiss(raw_clean, breed_std, by_naab, by_reg)
        ext_info = KNOWN_EXTERNAL.get(raw_clean)

        codes_parts: list[str] = []
        note_parts: list[str] = []
        evidence_url = ""
        source_label = "İleri eşleştirme taraması · uluslararası açık kayıtlar"

        if aiss_hit:
            stats["aiss_matched"] += 1
            aiss_rec = aiss_hit["recessives"]
            if aiss_rec:
                codes_parts.append(aiss_rec)
            note_parts.append(
                f"NAAB AISS Ağustos 2026 tam kimlik + ırk eşleşmesi bulundu "
                f"({aiss_hit['full_id']} / NAAB: {aiss_hit['naab']} / {aiss_hit['name']}). "
                f"AISS resesif kodları: {aiss_rec or 'belirtilmemiş'}. "
                f"Kısmi kodlar HAYGEM tam panelini kapsamaz."
            )
            evidence_url = f"https://www.naab-css.org/genomic-bull-database/{aiss_hit['full_id']}"
            source_label = "NAAB AISS (Ağustos 2026) · uluslararası açık kayıtlar"
            if not naab and aiss_hit["naab"]:
                # Orijinal stok kimliğini koru; AISS NAAB bilgisini notta tut
                pass

        if ext_info:
            ext_codes, ext_note, ext_url = ext_info
            if ext_codes and ext_codes not in " ".join(codes_parts):
                codes_parts.append(ext_codes)
            note_parts.append(ext_note)
            if not evidence_url:
                evidence_url = ext_url

        if not aiss_hit and not ext_info:
            note_parts.append(
                "NAAB AISS Ağustos 2026 Complete kayıtlarında normalize küpe/NAAB no + ırk ile tam eşleşme bulunmadı; "
                "açık kaynak taramasında HAYGEM tam panelini doğrulayan kayıt saptanmadı. Bu sonuç arı olduğu anlamına gelmez."
            )

        if id_warn:
            note_parts.append(id_warn)

        codes_combined = " | ".join(c for c in codes_parts if c)
        carriers, tested_free = analyze_codes(codes_combined)

        status = "Kamuya açık kayıtta doğrulanamadı"
        defect = ""
        attention = ""
        if carriers:
            if breed_std == "Irk Belirtilmemiş":
                attention = f"İnceleme gerekli: kayıtta {', '.join(carriers)} taşıyıcı kodu var ancak stok ırkı belirtilmemiş."
                stats["attention"] += 1
            else:
                status = "Taşıyıcı"
                defect = ", ".join(carriers)
                stats["carrier"] += 1
        elif id_warn:
            attention = id_warn

        qurl = "https://www.google.com/search?q=" + urllib.parse.quote(
            f'"{raw_clean}" {breed_std} cattle genetic defect carrier'
        )
        exact_source = evidence_url or "https://www.naab-css.org/database-files"

        candidate_note = (
            f"Aday eşleştirme alanları ({matchedid or '—'} / {matchedname or '—'} / {otherno or '—'}) "
            f"otomatik öneridir; kayıt kimliğine eklenmemiş ve kanıt sayılmamıştır."
        )
        full_note = " ".join(note_parts + [candidate_note])

        stats["total"] += 1
        seed_items.append(
            {
                "uid": f"adv-{idx:03d}-{raw_clean.lower()}",
                "name": name_clean,
                "ear": ear,
                "naab": naab,
                "breed": breed_std,
                "status": status,
                "defect": defect,
                "codes": codes_combined,
                "attention": attention,
                "source": source_label,
                "evidence": exact_source if (codes_combined or aiss_hit) else qurl,
                "note": full_note,
            }
        )
        report_rows.append(
            [
                typ,
                breed_std,
                name_clean,
                bullid,
                ear,
                naab,
                qty,
                importer,
                "Evet" if aiss_hit else "Hayır",
                codes_combined,
                ", ".join(carriers),
                status,
                attention or "Tam panel kapsamı doğrulanmadı",
                full_note,
                exact_source,
                qurl,
            ]
        )

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(seed_items, ensure_ascii=False, indent=2), encoding="utf-8")

    headers = [
        "Sperma tipi",
        "Irk (standart)",
        "Stok boğa adı",
        "Ham stok kimliği",
        "Ayrıştırılan küpe/kayıt no",
        "Ayrıştırılan NAAB no",
        "Mevcut stok",
        "İthalatçı",
        "AISS tam eşleşme",
        "Uluslararası kayıtta görülen genetik kodlar",
        "Tespit edilen taşıyıcı kodları",
        "Sonuç",
        "Panel kapsamı / uyarı",
        "Kimlik ve değerlendirme notu",
        "Kaynak kaydı",
        "Kimlik + ırk arama bağlantısı",
    ]

    # Her ortamda Excel uyumlu UTF-8 BOM CSV çıktısı oluştur
    with out_csv.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh, delimiter=";")
        writer.writerow(headers)
        writer.writerows(report_rows)

    # openpyxl mevcutsa biçimli Excel çalışma kitabı da üret
    if openpyxl is not None:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "İleri Eşleştirme Taraması"
        ws.append(headers)
        for r in report_rows:
            ws.append(r)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="164B45")
            cell.alignment = Alignment(wrap_text=True, vertical="center")
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        ws.row_dimensions[1].height = 38
        widths = [14, 18, 30, 22, 22, 18, 12, 38, 16, 40, 22, 30, 36, 65, 50, 50]
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = Alignment(vertical="top", wrap_text=True)
            for ci in (15, 16):
                row[ci - 1].hyperlink = row[ci - 1].value
                row[ci - 1].style = "Hyperlink"

        m = wb.create_sheet("Yöntem ve Özet")
        summary = [
            ["İthal sperma ileri eşleştirme boğaları — genetik kusur taraması", ""],
            ["Tarama zamanı", datetime.now().strftime("%d.%m.%Y %H:%M")],
            ["Kaynak dosyası", f"{input_xlsx.name} · İLERİ EŞLEŞTİRME"],
            ["AISS veri seti", f"{aiss_file.name} ({aiss_count} kayıt)"],
            ["Toplam stok satırı", stats["total"]],
            ["AISS tam ID + ırk eşleşmesi", stats["aiss_matched"]],
            ["Taşıyıcı", stats["carrier"]],
            ["Öncelikli inceleme gerektiren (ırk/kod uyarısı)", stats["attention"]],
            ["Kimlik formatı (OCR/yazım) uyarısı", stats["ocr_warnings"]],
            ["Arı", 0],
            ["Kamuya açık kayıtta doğrulanamadı", stats["total"] - stats["carrier"]],
            [
                "Kimlik kuralı",
                "Stok küpe/NAAB numarası + ırk birlikte esas alındı. Ad benzerliği veya önerilen aday sütunları üzerinden kesin sonuç atanmadı.",
            ],
            [
                "Sınıflandırma",
                "Taşıyıcı: eşleşen yetkin kayıtta taşıyıcılık kodu açıkça kanıtlıysa. Arı: ırka ait HAYGEM panelinin tümü için açık testli negatif kanıt varsa. Diğerleri kamuya açık kayıtta doğrulanamadı.",
            ],
        ]
        for r in summary:
            m.append(r)
        m.column_dimensions["A"].width = 40
        m.column_dimensions["B"].width = 110
        m.freeze_panes = "A2"
        for cell in m[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="164B45")
        for row in m.iter_rows():
            for c in row:
                c.alignment = Alignment(vertical="top", wrap_text=True)
        wb.save(out_xlsx)

    print(
        f"Tamamlandı | satır: {stats['total']} | AISS eşleşme: {stats['aiss_matched']} | "
        f"taşıyıcı: {stats['carrier']} | öncelikli uyarı: {stats['attention']} | "
        f"OCR uyarısı: {stats['ocr_warnings']} | JSON: {out_json} | CSV: {out_csv}"
        + (f" | XLSX: {out_xlsx}" if openpyxl is not None else " | (openpyxl kurulu değil, CSV üretildi)")
    )


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="HAYGEM İthal Sperma Genetik Kusur Tarama ve AISS Eşleştirme")
    parser.add_argument(
        "--input",
        type=Path,
        default=base_dir / "imports" / "Ithal_Sperma_Ileri_Eslestirme_Kontrol.xlsx",
        help="Giriş Excel dosyası",
    )
    parser.add_argument(
        "--aiss",
        type=Path,
        default=base_dir / "imports" / "aiss_complete" / "Aug122026-CompleteAISS.txt",
        help="NAAB AISS Complete veri dosyası",
    )
    parser.add_argument(
        "--out-xlsx",
        type=Path,
        default=base_dir / "Ithal_Sperma_Ileri_Eslestirme_Genetik_Kusur_Taramasi.xlsx",
        help="Çıktı Excel yolu (openpyxl kuruluysa)",
    )
    parser.add_argument(
        "--out-csv",
        type=Path,
        default=base_dir / "Ithal_Sperma_Ileri_Eslestirme_Genetik_Kusur_Taramasi.csv",
        help="Çıktı CSV yolu (UTF-8 BOM)",
    )
    parser.add_argument(
        "--out-json",
        type=Path,
        default=base_dir / "import-batch.json",
        help="Çıktı JSON içe aktarım paketi",
    )
    args = parser.parse_args()
    build_report(args.input, args.aiss, args.out_xlsx, args.out_csv, args.out_json)


if __name__ == "__main__":
    main()
