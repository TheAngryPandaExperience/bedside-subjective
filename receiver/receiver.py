#!/usr/bin/env python3
"""Bedside Subjective receiver.

Runs on your computer. It serves the app to your phone and writes each daily file the phone
sends into the building's Daily folder, where the Note Updater reads it:

    <notes folder>/<Building>/Daily/<Building> Daily notes M_D_YY.docx

Point --out at the folder that holds the building folders (e.g. the USB drive, F:\\).
The send log and a plain-text copy of every send go in <notes folder>/Bedside app/, away from
the building folders so the Note Updater never reads them twice. It listens only on this computer (127.0.0.1); Tailscale
Serve makes it reachable from your own devices over HTTPS, and from nowhere else.

    python3 receiver.py --out "F:\\"

Standard library only; works on Windows, macOS and Linux with Python 3.9+.
"""

import argparse
import base64
import hmac
import io
import json
import mimetypes
import os
import re
import secrets
import sys
import urllib.parse
import zipfile
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
        cfg["out"] = str(Path.home() / "Documents" / "Subjective")  # use --out F:\\ for the USB drive
    CONFIG.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg


RECEIVER_VERSION = "11/26/2026"     # RCV-11-26 (was 11/24/2026): shown by /api/status and at start-up

# =====================================================================================================================
# RCV-11-11  START   -   RECEIPT AND SAFE SAVING (11/11/2026)
# Everything added on 11/11/2026 is between this line and "RCV-11-11  END", plus the lines marked "RCV-11-11" in
# do_GET / do_POST. Nothing the phone sends was changed: an app that does not know about the receipt still works.
# What it adds:
#   - a RECEIPT with every send: how many patients are in the file that was actually saved, entries with no MRN,
#     a patient or MRN sent twice, a gap in the numbering, an empty entry, and - when the building's notes are in the
#     notes folder - any patient not found in them and an MRN that is one digit off a patient with the same last name
#   - the file is written whole or not at all (temporary file, then swapped in)
#   - a clear answer when the daily file is open in Word, and when the notes folder is missing (drive not plugged in)
#   - a send that could not be saved to the notes folder is KEPT in "Bedside held sends" in the user folder, never lost
#   - GET /api/status (with the token): notes folder, whether it is there and writable, receiver version
# To go back: receiver_before_11_11.py is the file as it was.
# =====================================================================================================================
HELD_DIR = Path.home() / "Bedside held sends"
ENTRY_RE = re.compile(r"^\s*(?:(\d+)[.)]\s*)?([A-Za-z][A-Za-z'’.\- ]*,\s*[A-Za-z][A-Za-z'’.\- ]*?)\s*(?:\(\s*([0-9A-Za-z-]*)\s*\))?\s*:\s*(.*)$")
NOTE_NAME_RE = re.compile(r"^\s*([A-Za-z][A-Za-z'’.\- ]*,\s*[A-Za-z][A-Za-z'’.\- ]*?)\s+(?:PN|MN)[A-Za-z_]*\s+\d", re.I)


