"""Bedside receiver 11/22/2026: the phone chart (GET /api/chart). Made-up patients only.   [RCV-11-22]
Run: python test_receiver_11_22.py   (next to receiver.py)"""
import json, sys, tempfile, threading, urllib.request, urllib.error, urllib.parse, importlib.util
from http.server import ThreadingHTTPServer
from pathlib import Path
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("receiver", HERE.parent.parent / "receiver" / "receiver.py")
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)

fails = []


def check(cond, what):
    print(("PASS " if cond else "FAIL ") + what)
    if not cond:
        fails.append(what)


TMP = Path(tempfile.mkdtemp(prefix="rcv22_"))
ROOT = TMP / "notes"
CHART = {"kind": "phone-chart", "format": 1, "building": "Bedrock", "made": "11/22/2026 14:05", "updater": "85", "days": 45, "problems": [],
         "patients": [{"mrn": "12345", "name": "FLINTSTONE, FRED", "note": "11/21/2026", "note_file": "FLINTSTONE, FRED PN_BR 11_21_26.docx",
                       "dx": ["Hypertension", "Type 2 diabetes"], "dx_from": "note 11/21/2026",
                       "meds": [{"name": "Lisinopril Oral Tablet 10 MG", "text": "Lisinopril Oral Tablet 10 MG – Give 1 tablet by mouth one time a day, for HTN"}],
                       "meds_from": "Medications file 11/22/2026"}]}
(ROOT / "Bedrock" / "Phone").mkdir(parents=True)
(ROOT / "Bedrock" / "Phone" / "Phone chart.json").write_text(json.dumps(CHART, ensure_ascii=False), encoding="utf-8")
(ROOT / "Slate Rock" / "Phone").mkdir(parents=True)
(ROOT / "Slate Rock" / "Phone" / "Phone chart.json").write_text("{ not json", encoding="utf-8")
(ROOT / "Gravel Pit" / "Phone").mkdir(parents=True)
(ROOT / "Gravel Pit" / "Phone" / "Phone chart.json").write_text(json.dumps({"hello": 1}), encoding="utf-8")
(TMP / "secret.json").write_text(json.dumps({"kind": "phone-chart", "patients": [{"mrn": "outside"}]}), encoding="utf-8")
r.Handler.cfg = {"out": str(ROOT), "token": "tok"}
srv = ThreadingHTTPServer(("127.0.0.1", 0), r.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"


def get(path, token="tok", origin=None):
    req = urllib.request.Request(URL + path, headers={"X-Token": token, **({"Origin": origin} if origin else {})})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read() or b"{}"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), dict(e.headers)


check(r.RECEIVER_VERSION >= "11/22/2026", "the receiver says it is the 11/22/2026 version or later")
code, body, _ = get("/api/chart?building=Bedrock", token="wrong")
check(code == 401 and "chart" not in body and "patients" not in json.dumps(body), "without the token: refused, and nothing about any patient is sent")
code, body, _ = get("/api/chart?building=Bedrock", token="")
check(code == 401, "with no token at all: refused")
code, body, hdr = get("/api/chart?building=Bedrock", origin="https://example.github.io")
check(code == 200 and body["found"] is True and body["chart"] == CHART, "with the token: the building's chart, exactly as Note Updater wrote it")
check(body["modified"][:6] == __import__("datetime").datetime.now().strftime("%m/%d/"), "and when the file was written")
check(hdr.get("Access-Control-Allow-Origin") == "https://example.github.io", "the app hosted on GitHub can read it (same as the other calls)")
code, body, _ = get("/api/chart?building=" + urllib.parse.quote("Quarry"))
check(code == 200 and body["found"] is False and "no phone chart for Quarry yet" in body["why"], "a building with no chart: found false, with the reason")
code, body, _ = get("/api/chart?building=" + urllib.parse.quote("Slate Rock"))
check(code == 200 and body["found"] is False and "could not be read" in body["why"], "a damaged file: found false, not a crash")
code, body, _ = get("/api/chart?building=" + urllib.parse.quote("Gravel Pit"))
check(code == 200 and body["found"] is False and "not a phone chart file" in body["why"], "a file that is not a phone chart is not handed over")
code, body, _ = get("/api/chart")
check(code == 200 and body["found"] is False and body["why"] == "no building was named", "no building named: found false")
for bad in ("../", "..", "../../", "Bedrock/../..", "..\\", "/"):
    code, body, _ = get("/api/chart?building=" + urllib.parse.quote(bad, safe=""))
    check(code == 200 and (body["found"] is False or body["chart"] == CHART) and "outside" not in json.dumps(body), f"a building name like {bad!r} cannot reach a file outside the notes folder")
before = (ROOT / "Bedrock" / "Phone" / "Phone chart.json").read_bytes()
get("/api/chart?building=Bedrock")
check((ROOT / "Bedrock" / "Phone" / "Phone chart.json").read_bytes() == before and sorted(p.name for p in (ROOT / "Bedrock").rglob("*")) == ["Phone", "Phone chart.json"],
      "reading the chart changes nothing in the building folder")
r.Handler.cfg = {"out": str(TMP / "not there"), "token": "tok"}
code, body, _ = get("/api/chart?building=Bedrock")
check(code == 200 and body["found"] is False and "there" in body["why"], "notes folder missing (drive not plugged in): found false, with the reason")
r.Handler.cfg = {"out": str(ROOT), "token": "tok"}
code, body, _ = get("/api/ping")
check(code == 200 and body["ok"] is True, "the other calls still answer (ping)")
code, body, _ = get("/api/status")
check(code == 200 and body["version"] >= "11/22/2026", "status shows the new version")

srv.shutdown()
print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED'}")
sys.exit(1 if fails else 0)
