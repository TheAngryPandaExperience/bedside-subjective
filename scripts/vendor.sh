#!/bin/sh
# Copy third-party libraries from node_modules into app/vendor so the app runs fully offline.
# Run after `npm install`. The copied files are committed, so the computer only needs Python.
set -e
cd "$(dirname "$0")/.."
V=app/vendor
rm -rf "$V" && mkdir -p "$V/tesseract/core" "$V/tesseract/lang" "$V/pdfjs" "$V/mammoth"
cp node_modules/tesseract.js/dist/tesseract.min.js node_modules/tesseract.js/dist/worker.min.js "$V/tesseract/"
cp node_modules/tesseract.js-core/tesseract-core-*lstm.wasm.js "$V/tesseract/core/"
cp node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz "$V/tesseract/lang/"
cp node_modules/pdfjs-dist/legacy/build/pdf.min.mjs node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs "$V/pdfjs/"
cp node_modules/mammoth/mammoth.browser.min.js "$V/mammoth/"
du -sh "$V"
