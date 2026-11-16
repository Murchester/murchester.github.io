// Dev server (drafts are visible here): builds, serves dist/ at http://localhost:3000 and reloads open tabs after every rebuild.
// A failed build shows its error across the top of the open tab and keeps serving the last good version.
// Nothing here ends up in the real site: the reload script is added to pages only while serving, and prerendering is switched off.
//   npm run dev -- --open    opens the browser for you
//   npm run dev -- --lan     also serves on your network, e.g. to look at it on a phone (drafts become visible to others on that network)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const HOST = process.env.HOST || (args.includes('--lan') ? '0.0.0.0' : '127.0.0.1');   // this computer only, unless you ask
const FIXED_PORT = Boolean(process.env.PORT);
const root = path.resolve('dist');
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.zip': 'application/zip',
};
const OVERLAY = 'position:fixed;z-index:99999;left:0;right:0;top:0;max-height:60vh;overflow:auto;box-sizing:border-box;padding:12px 16px;background:#a00;color:#fff;font:13px/1.45 monospace;white-space:pre-wrap';
const RELOAD = `<script>(()=>{const go=()=>{new EventSource("/__reload").onmessage=m=>{const d=JSON.parse(m.data);if(!d.error)return location.reload();let o=document.getElementById("__err");if(!o){o=document.body.appendChild(document.createElement("div"));o.id="__err";o.style.cssText="${OVERLAY}"}o.textContent="Build failed (the last good version is still shown)\\n\\n"+d.error}};document.prerendering?addEventListener("prerenderingchange",go,{once:true}):go()})()</script>`;

const clients = new Set();
const send = msg => { for (const c of clients) c.write(`data: ${JSON.stringify(msg)}\n\n`); };
const brief = t => (t.match(/^\w*Error: [\s\S]*?(?=\n\s+at |\nNode\.js|$)/m)?.[0] || t).trim().slice(-1500);   // the message, without the stack trace

let building = null, queued = false;
function build() {                                   // one build at a time; saves during a build queue exactly one more
  if (building) { queued = true; return; }
  building = new Promise(done => {
    const p = spawn(process.execPath, ['build.mjs'], { stdio: ['ignore', 'inherit', 'pipe'], env: { ...process.env, DRAFTS: '1' } });
    let err = '';
    p.stderr.on('data', d => { process.stderr.write(d); err += d; });
    p.on('close', code => {
      building = null;
      if (code === 0) send({ reload: true });
      else { console.error('Build failed: fix the error above and save again (the last good version is still served).'); send({ error: brief(err) }); }
      done();
      if (queued) { queued = false; build(); }
    });
  });
}

build();
let timer;
const rebuild = () => { clearTimeout(timer); timer = setTimeout(build, 120); };
for (const w of ['content', 'static'])
  try { fs.watch(w, { recursive: true }, rebuild); }
  catch { console.warn(`Not watching ${w} (restart npm run dev after changing it)`); }
fs.watch('.', (_, name) => { if (['style.css', 'build.mjs', 'macros.tex'].includes(name)) rebuild(); });   // watching the folder survives editors that replace files when saving

const page = buf => buf.toString('utf8').replace(/<script type="speculationrules">[\s\S]*?<\/script>/, '').replace('</body>', RELOAD + '</body>');

const server = http.createServer(async (req, res) => {
  if (req.url === '/__reload') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 500\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  while (building) await building;                   // never serve a half-written dist/
  let p;
  try { p = path.join(root, decodeURIComponent(req.url.split(/[?#]/)[0])); } catch { res.writeHead(400); return res.end(); }
  if (p !== root && !p.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    const missing = err || !fs.statSync(p).isFile();
    if (missing) { p = path.join(root, '404.html'); data = fs.existsSync(p) ? fs.readFileSync(p) : Buffer.from('Not found'); }
    const type = types[path.extname(p)] || 'application/octet-stream';
    res.writeHead(missing ? 404 : 200, { 'content-type': missing ? types['.html'] : type, 'cache-control': 'no-store' });
    res.end(type.startsWith('text/html') ? page(data) : data);
  });
});

const first = Number(process.env.PORT) || 3000;
let attempt = 0;
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && !FIXED_PORT && attempt < 10) return server.listen(first + ++attempt, HOST);   // 3000 busy: quietly try 3001, 3002 ...
  console.error(e.code === 'EADDRINUSE' ? `Port ${first + attempt} is busy. Try: PORT=3001 npm run dev` : e.message);
  process.exit(1);
});
server.on('listening', () => {
  const { port } = server.address(), url = `http://localhost:${port}`;
  console.log(`Serving ${url}  (tabs reload by themselves after each rebuild)`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    const mine = Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal);
    for (const i of mine) console.log(`On your network: http://${i.address}:${port}  (drafts are visible to anyone on this network)`);
  }
  if (args.includes('--open')) {
    const [cmd, ...a] = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
    spawn(cmd, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
});
server.listen(first, HOST);