def docx_lines(data):
    """The paragraphs of a .docx (bytes) as text, one per paragraph, read straight from the file that was saved."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read("word/document.xml").decode("utf-8", "replace")
    out = []
    for para in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
        para = re.sub(r"<w:(?:br|cr)\b[^>]*/>", "\n", para)
        text = "".join(t if t else "\n" for t, _ in re.findall(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>|(\n)", para))
        for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'")):
            text = text.replace(a, b)
        out.extend(text.split("\n"))
    return out


def read_entries(lines):
    """[{no, name, mrn, words}] for the patient lines ("3. LAST, FIRST (1234): ..."); the send log at the end is skipped."""
    entries, cur = [], None
    for ln in lines:
        if re.match(r"^\s*-{2,}\s*send log\s*-{2,}", ln, re.I):
            break
        m = ENTRY_RE.match(ln)
        if m and len(m.group(2)) <= 60:
            cur = {"no": int(m.group(1)) if m.group(1) else None, "name": re.sub(r"\s+", " ", m.group(2)).strip(),
                   "mrn": (m.group(3) or "").strip(), "words": len(m.group(4).split()),
                   "new": bool(re.match(r"\s*new\s+(?:pt|patient)\b", m.group(4), re.I))}
            entries.append(cur)
        elif cur is not None and ln.strip():
            cur["words"] += len(ln.split())
    return entries


def _name_key(name):
    last, _, first = name.partition(",")
    return re.sub(r"[^a-z]", "", last.lower()), re.sub(r"[^a-z]", "", first.lower().split()[0] if first.split() else "")


def roster(root, building):
    """What the building's own notes say: ({(last, first)}, {mrn: (last, first)}), or (None, None) when there are no
    notes for this building in the notes folder (for example when it is not the notes drive)."""
    base = root / building if building else None
    if base is None or not base.is_dir():
        return None, None
    names, mrns = set(), {}
    try:
        for f in base.rglob("*.docx"):
            m = NOTE_NAME_RE.match(f.name)
            if m:
                names.add(_name_key(m.group(1)))
        for idx in base.rglob("note_index.json"):
            try:
                data = json.loads(idx.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            for row in (data.values() if isinstance(data, dict) else []):
                if isinstance(row, dict) and row.get("mrn") and row.get("name") and "," in str(row["name"]):
                    mrns[str(row["mrn"]).strip()] = _name_key(str(row["name"]))
    except OSError:
        pass
    return (names, mrns) if names or mrns else (None, None)


def _one_off(a, b):
    """True when two MRNs differ by one typed character: one digit missing, one extra, or one changed."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def make_receipt(saved_bytes, content, log_line, root, building):
    """The receipt for one send, worked out from the file as it was saved. Returns (dict, lines of text)."""
    try:
        entries = read_entries(docx_lines(saved_bytes))
        read_from = "the saved file"
    except (KeyError, zipfile.BadZipFile, OSError):
        entries, read_from = read_entries(str(content).splitlines()), "the text copy (the Word file could not be read back)"
    problems = []
    said = re.search(r"(\d+)\s+patients?\b", log_line or "")
    if said and int(said.group(1)) != len(entries):
        problems.append(f"the phone said {said.group(1)} patients; {len(entries)} are in {read_from}")
    for e in entries:
        if not e["mrn"]:
            problems.append(f"{e['name']}: no MRN")
        if e["words"] < 3 and not e.get("new"):     # "New pt" with nothing else is a real entry
            problems.append(f"{e['name']}: nothing written (\"{'New pt' if e['words'] else 'blank'}\")" if e["words"] == 0 else f"{e['name']}: only {e['words']} word(s) written")
    seen_m, seen_n = {}, {}
    for e in entries:
        if e["mrn"]:
            if e["mrn"] in seen_m:
                problems.append(f"MRN {e['mrn']} is on two entries: {seen_m[e['mrn']]} and {e['name']}")
            seen_m.setdefault(e["mrn"], e["name"])
        k = _name_key(e["name"])
        if k in seen_n:
            problems.append(f"{e['name']} is in the file twice")
        seen_n.setdefault(k, e["name"])
    nums = [e["no"] for e in entries if e["no"] is not None]
    if nums and nums != list(range(1, len(nums) + 1)):
        missing = sorted(set(range(1, max(nums) + 1)) - set(nums))
        if missing:
            problems.append("the numbering skips " + ", ".join(str(n) for n in missing) + f" ({len(entries)} patients, numbered to {max(nums)})")
    names, mrns = roster(root, building)
    unmatched = []
    if names is None:
        checked = "not checked against your notes (no notes for this building in the notes folder)"
    else:
        checked = f"checked against the {building} notes"
        for e in entries:
            k = _name_key(e["name"])
            if e["mrn"] and e["mrn"] in mrns:
                if mrns[e["mrn"]][0] != k[0]:
                    problems.append(f"{e['name']} ({e['mrn']}): the notes have that MRN for another last name - check it")
                continue
            near = [m for m, nk in mrns.items() if nk[0] == k[0] and e["mrn"] and _one_off(e["mrn"], m)]
            if near:
                problems.append(f"{e['name']}: MRN {e['mrn']} - the notes have {near[0]} for this last name (one digit off?)")
            elif k in names or any(n[0] == k[0] and (n[1][:3] == k[1][:3]) for n in names):
                continue                            # found by name; the Note Updater checks the MRN inside the note
            else:
                unmatched.append(e["name"] + (f" ({e['mrn']})" if e["mrn"] else ""))
    text = [f"{len(entries)} patients received" + (f" for {building}" if building else "") + f"; {checked}."]
    if unmatched:
        text.append("Not found in the notes (new patient, or a name typed differently): " + "; ".join(unmatched))
    text += ["CHECK: " + p for p in problems]
    if not problems and not unmatched:
        text.append("Nothing to check.")
    return {"patients": len(entries), "problems": problems, "notFound": unmatched, "checked": names is not None}, text


