// Test helper: the app's files, never cached, on 127.0.0.1:8765. Started by tests/run-all.mjs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(APP, p);
    if (!file.startsWith(APP)) throw new Error('outside the app folder');
    const body = await readFile(file);            // read first: a missing file must answer 404, not break the server
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
}).listen(8765, '127.0.0.1');
