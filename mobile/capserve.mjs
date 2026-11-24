// A local server that behaves like Capacitor's own (Android WebViewLocalServer / iOS scheme handler) for the release
// bundle: a path that is not a file and has no extension gets the root index.html (single-page-app fallback). Used to
// test build/release in a browser the way the app will load it:  node capserve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'build/release');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.bin': 'application/octet-stream', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    if (path.extname(p)) { res.writeHead(404); return res.end(); }
    f = path.join(ROOT, 'index.html');   // what Capacitor does: no directory index, root index.html instead
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(+(process.argv[2] || 8091));