def save_whole(target, data):
    """Write the file whole or not at all: a temporary file next to it, then swapped in."""
    tmp = target.with_name(target.name + ".receiving")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def hold_send(filename, docx, content, building, send_no=0):
    """Keep a send that could not be saved to the notes folder. Returns the folder it went to, or None."""
    try:
        folder = HELD_DIR / (building or "No building")
        folder.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d %H%M%S") + f" send-{send_no:02d}"
        n = 1
        while (folder / f"{stamp} {filename}").exists():     # two failed sends in one second: keep both
            n += 1
            stamp = stamp.split(" (")[0] + f" ({n})"
        (folder / f"{stamp} {filename}").write_bytes(docx)
        (folder / f"{stamp} {Path(filename).stem}.txt").write_text(str(content), encoding="utf-8")
        return folder
    except OSError:
        return None
# =====================================================================================================================
# RCV-11-11  END
# =====================================================================================================================

APP_DIRNAME = "Bedside app"
DOCX_CREATOR = "Bedside Subjective"


def safe_filename(name):
    """A file name with no folders in it and only safe characters."""
    cleaned = re.sub(r"[^A-Za-z0-9 _.\-()]", "", Path(str(name)).name).strip(" .")
    return cleaned[:120]


def made_by_app(path):
    """True if this .docx was written by Bedside Subjective (so a resend may replace it)."""
    try:
        with zipfile.ZipFile(path) as z:
            core = z.read("docProps/core.xml").decode("utf-8", "replace")
        return f"<dc:creator>{DOCX_CREATOR}</dc:creator>" in core
    except (OSError, KeyError, zipfile.BadZipFile):
        return False


def safe_building(name):
    """A building name as a safe folder name: letters, digits, spaces, dash, underscore, period."""
    cleaned = re.sub(r"[^A-Za-z0-9 _.\-]", "", str(name)).strip(" .")
    return cleaned[:60]


def _move_into(src, dst):
    """Move everything in folder src into folder dst. Files already in dst are never replaced."""
    dst.mkdir(parents=True, exist_ok=True)
    for item in list(src.iterdir()):
        target = dst / item.name
        if item.is_dir():
            _move_into(item, target)
        elif not target.exists():
            item.rename(target)
    try:
        src.rmdir()  # only if it is now empty
    except OSError:
        pass


def _rename_dir(src, dst):
    """Rename folder src to dst, or merge it into dst if dst is already there."""
    if not src.is_dir():
        return False
    if dst.exists() and os.path.samefile(src, dst):
        if src.name == dst.name:
            return False
        # Only the capitals differ (Windows sees one folder): rename through a temporary name.
        tmp = src.with_name(src.name + ".renaming")
        src.rename(tmp)
        tmp.rename(dst)
    elif dst.exists():
        _move_into(src, dst)
    else:
        src.rename(dst)
    return True


def apply_renames(root, building, former_names):
    """A building renamed in the app: move <Old>/ to <New>/ and rename "<Old> Daily notes ..." files.

    Safe to run on every send: once the old folder is gone it does nothing. Returns the old names it moved.
    """
    done = []
    if not building:
        return done
    for old in former_names or []:
        old = safe_building(old)
        if not old or old == building:
            continue
        moved = _rename_dir(root / old, root / building)
        _rename_dir(root / APP_DIRNAME / "sent" / old, root / APP_DIRNAME / "sent" / building)
        daily = root / building / "Daily"
        if daily.is_dir():
            for f in list(daily.iterdir()):
                if f.is_file() and f.name.startswith(f"{old} Daily notes"):
                    target = daily / (building + f.name[len(old):])
                    if not target.exists():
                        f.rename(target)
                        moved = True
        archive = root / APP_DIRNAME / "sent" / building
        if archive.is_dir():
            for f in list(archive.iterdir()):
                if f.is_file() and f.name.startswith(f"{old} Daily notes"):
                    target = archive / (building + f.name[len(old):])
                    if not target.exists():
                        f.rename(target)
        if moved:
            done.append(old)
    return done


