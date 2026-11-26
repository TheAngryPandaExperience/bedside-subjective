"""Bedside receiver 11/24/2026: where the phone chart is looked for. Made-up patients only.   [RCV-11-24]
What went wrong: Note Updater writes the chart on the notes drive, the receiver looked only in its own folder, and the
app's building name can differ from the folder name. Run: python test_receiver_11_24.py   (next to receiver.py)"""
import json, os, sys, tempfile, threading, time, urllib.request, urllib.parse, importlib.util
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


def chart(building, n, made):
    return {"kind": "phone-chart", "format": 1, "building": building, "made": made, "updater": "86", "days": 45, "problems": [],
            "patients": [{"mrn": str(9000 + i), "name": f"MOUSE, MICKEY {i}", "note": "11/21/2026", "note_file": "x.docx", "dx": ["Hypertension"],
                          "dx_from": "note 11/21/2026", "meds": [], "meds_from": "note 11/21/2026"} for i in range(n)]}


def put(folder, building, c, age=0):
    p = Path(folder) / building / "Phone"
    p.mkdir(parents=True, exist_ok=True)
    f = p / "Phone chart.json"
    f.write_text(json.dumps(c), encoding="utf-8")
    if age:
        t = time.time() - age
        os.utime(f, (t, t))
    return f


TMP = Path(tempfile.mkdtemp(prefix="rcv24_"))
OUT, DRIVE, GONE = TMP / "downloads notes", TMP / "notes drive", TMP / "unplugged"
(OUT / "Showlow" / "Daily").mkdir(parents=True)                      # where the receiver saves the day; no chart here
put(DRIVE, "Show Low", chart("Show Low", 3, "11/24/2026 07:10"))     # where Note Updater writes it; the folder has a space
put(DRIVE, "Alta Mesa", chart("Alta Mesa", 2, "11/23/2026 06:00"), age=3600)
put(OUT, "Alta Mesa", chart("Alta Mesa", 5, "11/24/2026 09:00"))     # a newer one in the receiver's own folder
put(TMP, "Show Low", {"kind": "phone-chart", "patients": [{"mrn": "outside"}]})   # outside every listed folder

check(__import__("datetime").datetime.strptime(r.RECEIVER_VERSION, "%m/%d/%Y") >= __import__("datetime").datetime(2026, 11, 24), "the receiver says it is the 11/24/2026 version or later")
got = r.read_chart(str(OUT), "Showlow", [str(DRIVE)])
check(got["found"] and len(got["chart"]["patients"]) == 3 and got["from"] == str(DRIVE / "Show Low"),
      'the app says "Showlow", the drive folder is "Show Low": the chart on the notes drive is found')
check(r.read_chart(str(OUT), "showlow", [str(DRIVE)])["found"] and r.read_chart(str(OUT), "SHOW-LOW", [str(DRIVE)])["found"], "capitals, spaces and punctuation in the name do not matter")
got = r.read_chart(str(OUT), "Alta Mesa", [str(DRIVE)])
check(got["found"] and len(got["chart"]["patients"]) == 5, "a chart in both places: the newest file is used")
got = r.read_chart(str(OUT), "Showlow", [])
check(got["found"] is False and "no phone chart for Showlow yet" in got["why"], "with only the receiver's own folder (as before) there is no chart - and it says where it looked")
got = r.read_chart(str(OUT), "Showlow", [str(GONE)])
check(got["found"] is False and "not plugged in" in got["why"] and str(GONE) in got["why"], "the notes drive unplugged: found false, and it names the drive")
got = r.read_chart(str(GONE), "Showlow", [str(GONE)])
check(got["found"] is False and "none of the notes folders is there" in got["why"], "no folder at all: found false, with the reason")
got = r.read_chart(str(OUT), "Quarry", [str(DRIVE)])
check(got["found"] is False, "a building with no chart anywhere: found false")
for bad in ("..", "../Show Low", "Show Low/..", "..\\Show Low"):
    got = r.read_chart(str(OUT), bad, [str(DRIVE)])
    check("outside" not in json.dumps(got), f"a name like {bad!r} never reaches a chart outside the listed folders")
put(DRIVE, "Springdale", {"hello": 1})
got = r.read_chart(str(OUT), "Springdale", [str(DRIVE)])
check(got["found"] is False and "not a phone chart file" in got["why"], "a file that is not a phone chart is not handed over")
before = {p: p.read_bytes() for p in TMP.rglob("*") if p.is_file()}
r.read_chart(str(OUT), "Showlow", [str(DRIVE)])
check({p: p.read_bytes() for p in TMP.rglob("*") if p.is_file()} == before, "looking for the chart changes no file")
check(r.CHART_FOLDERS == ["F:\\"], "the notes drive looked in by default is F:\\")

r.Handler.cfg = {"out": str(OUT), "token": "tok", "chart_folders": [str(DRIVE)]}
srv = ThreadingHTTPServer(("127.0.0.1", 0), r.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
req = urllib.request.Request(f"http://127.0.0.1:{srv.server_address[1]}/api/chart?building=Showlow", headers={"X-Token": "tok"})
body = json.loads(urllib.request.urlopen(req).read())
check(body["found"] and len(body["chart"]["patients"]) == 3, 'over the link: the phone asking for "Showlow" gets the Show Low chart (receiver.json "chart_folders" is used)')
srv.shutdown()
print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED'}")
sys.exit(1 if fails else 0)
