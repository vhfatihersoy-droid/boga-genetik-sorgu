#!/usr/bin/env python3
"""
HAYGEM + İleri Eşleştirme Birleşik Veri Seti ve NAAB AISS Pedigri Ağacı Oluşturucu

- HAYGEM_2026_Boga_Genetik_Kusur_Taramasi.xlsx (964 tekil boğa) ile
  import-batch.json (63 ileri eşleştirme boğası) kayıtlarını birleştirir.
- NAAB AISS Ağustos 2026 (6.811 boğa) dosyasından sıkı normalize kimlik + ırk uyumu ile:
  * Resmi ad, NAAB, doğum tarihi, Beta-Kazein, Kappa-Kazein, TPI, Net Merit (NM$)
  * Özyinelemeli (4 kuşağa kadar) Baba (Sire) ve Ana Babası (MGS) pedigri indeksi
  * Soy hattı taşıyıcılık ve ortak ata (akrabalı yetiştirme) tespiti için referans ağacı
- Compact ve hızlı yüklenen site/seed.json dosyasını üretir.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from build_report import (
    BREED_TO_AISS,
    CARRIER_CODES,
    COUNTRY_TO_ISO3,
    NAAB_RE,
    REG_RE,
    analyze_codes,
    classify_identifier,
    normalize_breed,
    read_xlsx_sheet_stdlib,
)


def fmt_dob(raw: str) -> str:
    s = re.sub(r"\D", "", str(raw or ""))
    if len(s) == 8:
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return ""


def norm_aiss_id(raw: str) -> str:
    """AISS Sire/MGS ID dizisini (örn. '840003219884299' veya 'USA000074345956') standartlaştırır."""
    s = re.sub(r"[\s-]", "", str(raw or "")).upper()
    if not s:
        return ""
    m = re.match(r"^(840|USA|US|124|CAN|CA|DEU|DE|NLD|NL|ITA|IT|DNK|DK|FRA|FR|GBR|GB|CZE|CZ)(\d+)$", s)
    if m:
        cc = COUNTRY_TO_ISO3.get(m.group(1), m.group(1))
        return f"{cc}{m.group(2).zfill(12)}"
    return s


def load_full_aiss(aiss_path: Path) -> tuple[dict[str, dict], dict[str, dict], int]:
    """Complete AISS dosyasını kimlik (ISO3+12 hane) ve NAAB koduna göre tam alanlarla indeksler."""
    by_id: dict[str, dict] = {}
    by_naab: dict[str, dict] = {}
    total = 0

    with aiss_path.open("r", encoding="utf-8", errors="replace") as fh:
        for row in csv.reader(fh):
            if len(row) < 127:
                continue
            total += 1
            breed_code = row[0].strip().upper()
            country = COUNTRY_TO_ISO3.get(row[1].strip().upper(), row[1].strip().upper())
            reg_num = row[2].strip().zfill(12)
            cid = f"{country}{reg_num}"
            full_id = f"{breed_code}{cid}"

            stud = int(row[4].strip()) if row[4].strip().isdigit() else 0
            pbreed = row[5].strip().upper()
            pbull = int(row[6].strip()) if row[6].strip().isdigit() else 0
            full_naab = re.sub(r"\s+", "", row[7].strip().upper())

            rec = {
                "cid": cid,
                "fullId": full_id,
                "breedCode": breed_code,
                "naab": full_naab,
                "name": row[8].strip(),
                "dob": fmt_dob(row[89]),
                "sireId": norm_aiss_id(row[91]),
                "mgsId": norm_aiss_id(row[92]),
                "codes": row[93].strip(),
                "tpi": row[62].strip(),
                "nm": row[44].strip(),
                "beta": row[125].strip(),
                "kappa": row[126].strip(),
            }
            by_id[cid] = rec
            if stud and pbreed and pbull:
                by_naab[f"{stud}{pbreed}{pbull}"] = rec
            if full_naab:
                by_naab[full_naab] = rec

    return by_id, by_naab, total


def match_bull_in_aiss(bull: dict, by_id: dict[str, dict], by_naab: dict[str, dict]) -> dict | None:
    allowed = BREED_TO_AISS.get(bull["breed"])
    if not allowed:
        return None

    candidates: list[str] = [bull.get("naab", ""), bull.get("ear", "")]
    m_url = re.search(r"genomic-bull-database/(?:HO|JE|BS|AY|GU)?([A-Z0-9]+)", bull.get("evidence", ""))
    if m_url:
        candidates.append(m_url.group(1))

    for raw in candidates:
        cleaned = re.sub(r"[\s()（）]", "", str(raw or "")).upper()
        if not cleaned:
            continue
        hit = None
        m1 = NAAB_RE.match(cleaned)
        if m1:
            hit = by_naab.get(f"{int(m1.group(1))}{m1.group(2)}{int(m1.group(3))}") or by_naab.get(cleaned)
        if not hit:
            m2 = REG_RE.match(cleaned)
            if m2:
                cc = COUNTRY_TO_ISO3.get(m2.group(2), m2.group(2))
                hit = by_id.get(f"{cc}{m2.group(4).zfill(12)}")
        if hit and hit["breedCode"] in allowed:
            return hit
    return None


def collect_ancestors(root_hit: dict, by_id: dict[str, dict], pedigree_index: dict[str, dict], max_depth: int = 4) -> None:
    """Boğanın tüm çözümlenebilen atalarını (4 kuşağa kadar) pedigree_index içine ekler."""
    queue: list[tuple[str, int]] = []
    if root_hit.get("sireId"):
        queue.append((root_hit["sireId"], 1))
    if root_hit.get("mgsId"):
        queue.append((root_hit["mgsId"], 1))

    visited: set[str] = set()
    while queue:
        cid, depth = queue.pop(0)
        if not cid or cid in visited or depth > max_depth:
            continue
        visited.add(cid)
        anc = by_id.get(cid)
        if not anc:
            continue
        if cid not in pedigree_index:
            pedigree_index[cid] = {
                "id": anc["cid"],
                "fullId": anc["fullId"],
                "naab": anc["naab"],
                "name": anc["name"],
                "breedCode": anc["breedCode"],
                "dob": anc["dob"],
                "codes": anc["codes"],
                "tpi": anc["tpi"],
                "nm": anc["nm"],
                "beta": anc["beta"],
                "kappa": anc["kappa"],
                "sireId": anc["sireId"],
                "mgsId": anc["mgsId"],
            }
        if depth < max_depth:
            if anc["sireId"]:
                queue.append((anc["sireId"], depth + 1))
            if anc["mgsId"]:
                queue.append((anc["mgsId"], depth + 1))


def apply_aiss_enrichment(bull: dict, hit: dict, by_id: dict[str, dict], pedigree_index: dict[str, dict]) -> None:
    """AISS kaydından pedigri, kazein, TPI/NM$ ve genetik kod bilgilerini boğaya işler."""
    collect_ancestors(hit, by_id, pedigree_index)

    # Boğa kimliğini zenginleştir (orijinal küpe/NAAB korunur, eksik olan tamamlanır)
    if not bull.get("naab") and hit["naab"]:
        bull["naab"] = hit["naab"]
    if not bull.get("ear") and hit["cid"]:
        bull["ear"] = hit["cid"]

    if hit["codes"]:
        existing = bull.get("codes", "")
        if hit["codes"] not in existing:
            bull["codes"] = f"{hit['codes']} | {existing}".strip(" |") if existing else hit["codes"]

    carriers, _ = analyze_codes(bull.get("codes", ""))
    if carriers and bull["breed"] != "Irk Belirtilmemiş":
        bull["status"] = "Taşıyıcı"
        pretty = []
        for c in carriers:
            lbl = "HCD1 (CD)" if c in ("CD", "HCD1") else ("HMW (MW)" if c in ("MW", "MW1", "MW2") else c)
            if lbl not in pretty:
                pretty.append(lbl)
        bull["defect"] = ", ".join(pretty)

    naab_url = f"https://www.naab-css.org/genomic-bull-database/{hit['fullId']}"
    if not bull.get("evidence") or "google.com/search" in bull["evidence"] or "tarimorman.gov.tr" in bull["evidence"]:
        bull["evidence"] = naab_url

    if "AISS" not in (bull.get("source") or ""):
        bull["source"] = f"NAAB AISS (Ağustos 2026) · {bull.get('source') or 'HAYGEM'}"

    bull["dob"] = hit["dob"]
    bull["betaCasein"] = hit["beta"]
    bull["kappaCasein"] = hit["kappa"]
    bull["tpi"] = hit["tpi"]
    bull["nm"] = hit["nm"]
    bull["pedigree"] = {
        "aissId": hit["cid"],
        "fullId": hit["fullId"],
        "officialName": hit["name"],
        "sireId": hit["sireId"],
        "mgsId": hit["mgsId"],
        "damName": "",
        "damId": "",
        "source": "NAAB AISS (Ağustos 2026)",
    }


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    aiss_path = root / "calisma" / "imports" / "aiss_complete" / "Aug122026-CompleteAISS.txt"
    haygem_xlsx = root / "calisma" / "imports" / "HAYGEM_2026_Boga_Genetik_Kusur_Taramasi.xlsx"
    batch_json = root / "calisma" / "import-batch.json"
    seed_path = root / "site" / "seed.json"

    old_seed = json.loads(seed_path.read_text(encoding="utf-8"))
    by_id, by_naab, aiss_total = load_full_aiss(aiss_path)

    pedigree_index: dict[str, dict] = {}
    bulls: list[dict] = []
    seen_keys: set[str] = set()

    def register_key(b: dict) -> list[str]:
        keys = []
        if b.get("ear"):
            keys.append(f"{b['breed']}|E|{re.sub(r'[^A-Z0-9]', '', b['ear'].upper())}")
        if b.get("naab"):
            keys.append(f"{b['breed']}|N|{re.sub(r'[^A-Z0-9]', '', b['naab'].upper())}")
        return keys

    # 1) HAYGEM 2026 (964 tekil boğa)
    h_rows = read_xlsx_sheet_stdlib(haygem_xlsx, "Boğa Durumu")[4:]
    haygem_added = 0
    for idx, r in enumerate(h_rows, start=1):
        padded = r + [""] * max(0, 18 - len(r))
        raw_id = str(padded[0] or "").strip()
        breed = normalize_breed(padded[1] or padded[2])
        name = str(padded[3] or "").strip()
        country = str(padded[4] or "").strip()
        importer = str(padded[5] or "").strip()
        doses = int(float(padded[7])) if str(padded[7] or "").replace(".", "", 1).isdigit() else 0
        naab_col = str(padded[9] or "").strip()
        reg_col = str(padded[10] or "").strip()
        codes_col = str(padded[11] or "").strip()
        status_col = str(padded[12] or "").strip() or "Kamuya açık kayıtta doğrulanamadı"
        defect_col = str(padded[13] or "").strip()
        url_col = str(padded[17] or "").strip()

        if not name or not raw_id:
            continue

        ear, naab, id_warn = classify_identifier(raw_id)
        if naab_col and not naab:
            naab = naab_col
        if reg_col and not ear:
            ear = reg_col

        # Standart notu kompakt tut (D1 1 MB sınırı ve hızlı yükleme için)
        note_short = ""
        if status_col == "Taşıyıcı":
            note_short = f"HAYGEM 2026 ve NAAB AISS tam kimlik/ırk eşleşmesiyle taşıyıcı doğrulandı ({defect_col or codes_col})."
        elif codes_col:
            note_short = f"Uluslararası kısmi genetik kodlar mevcut ({codes_col}); tam HAYGEM paneli doğrulanmadı."
        elif id_warn:
            note_short = id_warn

        bull = {
            "uid": f"hyg-{idx:04d}-{re.sub(r'[^a-z0-9]+', '', raw_id.lower())[:20]}",
            "name": name,
            "ear": ear,
            "naab": naab,
            "breed": breed,
            "status": status_col if status_col in ("Taşıyıcı", "Arı", "Kamuya açık kayıtta doğrulanamadı", "Bekliyor") else "Kamuya açık kayıtta doğrulanamadı",
            "defect": defect_col,
            "codes": codes_col,
            "attention": id_warn,
            "source": "HAYGEM 2026 İzinli Sperma Listesi",
            "evidence": url_col if url_col.startswith(("http://", "https://")) else "",
            "note": note_short,
            "group": "HAYGEM 2026",
            "country": country,
            "importer": importer,
            "doses": doses,
        }

        hit = match_bull_in_aiss(bull, by_id, by_naab)
        if hit:
            apply_aiss_enrichment(bull, hit, by_id, pedigree_index)

        keys = register_key(bull)
        if any(k in seen_keys for k in keys):
            continue
        seen_keys.update(keys)
        bulls.append(bull)
        haygem_added += 1

    # 2) İleri Eşleştirme (63 kayıt — HAYGEM ile çakışmayanları ekle)
    adv_items = json.loads(batch_json.read_text(encoding="utf-8"))
    adv_added = 0
    for item in adv_items:
        bull = {
            "uid": item["uid"],
            "name": item["name"],
            "ear": item.get("ear", ""),
            "naab": item.get("naab", ""),
            "breed": normalize_breed(item.get("breed", "")),
            "status": item.get("status", "Kamuya açık kayıtta doğrulanamadı"),
            "defect": item.get("defect", ""),
            "codes": item.get("codes", ""),
            "attention": item.get("attention", ""),
            "source": item.get("source", "İleri Eşleştirme"),
            "evidence": item.get("evidence", ""),
            "note": item.get("note", ""),
            "group": "İleri Eşleştirme",
            "country": "",
            "importer": "",
            "doses": 0,
        }
        hit = match_bull_in_aiss(bull, by_id, by_naab)
        if hit:
            apply_aiss_enrichment(bull, hit, by_id, pedigree_index)

        keys = register_key(bull)
        if any(k in seen_keys for k in keys):
            continue
        seen_keys.update(keys)
        bulls.append(bull)
        adv_added += 1

    # Taşıyıcıları ve öncelikli incelemeleri üstte sırala
    bulls.sort(
        key=lambda b: (
            0 if b["status"] == "Taşıyıcı" else (1 if b.get("attention") else (2 if b.get("pedigree") else 3)),
            b["name"].lower(),
        )
    )

    new_seed = {
        "bulls": bulls,
        "pedigreeIndex": pedigree_index,
        "sources": old_seed.get("sources", []),
        "users": old_seed.get("users", []),
        "audit": [],
        "legacyMigrationDone": False,
    }

    # Kompakt JSON yaz (satır sonu ekle, dosya boyutunu minimize et)
    serialized = json.dumps(new_seed, ensure_ascii=False, separators=(",", ":"))
    seed_path.write_text(serialized + "\n", encoding="utf-8")

    with_ped = sum(1 for b in bulls if b.get("pedigree"))
    carriers = [b for b in bulls if b["status"] == "Taşıyıcı"]
    attentions = [b for b in bulls if b.get("attention")]
    print(
        f"Tamamlandı | AISS toplam: {aiss_total} | HAYGEM: {haygem_added} + İleri Eşleştirme: {adv_added} = {len(bulls)} boğa"
    )
    print(
        f"Pedigrili boğa: {with_ped} | Çözümlenen tekil ata: {len(pedigree_index)} | "
        f"Taşıyıcı: {len(carriers)} | Öncelikli uyarı: {len(attentions)} | "
        f"seed.json boyutu: {len(serialized.encode('utf-8')) / 1024:.1f} KB"
    )
    for c in carriers:
        print(f"  CARRIER: {c['name']} | ear={c['ear']} naab={c['naab']} | defect={c['defect']} | doses={c.get('doses',0)}")


if __name__ == "__main__":
    main()