def _former(data):
    names = data.get("formerNames") or []
    return [str(n) for n in names][:20] if isinstance(names, list) else []


# =====================================================================================================================
# RCV-11-22  START   -   THE PHONE CHART (11/22/2026)
# Note Updater (version 85) writes  <notes folder>\<Building>\Phone\Phone chart.json : each current patient's
# diagnoses and medications. GET /api/chart?building=<Building> (with the token) hands that file to the phone app for
# its Dx and Meds buttons. The receiver only reads the file; it never changes it and sends it nowhere else.
# To go back: receiver_before_11_22.py is the file as it was (an app that asks for the chart then just gets none).
# =====================================================================================================================
CHART_FOLDER, CHART_FILE = "Phone", "Phone chart.json"


# ---------------------------------------------------------------------------------------------------------------------
# RCV-11-24  START   -   WHERE THE PHONE CHART IS LOOKED FOR (11/24/2026)
# What went wrong: the charts never reached the phone. Note Updater writes them on the notes drive
# (F:\<Building>\Phone), but this receiver saves and looks in its own folder (receiver.json "out", here a Downloads
# folder), and the app's name for a building can differ from the folder's ("Showlow" / "Show Low").
# Now the chart is looked for in the receiver's folder AND in the notes drives listed in CHART_FOLDERS (receiver.json
# "chart_folders" replaces the list), a building is matched ignoring spaces, capitals and punctuation, and when more
# than one chart is found the newest file is used. Only files named Phone\Phone chart.json are ever read.
# To go back: receiver_before_11_24.py.
CHART_FOLDERS = ["F:\\"]


def _squash(name):
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def chart_candidates(roots, building):
    """Every Phone chart.json for this building under the given folders: [(path, where its folder was found)]."""
    want, found = _squash(building), []
    for root in roots:
        root = Path(root)
        try:
            folders = [d for d in root.iterdir() if d.is_dir() and _squash(d.name) == want]
        except OSError:
            continue                                 # a drive that is not plugged in
        for d in folders:
            target = d / CHART_FOLDER / CHART_FILE
            if target.is_file():
                found.append(target)
    return found


# ---------------------------------------------------------------------------------------------------------------------
# RCV-11-26  START   -   THE DAILY ROSTER FOLDER (11/26/2026)
# His request: "a folder that pairs with the app and sends the daily roster to the phone so I don't have to take a pic".
# He saves the list from PCC into   F:\_Daily Rosters\<Building>\   with the date of service in the file's name
# (Roster AM 11_26_26.pdf). GET /api/roster?building=<Building>&date=2026-11-26 (with the token) hands that file to
# the phone, which reads it with the same exact reader it uses for "Choose file". The receiver only reads: it never
# changes, moves or deletes a roster file, and it sends it nowhere else.
# The folders it looks in: ROSTER_FOLDERS below, or receiver.json "roster_folders" (a list) in their place.
# To go back: receiver_before_11_26.py is the file as it was (an app that asks for a roster then just gets none).
# =====================================================================================================================
ROSTER_FOLDERS = ["F:\\_Daily Rosters"]
ROSTER_TYPES = (".pdf", ".txt", ".docx", ".csv")
ROSTER_MAX_BYTES = 8 * 1024 * 1024
ROSTER_README = """Daily rosters for the Bedside app
=================================

Save the patient list you download from PCC into the folder of its building, with the date of service in the
file's name. For example:

    _Daily Rosters\\Alta Mesa\\Roster AM 11_26_26.pdf

- One folder per building, named like the building (spaces and capitals do not matter).
- The date can be written 11_26_26, 11-26-26, 11.26.2026 or 2026-11-26.
- PDF, .txt, .docx or .csv. A PDF saved from PCC is read exactly; nothing is photographed.
- On the phone: Load patients shows the roster for the building and date you are on.
- The app never changes or deletes these files. Removing a patient on the phone changes the phone's list only.
"""


