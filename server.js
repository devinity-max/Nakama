/**
 * server.js — NAKAMA Production-Grade Static & API Server
 * ========================================================
 * High-performance, zero-dependency Node.js server.
 * Serves the portfolio website and routes /api/contact requests.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ── 1. LOAD LOCAL .ENV ────────────────────────────────────────────────────────
const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  try {
    const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch (e) {
    console.warn('[SERVER] Could not parse .env:', e.message);
  }
}

const contactHandler = require('./api/contact');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // 1. API Route: /api/contact
  if (pathname === '/api/contact' || pathname === '/api/contact/') {
    try {
      await contactHandler(req, res);
    } catch (err) {
      console.error('[SERVER] Contact API error:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: 'Internal server error.' }));
      }
    }
    return;
  }

  // 2. Static File Resolution
  let filePath;
  if (pathname === '/' || pathname === '') {
    // Check index.html first, fallback to original HTML file
    const indexFile = path.join(ROOT_DIR, 'index.html');
    if (fs.existsSync(indexFile)) {
      filePath = indexFile;
    } else {
      const altFile = fs.readdirSync(ROOT_DIR).find(f => f.endsWith('.html') && !f.includes('bak') && !f.includes('pre'));
      filePath = path.join(ROOT_DIR, altFile || 'index.html');
    }
  } else {
    filePath = path.join(ROOT_DIR, pathname);
  }

  // Path Traversal Security Check
  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(ROOT_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  // Check file existence
  fs.stat(normalizedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // 404 Not Found
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>404 Not Found — NAKAMA</title><style>body{background:#0a0a0a;color:#ece8df;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}a{color:#d1182f;text-decoration:none;}</style></head><body><div style="text-align:center;"><h1>404</h1><p>Page Not Found</p><p><a href="/">Return to NAKAMA &rarr;</a></p></div></body></html>`);
      return;
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Security Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Type', contentType);

    // Range Request Support for Media
    const range = req.headers.range;
    if (range && stats.size > 0) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;

      if (start >= stats.size || end >= stats.size || start > end) {
        res.statusCode = 416; // Range Not Satisfiable
        res.setHeader('Content-Range', `bytes */${stats.size}`);
        res.end();
        return;
      }

      res.statusCode = 206; // Partial Content
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', (end - start) + 1);

      const stream = fs.createReadStream(normalizedPath, { start, end });
      stream.pipe(res);
    } else {
      res.statusCode = 200;
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Accept-Ranges', 'bytes');
      const stream = fs.createReadStream(normalizedPath);
      stream.pipe(res);
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[NAKAMA] Production server listening on http://localhost:${PORT}`);
    console.log(`[NAKAMA] Endpoint POST /api/contact active`);
  });
}

module.exports = server;
