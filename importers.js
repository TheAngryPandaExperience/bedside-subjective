// Turn an uploaded file (PDF, Word, image, text) into plain text, entirely on the device.
// Libraries are loaded from app/vendor only when first needed.

const VENDOR = new URL('../vendor/', import.meta.url).href;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

export async function fileToText(file, onProgress = () => {}) {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return pdfToText(file, onProgress);
  if (name.endsWith('.docx')) return docxToText(file);
  if (file.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/.test(name)) return imageToText(file, onProgress);
  return file.text();
}

async function pdfToText(file, onProgress) {
  const pdfjs = await import(`${VENDOR}pdfjs/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}pdfjs/pdf.worker.min.mjs`;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(itemsToLines(content.items));
    onProgress(i / doc.numPages);
  }
  const text = pages.join('\n');
  // A scanned PDF has no text layer: render pages to images and OCR them instead.
  if (text.replace(/\s/g, '').length < 20) return scannedPdfToText(doc, onProgress);
  return text;
}

// Rebuild lines from positioned text items (same baseline = same line).
function itemsToLines(items) {
  const rows = new Map();
  for (const it of items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5] / 3) * 3;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x: it.transform[4], s: it.str });
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, r]) => r.sort((a, b) => a.x - b.x).map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim())
    .join('\n');
}

async function scannedPdfToText(doc, onProgress) {
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    out.push(await ocrCanvas(canvas, (p) => onProgress((i - 1 + p) / doc.numPages)));
  }
  return out.join('\n');
}

async function docxToText(file) {
  if (!window.mammoth) await loadScript(`${VENDOR}mammoth/mammoth.browser.min.js`);
  const { value } = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

async function imageToText(file, onProgress) {
  const bitmap = await createImageBitmap(file);
  return ocrCanvas(preprocess(bitmap), onProgress);
}

/**
 * Grayscale, enlarge and stretch contrast. On the sample roster photo this took
 * OCR from 7 of 9 correct MRNs to 9 of 9.
 */
function preprocess(bitmap) {
  const scale = Math.min(2, 3200 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    px[i] = g;
    hist[g | 0]++;
  }
  // Stretch between the 1st and 99th percentile.
  const total = px.length / 4;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.01; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.01; hi--);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let workerP;
let progressCb = () => {};
async function ocrCanvas(canvas, onProgress) {
  progressCb = onProgress;
  if (!window.Tesseract) await loadScript(`${VENDOR}tesseract/tesseract.min.js`);
  workerP ??= window.Tesseract.createWorker('eng', 1, {
    workerPath: `${VENDOR}tesseract/worker.min.js`,
    corePath: `${VENDOR}tesseract/core`,
    langPath: `${VENDOR}tesseract/lang`,
    gzip: true,
    logger: (m) => m.status === 'recognizing text' && progressCb(m.progress),
  });
  const worker = await workerP;
  const { data } = await worker.recognize(canvas);
  return data.text;
}