def roster_dates(date):
    """The ways a date of service (YYYY-MM-DD) may be written in a file name."""
    try:
        d = datetime.strptime(date, "%Y-%m-%d")
    except (TypeError, ValueError):
        return []
    m, dd, y, yy = d.month, d.day, d.year, d.year % 100
    out = set()
    for sep in "_-. ":
        for mm in {str(m), f"{m:02d}"}:
            for day in {str(dd), f"{dd:02d}"}:
                out.add(f"{mm}{sep}{day}{sep}{yy:02d}")
                out.add(f"{mm}{sep}{day}{sep}{y}")
        out.add(f"{y}{sep}{m:02d}{sep}{dd:02d}")
    return sorted(out)


def _has_date(name, wanted):
    """Is one of the date spellings in the file name, not as part of a longer number (1_26_26 inside 11_26_26)?"""
    return any(re.search(r"(?<!\d)" + re.escape(w) + r"(?!\d)", name) for w in wanted)


def read_roster(building, date, folders=None, meta=False):
    """The roster file for one building and date of service:
    {"ok": True, "found": True, "file", "modified", "bytes", "data": base64} or found False with why in words."""
    name = safe_building(building)
    wanted = roster_dates(date)
    if not name or not wanted:
        return {"ok": True, "found": False, "why": "no building or date was named"}
    roots = [Path(r) for r in (ROSTER_FOLDERS if folders is None else folders)]
    there = [r for r in roots if r.is_dir()]
    if not there:
        return {"ok": True, "found": False, "why": f"the roster folder is not there ({', '.join(str(r) for r in roots)}) - is the drive plugged in?"}
    want, hits, seen_folder, others = _squash(name), [], False, []
    for root in there:
        try:
            subs = [d for d in root.iterdir() if d.is_dir() and _squash(d.name) == want]
        except OSError:
            continue
        for sub in subs:
            seen_folder = True
            try:
                files = [f for f in sub.iterdir() if f.is_file() and f.suffix.lower() in ROSTER_TYPES and not f.name.startswith("~$")]
            except OSError:
                continue
            for f in files:
                (hits if _has_date(f.stem, wanted) else others).append(f)
    if not seen_folder:
        return {"ok": True, "found": False, "why": f"there is no folder for {name} in {there[0]} - make one with that name and save the roster in it"}
    if not hits:
        extra = f" It holds: {', '.join(sorted(f.name for f in others)[:6])}." if others else " The folder is empty."
        return {"ok": True, "found": False, "why": f"no roster for {date} in the {name} folder - the file's name needs the date, like {wanted[0]}.{extra}"}
    hits.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    target = hits[0]
    size = target.stat().st_size
    out = {"ok": True, "found": True, "file": target.name, "folder": str(target.parent), "bytes": size,
           "modified": datetime.fromtimestamp(target.stat().st_mtime).strftime("%m/%d/%Y %H:%M"),
           "others": [f.name for f in hits[1:]]}
    if meta:
        return out
    if size > ROSTER_MAX_BYTES:
        return {"ok": True, "found": False, "why": f"{target.name} is too large to send ({size // (1024 * 1024)} MB)"}
    try:
        out["data"] = base64.b64encode(target.read_bytes()).decode("ascii")
    except OSError as e:
        return {"ok": True, "found": False, "why": f"{target.name} could not be read ({e}) - is it open in another program?"}
    return out


def roster_setup(folders=None, buildings=()):
    """Make the roster folder and its README the first time, when its drive is there. Never touches a roster file."""
    made = []
    for root in [Path(r) for r in (ROSTER_FOLDERS if folders is None else folders)]:
        try:
            if not root.parent.is_dir():
                continue                              # the drive is not plugged in
            if not root.is_dir():
                root.mkdir()
                made.append(str(root))
            readme = root / "READ ME - daily rosters.txt"
            if not readme.exists():
                readme.write_text(ROSTER_README, encoding="utf-8")
            have = {_squash(d.name) for d in root.iterdir() if d.is_dir()}
            for b in buildings:
                if safe_building(b) and _squash(b) not in have:
                    (root / safe_building(b)).mkdir()
                    made.append(str(root / safe_building(b)))
        except OSError:
            continue
    return made
# RCV-11-26  END
# ---------------------------------------------------------------------------------------------------------------------


