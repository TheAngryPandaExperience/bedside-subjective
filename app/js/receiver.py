#!/usr/bin/env python3
"""Bedside Subjective receiver.

Runs on your computer. It serves the app to your phone and writes each daily summary the
phone sends into a folder you choose. It listens only on this computer (127.0.0.1); Tailscale
Serve makes it reachable from your own devices over HTTPS, and from nowhere else.

    python3 receiver.py --out "C:\\Users\\you\\Documents\\Subjective"

Standard library only; works on Windows, macOS and Linux with Python 3.9+.
"""

import argparse
import hmac
import json
import mimetypes
import re
import secrets
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP_DIR = HERE.parent / "app"
CONFIG = HERE / "receiver.json"
MAX_BODY = 2 * 1024 * 1024

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("application/wasm", ".wasm")


def load_config(args):
    cfg = {}
    if CONFIG.exists():
        cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if args.out:
        cfg["out"] = args.out
    if args.new_token or not cfg.get("token"):
        cfg["token"] = secrets.token_urlsafe(12)
    if not cfg.get("out"):
        cfg["out"] = str(Path.home() / "Documents" / "Subjective")
    CONFIG.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg


def safe_building(name):
    """A building name as a safe folder name: letters, digits, spaces, dash, underscore, period."""
    cleaned = re.sub(r"[^A-Za-z0-9 _.\-]", "", str(name)).strip(" .")
    return cleaned[:60]


class Handler(BaseHTTPRequestHandler):
    server_version = "BedsideReceiver/1"
    cfg = {}

    def log_message(self, fmt, *a):  # keep the console quiet except for sends
        pass

    def _send(self, code, body=b"", ctype="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode(), extra=self._cors())

    def _cors(self):
        # Lets the app work when it is hosted elsewhere (e.g. GitHub Pages). Every request still needs the token.
        origin = self.headers.get("Origin")
        if not origin:
            return {}
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "Content-Type, X-Token",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Private-Network": "true",
            "Vary": "Origin",
        }

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain", self._cors())

    def _authorized(self):
        return hmac.compare_digest(self.headers.get("X-Token", ""), self.cfg["token"])

    # ---- app files ----
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path.endswith("/api/ping"):
            return self._json(200 if self._authorized() else 401, {"ok": self._authorized()})
        rel = path.lstrip("/") or "index.html"
        target = (APP_DIR / rel).resolve()
        if target.is_dir():
            target = target / "index.html"
        if APP_DIR not in target.parents or not target.is_file():
            return self._send(404, b"Not found", "text/plain")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self._send(200, target.read_bytes(), ctype, {"Cache-Control": "no-cache"})

    do_HEAD = do_GET

    # ---- daily summary ----
    def do_POST(self):
        route = self.path.split("?", 1)[0]
        if route.endswith("/api/delete"):
            return self._delete()
        if not route.endswith("/api/send"):
            return self._json(404, {"error": "not found"})
        if not self._authorized():
            return self._json(401, {"error": "bad token"})
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "too large"})
        try:
            data = json.loads(self.rfile.read(length))
            date = data["date"]
            building = safe_building(data.get("building", ""))
            send_no = int(data["sendNo"])
            content = str(data["content"])
            log_line = str(data.get("logLine", ""))
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"error": "bad request"})
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            return self._json(400, {"error": "bad date"})

        root = Path(self.cfg["out"])
        out = root / building if building else root
        (out / "sent").mkdir(parents=True, exist_ok=True)
        stem = f"{date}_{building}" if building else date
        latest = out / f"{stem}_subjective.txt"
        archive = out / "sent" / f"{stem}_send-{send_no:02d}.txt"
        latest.write_text(content, encoding="utf-8", newline="\r\n" if sys.platform == "win32" else "\n")
        archive.write_text(content, encoding="utf-8")
        received = datetime.now().strftime("%m/%d/%Y %H:%M")
        with open(root / "send-log.txt", "a", encoding="utf-8") as f:
            f.write(f"{log_line}  -> {latest.relative_to(root)} (received {received})\n")
        print(f"[{received}] Saved {latest} (send #{send_no})")
        self._json(200, {"ok": True, "file": latest.name})


    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except ValueError:
            return None

    def _delete(self):
        """Delete one day's summary and its archived sends. The running send-log keeps a record."""
        if not self._authorized():
            return self._json(401, {"error": "bad token"})
        data = self._read_json() or {}
        date = str(data.get("date", ""))
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            return self._json(400, {"error": "bad date"})
        building = safe_building(data.get("building", ""))
        root = Path(self.cfg["out"])
        out = root / building if building else root
        stem = f"{date}_{building}" if building else date
        targets = [out / f"{stem}_subjective.txt", *sorted((out / "sent").glob(f"{stem}_send-*.txt"))]
        removed = 0
        for t in targets:
            if t.is_file():
                t.unlink()
                removed += 1
        stamp = datetime.now().strftime("%m/%d/%Y %H:%M")
        where = f"{building} {date}" if building else date
        with open(root / "send-log.txt", "a", encoding="utf-8") as f:
            f.write(f"{stamp}  Deleted {removed} file(s) for {where}\n")
        print(f"[{stamp}] Deleted {removed} file(s) for {where}")
        self._json(200, {"ok": True, "removed": removed})


def main():
    ap = argparse.ArgumentParser(description="Receive Bedside Subjective daily summaries.")
    ap.add_argument("--out", help="Folder to write notes into (remembered for next time)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--new-token", action="store_true", help="Make a new token (re-enter it in the app)")
    args = ap.parse_args()

    cfg = load_config(args)
    Path(cfg["out"]).mkdir(parents=True, exist_ok=True)
    Handler.cfg = cfg
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("Bedside Subjective receiver")
    print(f"  Notes folder : {cfg['out']}")
    print(f"  Token        : {cfg['token']}   (enter this in the app's Settings)")
    print(f"  Listening on : http://127.0.0.1:{args.port}  (this computer only)")
    print(f"  Phone access : run once:  tailscale serve --bg {args.port}")
    print("Press Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
