# Releasing the Bedside app

Everything the phone runs is in the `app` folder. GitHub serves it; the phone picks up a new version the next time the
app is opened twice.

## Putting a new version on GitHub (one drag)

1. Unzip the release you were given. Inside are folders laid out exactly like this repository: `app`, `tests`,
   `receiver`, `.github`, plus `package.json` and `RELEASING.md`.
2. On GitHub open the **top** of the repository (the page that lists `app`, `tests`, `README.md`).
3. **Add file → Upload files**.
4. Select everything inside the unzipped folder (the folders themselves, not the files in them) and drag it onto the
   page. GitHub keeps the folders, so every file lands where it belongs. Nothing has to be put into `app/js` by hand.
5. **Commit changes**.
6. Wait about two minutes and look at the commit on the repository's front page:
   - a **green tick** next to it means every test passed;
   - a **red X** means something failed: open the **Actions** tab, click the newest run, and read the lines that start
     with `FAIL`. The phone still gets the files either way, so say what failed before using the new version.
7. On the phone: close the app, open it, wait a few seconds, close and open it once more. **Settings** shows the version.

## The version number

It lives in one file only: `app/js/version.js`. Both the app (Settings screen) and the offline copy read it from there.
A release raises that number by 1; nothing else needs changing.

## The tests

`tests/run-all.mjs` runs all of them (GitHub does this on every upload - see `.github/workflows/tests.yml`):

| Part | What it checks |
|---|---|
| structure | one version number, the offline file list, files in the right folders |
| `tests/logic`, `tests/parsers.test.js` | the sentences the app writes and how lists are read |
| `tests/receiver` | the computer side (Python) |
| `tests/ui` | the real app driven in a phone-sized browser |

Only made-up patients are used. To run them on a computer with Node and Python:
`npm install playwright`, `npx playwright install chromium`, `node tests/run-all.mjs` (add `--no-ui` to skip the browser part).

## Files that are in the wrong place

Earlier uploads left copies of some files outside their folders. They do no harm to the app, but they are how a wrong
upload hides, so the structure test lists them as a warning. To delete one on GitHub: open the file, click the bin
icon (or the `...` menu → Delete file), **Commit changes**. The copies to delete:

- at the top of the repository: `app.css`, `app.js`, `defaults.js`, `eng.traineddata`, `importers.js`, `index.html`,
  `note.js`, `parsers.js`, `receiver.py`, `store.js`, `sw.js`
- in `app`: `receiver.py`
- in `app/css`: `app.js`, `defaults.js`, `note.js`
- in `app/js`: `app.css`, `index.html`, `receiver.py`, `sw.js`

Do **not** delete `app/sw.js`, `app/index.html`, `app/css/app.css` or anything else in `app/js`.
