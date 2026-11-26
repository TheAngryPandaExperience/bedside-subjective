"""Test helper: the real receiver (receiver/receiver.py) serving the app on 127.0.0.1:8770 with a throw-away notes folder
and one made-up phone chart. Started by tests/run-all.mjs. Made-up patients only."""
import importlib.util, json, os, sys
from http.server import ThreadingHTTPServer
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["BEDSIDE_OUT"])
spec = importlib.util.spec_from_file_location("receiver", ROOT / "receiver" / "receiver.py")
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
r.APP_DIR = (ROOT / "app").resolve()
r.HELD_DIR = OUT / "held"
r.CHART_FOLDERS = []
ROSTERS = OUT / "_Daily Rosters"
r.Handler.cfg = {"out": str(OUT), "token": "tok", "roster_folders": [str(ROSTERS)]}
(ROSTERS / "Roster Hall").mkdir(parents=True, exist_ok=True)
(ROSTERS / "Roster Hall" / "Roster RH 11_26_26.txt").write_text("\n".join([
    "User: Sample, Pat  Medical Professional",
    "MOUSE, MICKEY (7961) Pod B 210 - 1 1/2/2026 7961",
    "DUCK, DAISY (8104) Pod A 203 - 2 1/2/2026 8104",
    "FLINTSTONE, FRED (8101) Pod A 202 - 1 1/2/2026 8101",
    "JETSON, JANE (8080) 1/2/2026 8080",
    "BOOP, BETTY (8096) Pod A 202 - 2 1/2/2026 8096"]), encoding="utf-8")
chart = {"kind": "phone-chart", "made": "11/22/2026 18:59", "building": "Test Hall", "patients": [
    {"name": "MOUSE, MICKEY", "mrn": "9001", "dx": ["Hypertension", "Type 2 diabetes", "UTI \"complicated\" <E. coli>"],
     "dx_from": "note 11/21/2026", "meds_from": "Medications file 11/22/2026",
     "meds": [{"name": "Lisinopril Oral Tablet 10 MG", "text": "Lisinopril Oral Tablet 10 MG — Give 1 tablet by mouth one time a day, for HTN (on hold)"},
              {"name": "Metformin HCl Oral Tablet 500 MG", "text": "Metformin HCl Oral Tablet 500 MG — Give 1 tablet by mouth two times a day"},
              {"name": "Jardiance Oral Tablet 10 MG (Empagliflozin)", "text": "Jardiance Oral Tablet 10 MG (Empagliflozin) — Give 1 tablet by mouth one time a day"}]},
    {"name": "GOOF, GOOFY", "mrn": "9003", "dx": [], "dx_from": "note 11/21/2026", "meds": [], "meds_from": "note 11/21/2026"}]}
(OUT / "Test Hall" / "Phone").mkdir(parents=True, exist_ok=True)
(OUT / "Test Hall" / "Phone" / "Phone chart.json").write_text(json.dumps(chart), encoding="utf-8")
ThreadingHTTPServer(("127.0.0.1", 8770), r.Handler).serve_forever()
