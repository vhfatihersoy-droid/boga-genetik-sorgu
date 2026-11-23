#!/usr/bin/env python3
"""
Boğa Genetik Kusur Takibi — Yerel Geliştirme ve Test Sunucusu (Bağımsız / Sıfır Bağımlılık)

Cloudflare Worker + D1 (`site/worker/index.js`) ile aynı API sözleşmesini
Python standart kütüphanesi (http.server + sqlite3 + zipfile) ile yerel olarak çalıştırır.

Kullanım:
    python3 site/local_server.py
    python3 site/local_server.py --port 8787 --role Yönetici
"""

from __future__ import annotations

import argparse
import io
import json
import sqlite3
import urllib.parse
import zipfile
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent
DB_PATH = SITE_DIR / "local_state.sqlite3"
SEED_PATH = SITE_DIR / "seed.json"
HTML_PATH = SITE_DIR / "index.html"
SCHEMA_PATH = SITE_DIR / "drizzle" / "0000_site_state.sql"

ROLES = ("Yönetici", "Araştırmacı", "Görüntüleyici")
VALID_STATUSES = {
    "Taşıyıcı",
    "Arı",
    "Kamuya açık kayıtta doğrulanamadı",
    "Bekliyor",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def is_safe_http_url(val: str) -> bool:
    s = str(val or "").strip()
    if not s:
        return True
    parsed = urllib.parse.urlparse(s)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def init_db(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        row = conn.execute("SELECT revision FROM site_state WHERE id = 'main'").fetchone()
        if not row:
            seed_raw = SEED_PATH.read_text(encoding="utf-8")
            conn.execute(
                "INSERT INTO site_state (id, revision, state_json, updated_at) VALUES (?, ?, ?, ?)",
                ("main", 1, seed_raw, now_iso()),
            )
            conn.commit()
    finally:
        conn.close()


def load_state(db_path: Path) -> tuple[int, dict, str]:
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            "SELECT revision, state_json, updated_at FROM site_state WHERE id = 'main'"
        ).fetchone()
        return int(row[0]), json.loads(row[1]), str(row[2])
    finally:
        conn.close()


def update_state(db_path: Path, next_state: dict, expected_rev: int) -> tuple[bool, int, str]:
    conn = sqlite3.connect(db_path)
    ts = now_iso()
    try:
        cur = conn.execute(
            "UPDATE site_state SET state_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?",
            (json.dumps(next_state, ensure_ascii=False), ts, "main", expected_rev),
        )
        conn.commit()
        if cur.rowcount == 0:
            rev = conn.execute("SELECT revision FROM site_state WHERE id = 'main'").fetchone()[0]
            return False, int(rev), ts
        return True, expected_rev + 1, ts
    finally:
        conn.close()


def build_backup_zip(state: dict, revision: int, updated_at: str) -> bytes:
    exported_at = now_iso()
    buf = io.BytesIO()
    readme = (SITE_DIR / "README_TR.md").read_text(encoding="utf-8")
    readme = (
        readme.replace("{{EXPORTED_AT}}", exported_at)
        .replace("{{BULL_COUNT}}", str(len(state.get("bulls", []))))
        .replace("{{USER_COUNT}}", str(len(state.get("users", []))))
    )
    sql_payload = json.dumps(state, ensure_ascii=False).replace("'", "''")
    files = {
        "application/index.html": HTML_PATH.read_text(encoding="utf-8"),
        "application/worker/index.js": (SITE_DIR / "worker" / "index.js").read_text(encoding="utf-8"),
        "application/scripts/build-worker.mjs": (SITE_DIR / "scripts" / "build-worker.mjs").read_text(encoding="utf-8"),
        "application/seed.json": SEED_PATH.read_text(encoding="utf-8"),
        "database/migrations/0000_site_state.sql": SCHEMA_PATH.read_text(encoding="utf-8"),
        "database/current_state.json": json.dumps(
            {"exported_at": exported_at, "revision": revision, "state": state},
            ensure_ascii=False,
            indent=2,
        ),
        "database/restore_site_state.sql": (
            f"INSERT OR REPLACE INTO site_state (id, revision, state_json, updated_at) "
            f"VALUES ('main', {revision}, '{sql_payload}', '{exported_at}');\n"
        ),
        "README_TR.md": readme,
    }
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for arcname, content in files.items():
            zf.writestr(arcname, content.encode("utf-8"))
    return buf.getvalue()


def make_handler(db_path: Path, default_user: dict):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:
            print(f"[{self.log_date_time_string()}] {fmt % args}")

        def send_json(self, data: dict, status: int = 200) -> None:
            raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self) -> None:
            path = urllib.parse.urlparse(self.path).path

            if path == "/api/health":
                rev, _, upd = load_state(db_path)
                return self.send_json({"ok": True, "revision": rev, "updatedAt": upd})

            if path == "/api/session":
                _, st, _ = load_state(db_path)
                return self.send_json(
                    {"user": default_user, "legacyMigrationDone": bool(st.get("legacyMigrationDone"))}
                )

            if path == "/api/state":
                rev, st, upd = load_state(db_path)
                if default_user["role"] != "Yönetici":
                    st = {**st, "users": []}
                return self.send_json({"state": st, "revision": rev, "updatedAt": upd})

            if path == "/api/backup.zip":
                if default_user["role"] != "Yönetici":
                    return self.send_json({"error": "Yedek indirme yalnızca yöneticilere açık."}, 403)
                rev, st, upd = load_state(db_path)
                data = build_backup_zip(st, rev, upd)
                fname = f"Boga_Genetik_Sorgu_Tam_Yedek_{now_iso()[:10]}.zip"
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Disposition", f'attachment; filename="{fname}"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

            if path in ("/", "/index.html"):
                html = HTML_PATH.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Length", str(len(html)))
                self.end_headers()
                self.wfile.write(html)
                return

            self.send_json({"error": "Yol bulunamadı."}, 404)

        def do_PUT(self) -> None:
            path = urllib.parse.urlparse(self.path).path
            if path != "/api/state":
                return self.send_json({"error": "Yol bulunamadı."}, 404)

            if default_user["role"] not in ("Yönetici", "Araştırmacı"):
                return self.send_json({"error": "Bu kullanıcı kayıt değiştiremez."}, 403)

            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                return self.send_json({"error": "JSON okunamadı."}, 400)

            expected = body.get("revision")
            next_state = body.get("state")
            if not isinstance(expected, int) or not isinstance(next_state, dict):
                return self.send_json({"error": "Geçersiz istek yapısı."}, 400)

            for b in next_state.get("bulls", []):
                if not b.get("name") or not b.get("breed") or not (b.get("ear") or b.get("naab")):
                    return self.send_json({"error": "Boğa kaydında ad, ırk ve kimlik zorunludur."}, 400)
                if not is_safe_http_url(b.get("evidence", "")):
                    return self.send_json({"error": f"Geçersiz kanıt URL: {b.get('name')}"}, 400)

            _, cur_state, _ = load_state(db_path)
            if default_user["role"] != "Yönetici":
                next_state["users"] = cur_state.get("users", [])

            ok, new_rev, ts = update_state(db_path, next_state, expected)
            if not ok:
                return self.send_json(
                    {"error": "Kayıt başka kullanıcı tarafından güncellendi.", "currentRevision": new_rev},
                    409,
                )
            return self.send_json({"ok": True, "revision": new_rev, "updatedAt": ts})

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Boğa Genetik Kusur Takibi yerel geliştirme sunucusu")
    parser.add_argument("--host", default="127.0.0.1", help="Dinlenecek adres (varsayılan: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8787, help="Port numarası (varsayılan: 8787)")
    parser.add_argument("--role", choices=ROLES, default="Yönetici", help="Yerel test rolü")
    parser.add_argument("--reset-db", action="store_true", help="Yerel SQLite veritabanını seed.json ile sıfırla")
    args = parser.parse_args()

    if args.reset_db and DB_PATH.exists():
        DB_PATH.unlink()

    init_db(DB_PATH)
    user = {
        "name": "Engin ÜNAY (Yerel)",
        "email": "engin.umut.ufuk@gmail.com",
        "role": args.role,
    }
    server = ThreadingHTTPServer((args.host, args.port), make_handler(DB_PATH, user))
    print(f"Boğa Genetik Kusur Takibi çalışıyor: http://{args.host}:{args.port} (Rol: {args.role})")
    print(f"SQLite veri tabanı: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSunucu kapatıldı.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