def read_chart(root, building, more=None):
    """The building's phone chart: {"ok": True, "found": True, "chart": {...}, "modified": "..."} or found False + why."""
    name = safe_building(building)
    if not name:
        return {"ok": True, "found": False, "why": "no building was named"}
    roots, seen = [], set()
    for r in [root] + list(CHART_FOLDERS if more is None else more):
        key = str(r).rstrip("\\/").lower()
        if r and key not in seen:
            seen.add(key)
            roots.append(r)
    there = [r for r in roots if Path(r).is_dir()]
    if not there:
        return {"ok": True, "found": False, "why": f"none of the notes folders is there ({', '.join(str(r) for r in roots)}) - is the drive plugged in?"}
    good, bad = [], None
    for target in chart_candidates(there, name):
        try:
            chart = json.loads(target.read_text(encoding="utf-8"))
            if not isinstance(chart, dict) or chart.get("kind") != "phone-chart" or not isinstance(chart.get("patients"), list):
                raise ValueError("not a phone chart file")
            good.append((target.stat().st_mtime, target, chart))
        except (OSError, ValueError) as e:
            bad = f"the phone chart for {name} could not be read ({e})"
    if not good:
        missing = [str(r) for r in roots if not Path(r).is_dir()]
        return {"ok": True, "found": False, "why": bad or (
            f"no phone chart for {name} yet in {', '.join(str(r) for r in there)}"
            + (f" (not plugged in: {', '.join(missing)})" if missing else "")
            + " - run Note Updater for this building (version 85 or later)")}
    mtime, target, chart = max(good, key=lambda g: g[0])
    return {"ok": True, "found": True, "chart": chart, "from": str(target.parent.parent),
            "modified": datetime.fromtimestamp(mtime).strftime("%m/%d/%Y %H:%M")}
