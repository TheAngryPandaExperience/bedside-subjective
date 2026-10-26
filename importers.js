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

/**
 * `judge(text)` rates a photo reading as { value, done }: higher value is better, and done means
 * good enough to stop trying other page layouts.
 */
export async function fileToText(file, onProgress = () => {}, judge = null) {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return pdfToText(file, onProgress);
  if (name.endsWith('.docx')) return docxToText(file);
  if (file.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/.test(name)) return imageToText(file, onProgress, judge);
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

async function imageToText(file, onProgress, judge) {
  const bitmap = await createImageBitmap(file);
  const canvas = preprocess(bitmap);
  // Read the photo as rows of a table first (Tesseract page mode 4). If the result looks doubtful,
  // try a single text block (6) and automatic layout (3), and keep the best reading.
  const modes = judge ? [4, 6, 3] : [4];
  let best = null;
  for (let i = 0; i < modes.length; i++) {
    const text = await ocrCanvas(canvas, (p) => onProgress((i + p) / modes.length), modes[i]);
    const verdict = judge ? judge(text) : { value: 0, done: true };
    if (!best || verdict.value > best.verdict.value) best = { text, verdict };
    if (best.verdict.done) break;
  }
  onProgress(1);
  return best.text;
}

/**
 * Clean up a phone photo of a screen before reading it:
 * - darkest colour channel, so blue name links read as dark as black text;
 * - a light blur that wipes out the screen's pixel grid (moire);
 * - divide by the local background brightness, which evens out glare and shadows;
 * - flip light-on-dark (dark mode) screens.
 * On a 20-patient screen photo this took reading from 1 of 20 patients to 19-20 of 20.
 */
function preprocess(bitmap) {
  const scale = Math.min(2, 3200 / bitmap.width);
  const canvas = document.createElement('canvas');
  const w = (canvas.width = Math.round(bitmap.width * scale));
  const h = (canvas.height = Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = Math.min(px[i], px[i + 1], px[i + 2]);
  boxBlur(g, w, h, Math.max(1, Math.round(w / 1600)));
  if (isDarkMode(g, w, h)) for (let j = 0; j < g.length; j++) g[j] = 255 - g[j];
  // Background = local maximum brightness, smoothed.
  const r = Math.max(6, Math.round(Math.max(w, h) * 0.015));
  const tmp = new Float32Array(g.length);
  const bg = new Float32Array(g.length);
  slidingMax(g, tmp, w, h, r, true);
  slidingMax(tmp, bg, w, h, r, false);
  boxBlur(bg, w, h, r);
  const LO = 0.55;
  const HI = 0.92;
  for (let j = 0, i = 0; j < g.length; j++, i += 4) {
    const ratio = g[j] / Math.max(4, bg[j]);
    px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, ((ratio - LO) / (HI - LO)) * 255));
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Light text on a dark page (dark mode). Text is the minority of pixels, so look at which side of the
// typical brightness the outliers fall: darker = dark text on light, brighter = light text on dark.
function isDarkMode(g, w, h) {
  const sample = [];
  for (let y = Math.round(h * 0.2); y < h * 0.8; y += 3) {
    for (let x = Math.round(w * 0.2); x < w * 0.8; x += 3) sample.push(g[y * w + x]);
  }
  const med = [...sample].sort((a, b) => a - b)[sample.length >> 1];
  let up = 0;
  let down = 0;
  for (const v of sample) {
    if (v > med + 25) up++;
    else if (v < med - 25) down++;
  }
  return up > down * 1.5;
}

// Two passes of a separable box blur (close to a Gaussian), in place.
function boxBlur(g, w, h, r) {
  const t = new Float32Array(g.length);
  const d = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += g[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        t[row + x] = acc / d;
        acc += g[row + Math.min(w - 1, x + r + 1)] - g[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += t[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        g[y * w + x] = acc / d;
        acc += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x];
      }
    }
  }
}

// Maximum over a window of 2r+1 along rows (horiz) or columns.
function slidingMax(src, dst, w, h, r, horiz) {
  const n = horiz ? w : h;
  const lines = horiz ? h : w;
  const dq = new Int32Array(n);
  for (let a = 0; a < lines; a++) {
    const base = horiz ? a * w : a;
    const step = horiz ? 1 : w;
    let head = 0;
    let tail = 0;
    for (let i = 0; i < n + r; i++) {
      if (i < n) {
        const v = src[base + i * step];
        while (tail > head && src[base + dq[tail - 1] * step] <= v) tail--;
        dq[tail++] = i;
      }
      const c = i - r;
      if (c < 0) continue;
      while (dq[head] < c - r) head++;
      dst[base + c * step] = src[base + dq[head] * step];
    }
  }
}

let workerP;
let progressCb = () => {};
async function ocrCanvas(canvas, onProgress, psm = 3) {
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
  await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
  const { data } = await worker.recognize(canvas);
  return data.text;
}
