# Bedside Subjective

A phone and tablet app for writing the subjective (CC:) narrative while you see patients.
Load the day's PointClickCare roster, tap a patient, answer the location and pain prompts,
add smart phrases, and send one daily summary file to a folder on your computer.

Everything stays on your own devices. The roster and vitals are read on the phone (no cloud OCR),
notes are stored on the phone, and the daily file travels to your computer over Tailscale.

## How it fits together

```
Phone / tablet (installed web app)  --Tailscale (private, encrypted)-->  Your computer
  patient list, prompts, editor                                           receiver.py
  notes saved on the device                                               writes Notes/2026-10-25_subjective.txt
```

The computer serves the app and receives the files, so there is one app for iPhone, iPad and
Android, and nothing to install from an app store.

## One-time setup on the computer

1. Install [Python 3](https://www.python.org/downloads/) (on Windows, tick "Add to PATH").
2. Install [Tailscale](https://tailscale.com/download) on the computer and on each phone/tablet,
   signed in to the same account.
3. In the Tailscale admin console, under **DNS**, turn on **MagicDNS** and **HTTPS Certificates**.
4. Download this repository and start the receiver:
   - Windows: double-click `receiver/start-windows.bat`
   - Mac: double-click `receiver/start-mac.command`
   - Or: `python3 receiver/receiver.py --out "<folder for your notes>"`

   It prints a **token**. Keep the window open while you work.
5. In a terminal, run once: `tailscale serve --bg 8765`
   It prints an address like `https://your-pc.tail1234.ts.net`. Only your own devices can open it.

## One-time setup on each phone or tablet

1. Open the `https://your-pc....ts.net` address in Chrome (Android) or Safari (iPhone/iPad).
2. Add it to the home screen (Android: menu → Install app; iPhone: Share → Add to Home Screen).
3. Open the app → **Settings** → paste the token → **Test connection** → **Save**.

## Daily use

1. Pick the date of service (today or any past date).
2. **Load patients**: choose the PCC roster (PDF reads exactly; photos work and any doubtful MRN is
   highlighted). Check the list and tap **Add**.
3. **Load vitals** (optional): choose the collated vitals list. Each row is matched by MRN, then name.
   Rows where the name doesn't match are left unchecked for you to decide.
4. Tap a patient: pick where they were assessed, pick the pain score, then add to the note.
   Type a shortcut (e.g. `.s`) and a space, or tap a group on the phrase bar.
   The note saves as you type. **Done with patient** marks it finished; you can reopen it any time.
5. **Send day** writes the summary to your folder. Edit a patient later and send again: the file is
   replaced with the update and the send log shows what changed.

## Files written to your notes folder

| File | What it is |
|---|---|
| `2026-10-25_subjective.txt` | The latest daily summary, numbered by patient, with the send log at the bottom |
| `sent/2026-10-25_send-01.txt` | A copy of every send, kept unchanged |
| `send-log.txt` | One line per send across all days |

## Privacy

- Use a device passcode (this also encrypts the device's storage).
- Each day is deleted from the phone a set number of days after it's sent (Settings → Privacy, default 7).
- Keep the notes folder out of OneDrive/iCloud/Dropbox, on an encrypted drive (BitLocker/FileVault).
- The receiver only listens on the computer itself; Tailscale Serve exposes it to your devices only,
  and each send must carry the token.

## Development

```
npm install
./scripts/vendor.sh        # copies OCR/PDF/Word libraries into app/vendor (already committed)
node --test tests/*.test.js
python3 receiver/receiver.py --out /tmp/notes   # then open http://127.0.0.1:8765
```

Parsers live in `app/js/parsers.js` and are tested against the sample roster photo and both vitals layouts
in `tests/fixtures/` (all fake data).
