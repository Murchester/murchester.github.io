// Dev server (drafts are visible here): builds, serves dist/ at http://localhost:3000 and rebuilds when you save a file (refresh the tab to see it).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const build = () => spawnSync(process.execPath, ['build.mjs'], { stdio: 'inherit', env: { ...process.env, DRAFTS: '1' } });
build();
let timer;
for (const w of ['content', 'static', 'style.css', 'build.mjs'])
  try { fs.watch(w, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(build, 150); }); } catch { /* ignore */ }

const root = path.resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.xml': 'application/xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': types['.html'] }); return res.end(fs.existsSync(root + '/404.html') ? fs.readFileSync(root + '/404.html') : 'Not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(process.env.PORT || 3000, () => console.log(`Serving http://localhost:${process.env.PORT || 3000}`));
