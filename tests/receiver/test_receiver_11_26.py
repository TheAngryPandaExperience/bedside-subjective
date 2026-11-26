"""Receiver RCV-11-26: the daily roster folder. Made-up names only. Run: python tests/receiver/test_receiver_11_26.py"""
import base64, importlib.util, json, os, sys, tempfile, threading, urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("receiver", HERE.parent.parent / "receiver" / "receiver.py")
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
fails = []
def check(c, what):
    print(("PASS " if c else "FAIL ") + what)
    if not c: fails.append(what)

T = Path(tempfile.mkdtemp(prefix="rcv26_"))
root = T / "drive" / "_Daily Rosters"
check(r.RECEIVER_VERSION == "11/26/2026" and r.ROSTER_FOLDERS == ["F:\\_Daily Rosters"], "version 11/26/2026; the folder is F:\\_Daily Rosters")
check(r.read_roster("Alta Mesa", "2026-11-26", [str(root)])["why"].startswith("the roster folder is not there"), "no folder yet: says so")
check(r.roster_setup([str(T / "nodrive" / "_Daily Rosters")]) == [] and not (T / "nodrive").exists(), "a drive that is not there is not created")
(T / "drive").mkdir()
made = r.roster_setup([str(root)], ["Alta Mesa", "Show Low"])
check(root.is_dir() and (root / "Alta Mesa").is_dir() and (root / "Show Low").is_dir() and (root / "READ ME - daily rosters.txt").is_file() and len(made) == 3, "the folder, a folder per building and the READ ME are made the first time")
check(r.roster_setup([str(root)], ["Showlow", "ALTA MESA"]) == [] and sorted(d.name for d in root.iterdir() if d.is_dir()) == ["Alta Mesa", "Show Low"], "a building that only differs by spaces or capitals does not get a second folder")
miss = r.read_roster("Alta Mesa", "2026-11-26", [str(root)])
check(miss["found"] is False and "no roster for 2026-11-26" in miss["why"] and "The folder is empty" in miss["why"], "empty building folder: " + miss["why"][:90])
am = root / "Alta Mesa"
(am / "Roster AM 11_25_26.pdf").write_bytes(b"%PDF yesterday")
(am / "Roster AM 1_26_26.txt").write_text("January", encoding="utf-8")
(am / "notes.txt").write_text("no date", encoding="utf-8")
miss = r.read_roster("Alta Mesa", "2026-11-26", [str(root)])
check(miss["found"] is False and "Roster AM 11_25_26.pdf" in miss["why"], "another day's file is not used, and the answer lists what is there")
(am / "Roster AM 11_26_26.pdf").write_bytes(b"%PDF today")
hit = r.read_roster("Alta Mesa", "2026-11-26", [str(root)])
check(hit["found"] and hit["file"] == "Roster AM 11_26_26.pdf" and base64.b64decode(hit["data"]) == b"%PDF today" and hit["bytes"] == 10, "the file with the date in its name is sent, byte for byte")
check(r.read_roster("altamesa", "2026-11-26", [str(root)])["found"] and r.read_roster("ALTA  MESA", "2026-11-26", [str(root)])["found"], "the building is matched without regard to spaces and capitals")
check(r.read_roster("Alta Mesa", "2026-01-26", [str(root)])["file"] == "Roster AM 1_26_26.txt" and r.read_roster("Alta Mesa", "2026-11-26", [str(root)])["file"] == "Roster AM 11_26_26.pdf", "1_26_26 is not taken for 11_26_26, and the other way round")
for nm, date in (("List 11-27-2026.docx", "2026-11-27"), ("2026-11-28 census.csv", "2026-11-28"), ("AM 11.29.26.txt", "2026-11-29")):
    (am / nm).write_bytes(b"x")
    check(r.read_roster("Alta Mesa", date, [str(root)]).get("file") == nm, f"date written another way is found: {nm}")
(am / "Roster AM 11_26_26 v2.pdf").write_bytes(b"%PDF newer")
os.utime(am / "Roster AM 11_26_26.pdf", (1, 1))
two = r.read_roster("Alta Mesa", "2026-11-26", [str(root)])
check(two["file"] == "Roster AM 11_26_26 v2.pdf" and two["others"] == ["Roster AM 11_26_26.pdf"], "two files for the day: the newer one is sent and the other is named")
check("data" not in r.read_roster("Alta Mesa", "2026-11-26", [str(root)], meta=True), "meta=1 says what is there without sending the file")
(am / "~$Roster 11_30_26.docx").write_bytes(b"lock"); (am / "photo 11_30_26.jpg").write_bytes(b"jpg")
check(r.read_roster("Alta Mesa", "2026-11-30", [str(root)])["found"] is False, "Word's lock file and a picture are not rosters")
check(r.read_roster("Tempe", "2026-11-26", [str(root)])["why"].startswith("there is no folder for Tempe"), "no folder for the building: says to make one")
check(r.read_roster("", "2026-11-26", [str(root)])["found"] is False and r.read_roster("Alta Mesa", "tomorrow", [str(root)])["found"] is False, "no building / not a date: nothing")
before = sorted((f.name, f.read_bytes()) for f in am.iterdir())
# over HTTP, with and without the token
r.Handler.cfg = {"out": str(T / "out"), "token": "tok", "roster_folders": [str(root)]}
srv = ThreadingHTTPServer(("127.0.0.1", 0), r.Handler); threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_address[1]}/api/roster?building=Alta%20Mesa&date=2026-11-26"
def get(u, token=None):
    req = urllib.request.Request(u, headers={"X-Token": token} if token else {})
    try:
        with urllib.request.urlopen(req) as res: return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e: return e.code, {}
check(get(url)[0] == 401 and get(url, "wrong")[0] == 401, "without the token the roster is refused")
code, body = get(url, "tok")
check(code == 200 and body["found"] and base64.b64decode(body["data"]) == b"%PDF newer", "with the token the phone gets the file")
code, body = get(url.replace("Alta%20Mesa", "Tempe"), "tok")
check(code == 200 and (root / "Tempe").is_dir() and body["found"] is False and "no roster for" in body["why"], "asking for a building makes its folder, ready for a file")
srv.shutdown()
check(sorted((f.name, f.read_bytes()) for f in am.iterdir()) == before, "no roster file was changed, moved or deleted by any of this")
print("ALL PASS" if not fails else f"{len(fails)} FAILED")
sys.exit(1 if fails else 0)