# RCV-11-24  END
# RCV-11-22  END
# =====================================================================================================================


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
        if path.endswith("/api/status"):            # RCV-11-11: is the notes folder there, can it be written to
            if not self._authorized():
                return self._json(401, {"ok": False})
            root = Path(self.cfg["out"])
            return self._json(200, {"ok": True, "version": RECEIVER_VERSION, "notesFolder": str(root), "folderThere": root.is_dir(),
                                    "writable": root.is_dir() and os.access(root, os.W_OK)})
        if path.endswith("/api/chart"):             # RCV-11-22: the phone chart for one building
            if not self._authorized():
                return self._json(401, {"ok": False})
            query = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            return self._json(200, read_chart(self.cfg["out"], (query.get("building") or [""])[0], self.cfg.get("chart_folders")))
        if path.endswith("/api/roster"):            # RCV-11-26: the day's roster file for one building
            if not self._authorized():
                return self._json(401, {"ok": False})
            query = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            building = (query.get("building") or [""])[0]
            roster_setup(self.cfg.get("roster_folders"), [building])      # the folder and this building's folder, first time
            return self._json(200, read_roster(building, (query.get("date") or [""])[0], self.cfg.get("roster_folders"),
                                               meta=(query.get("meta") or [""])[0] == "1"))
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
            content = str(data.get("content", ""))
            docx = base64.b64decode(data["docx"], validate=True)
            filename = safe_filename(data["filename"])
            log_line = str(data.get("logLine", ""))
            overwrite = bool(data.get("overwrite"))
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"error": "bad request"})
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            return self._json(400, {"error": "bad date"})
        if not filename.endswith(".docx"):
            return self._json(400, {"error": "bad file name"})
        try:
            zipfile.ZipFile(io.BytesIO(docx)).testzip()
        except zipfile.BadZipFile:
            return self._json(400, {"error": "not a Word file"})

        root = Path(self.cfg["out"])
        if not root.is_dir():                       # RCV-11-11: the drive is not plugged in - keep the send, say so plainly
            held = hold_send(filename, docx, content, building, send_no)
            print(f"NOTES FOLDER MISSING: {root}. Send #{send_no} kept in {held}" if held else f"NOTES FOLDER MISSING: {root}. The send could NOT be kept.")
            return self._json(503, {"error": "no_folder", "held": bool(held),
                                    "message": f"The notes folder {root} is not there (is the drive plugged in?). "
                                               + (f"This send was kept on the computer in {held}. Plug the drive in and send again." if held
                                                  else "The send was NOT saved. Keep it on the phone and send again.")})
        renamed = []
        try:
            renamed = apply_renames(root, building, _former(data))
        except OSError as e:
            print(f"Could not finish renaming the old folder for {building}: {e} (is a file open in Word?)")
        for old in renamed:
            print(f"Renamed building folder {old} -> {building}")
        folder = (root / building / "Daily") if building else (root / "Daily")
        new_building = bool(building) and not (root / building).exists()
        target = folder / filename
        try:
            folder.mkdir(parents=True, exist_ok=True)
            # Never replace a file someone made by hand unless the phone asked to.
            if target.exists() and not made_by_app(target) and not overwrite:
                return self._json(409, {"error": "exists", "file": filename})
            save_whole(target, docx)                # RCV-11-11: whole or not at all
        except OSError as e:                        # RCV-11-11: open in Word, read-only, drive pulled out mid-send
            held = hold_send(filename, docx, content, building, send_no)
            is_open = isinstance(e, PermissionError)
            print(f"COULD NOT SAVE {target}: {e}. Send #{send_no} " + (f"kept in {held}" if held else "could NOT be kept"))
            return self._json(423 if is_open else 500, {
                "error": "open" if is_open else "save_failed", "file": filename, "held": bool(held),
                "message": (f"{filename} could not be replaced - it is probably open in Word on the computer. Close it and send again."
                            if is_open else f"{filename} could not be saved ({e}).")
                           + (f" This send was kept in {held}." if held else " The send was NOT saved. Keep it on the phone.")})
        try:
            receipt, receipt_text = make_receipt(target.read_bytes(), content, log_line, root, building)   # RCV-11-11
        except Exception as e:                      # the receipt must never fail a send that was saved
            receipt, receipt_text = {"patients": None, "problems": [f"the receipt could not be worked out ({e})"], "notFound": [], "checked": False}, [f"Saved. The receipt could not be worked out ({e})."]

        app_dir = root / APP_DIRNAME
        archive = app_dir / "sent" / (building or "No building")
        archive.mkdir(parents=True, exist_ok=True)
        (archive / f"{Path(filename).stem}_send-{send_no:02d}.txt").write_text(content, encoding="utf-8")
        received = datetime.now().strftime("%m/%d/%Y %H:%M")
        with open(app_dir / "send-log.txt", "a", encoding="utf-8") as f:
            f.write(f"{log_line}  -> {target.relative_to(root)} (received {received})\n")
            for line in receipt_text:               # RCV-11-11
                f.write(f"      receipt: {line}\n")
        print(f"[{received}] Saved {target} (send #{send_no})" + ("  NOTE: new building folder created" if new_building else ""))
        for line in receipt_text:
            print("      " + line)
        self._json(200, {"ok": True, "file": filename, "newBuildingFolder": new_building, "renamed": renamed,
                         "receipt": receipt, "receiptText": "\n".join(receipt_text)})

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
        try:
            apply_renames(root, building, _former(data))
        except OSError as e:
            print(f"Could not finish renaming the old folder for {building}: {e}")
        folder = (root / building / "Daily") if building else (root / "Daily")
        y, m, d = (int(x) for x in date.split("-"))
        stem = f"{building} Daily notes" if building else "Daily notes"
        target = folder / f"{stem} {m}_{d}_{str(y)[-2:]}.docx"
        removed = 0
        # Only delete the app's own file; one made by hand is left alone.
        if target.is_file() and made_by_app(target):
            target.unlink()
            removed = 1
        stamp = datetime.now().strftime("%m/%d/%Y %H:%M")
        where = f"{building} {date}" if building else date
        app_dir = root / APP_DIRNAME
        app_dir.mkdir(parents=True, exist_ok=True)
        with open(app_dir / "send-log.txt", "a", encoding="utf-8") as f:
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
    try:
        Path(cfg["out"]).mkdir(parents=True, exist_ok=True)
    except OSError as e:                            # RCV-11-11: start anyway and say so; sends are kept until the drive is back
        print(f"  WARNING: the notes folder {cfg['out']} is not there ({e}). Sends will be kept in {HELD_DIR} until it is.")
    Handler.cfg = cfg
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Bedside Subjective receiver ({RECEIVER_VERSION})")
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
