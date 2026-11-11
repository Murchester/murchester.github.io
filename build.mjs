// Static site builder: content/*.md -> dist/. No runtime JS, no web fonts, CSS inlined.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import footnote from 'markdown-it-footnote';
import zlib from 'node:zlib';

const SITE = {
  title: 'Murchester',
  tagline: 'Welcome to my homepage! Best viewed with any browser.',
};

// LaTeX math, rendered to MathML at build time (typeset in Latin Modern Math via style.css).
//   inline : $...$   \(...\)
//   display: $$...$$ (also multi-line)   \[...\]   \begin{equation|align|gather|alignat}[*]...\end{...}
const ENVS = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'alignat', 'alignat*']);
const toMathML = (tex, display) => katex.renderToString(tex, { displayMode: display, output: 'mathml', throwOnError: false });

function mathPlugin(md) {
  md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    const s = state.src, p = state.pos;
    let open, close, display = false;
    if (s.startsWith('\\(', p)) [open, close] = ['\\(', '\\)'];
    else if (s.startsWith('\\[', p)) [open, close, display] = ['\\[', '\\]', true];
    else if (s.startsWith('$$', p)) [open, close, display] = ['$$', '$$', true];
    else if (s[p] === '$') [open, close] = ['$', '$'];
    else return false;
    const start = p + open.length;
    let end = start;
    for (;;) {                                   // find the first unescaped closer
      end = s.indexOf(close, end);
      if (end < 0) return false;
      let n = 0;
      while (s[end - 1 - n] === '\\') n++;
      if (n % 2 === 0) break;
      end += close.length;
    }
    const tex = s.slice(start, end);
    if (!tex.trim()) return false;
    // "$5 and $6" is money, not math: a lone $ needs tight edges and no digit right after
    if (open === '$' && (/^\s|\s$/.test(tex) || /\d/.test(s[end + 1] ?? ''))) return false;
    if (!silent) { const t = state.push('math', '', 0); t.content = tex; t.meta = { display }; }
    state.pos = end + close.length;
    return true;
  });

  md.block.ruler.before('fence', 'math_block', (state, start, endLine, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    let skip = 0, close, m;
    if (first.startsWith('$$')) [skip, close] = [2, '$$'];
    else if (first.startsWith('\\[')) [skip, close] = [2, '\\]'];
    else if ((m = first.match(/^\\begin\{([a-z]+\*?)\}/)) && ENVS.has(m[1])) close = `\\end{${m[1]}}`;
    else return false;
    let tex = '';
    for (let line = start; line < endLine; line++) {
      const text = state.src.slice(state.bMarks[line] + state.tShift[line] + (line === start ? skip : 0), state.eMarks[line]);
      const i = text.indexOf(close);
      if (i >= 0) {
        if (text.slice(i + close.length).trim()) return false;   // text after the closer: leave it to the inline rule
        tex += text.slice(0, close.startsWith('\\end') ? i + close.length : i);
        if (silent) return true;
        state.line = line + 1;
        const t = state.push('math', '', 0);
        t.block = true; t.content = tex.trim(); t.meta = { display: true }; t.map = [start, line + 1];
        return true;
      }
      tex += text + '\n';
    }
    return false;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  md.renderer.rules.math = (tokens, i) => {
    const t = tokens[i], html = toMathML(t.content, t.meta.display);
    return t.block ? `<div class="math-block">${html}</div>\n` : html;
  };
}

const md = new MarkdownIt({ html: true, typographer: true }).use(mathPlugin).use(footnote);

const DRAFTS = process.env.DRAFTS === '1';                 // npm run dev shows drafts, builds don't
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const t0 = Date.now();
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const slug = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
const fmt = d => new Date(d).toISOString().slice(0, 10);
const kb = n => (n / 1024).toFixed(1) + 'K';
const up = url => url.replace(/[^/]+\/$/, '');
const csv = s => (s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const cmp = (a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name);

// ---- CSS: style.css is split by /*@name*/ markers; a page only gets the chunks it uses ----
const fontHash = crypto.createHash('sha1').update(fs.readFileSync('static/fonts/lm-math.woff2')).digest('hex').slice(0, 8);
const fontUrl = `/fonts/lm-math.${fontHash}.woff2`;          // content-hashed name: cacheable forever
const sheet = fs.readFileSync('style.css', 'utf8').split(/\/\*@(\w+)\*\//);
const chunks = [['core', sheet[0]]];
for (let i = 1; i < sheet.length; i += 2) chunks.push([sheet[i], sheet[i + 1]]);
const wants = {
  math: b => b.includes('<math'), code: b => /<(pre|code|kbd)/.test(b), tbl: b => b.includes('class="tbl"'),
  scroll: b => /<pre|class="(tbl|math-block)"/.test(b), dir: b => b.includes('class="dir"'), list: b => b.includes('class="posts"'),
  fn: b => b.includes('class="footnotes"'), toc: b => b.includes('class="toc"'),
};
const minify = c => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/;}/g, '}').trim();
const cssCache = new Map();
const cssFor = body => {
  const use = chunks.map(([n, c]) => (n === 'core' || !wants[n] || wants[n](body)) ? c : '');
  const key = use.map(c => c ? 1 : 0).join('');
  if (!cssCache.has(key)) cssCache.set(key, minify(use.join('')).replace('/fonts/lm-math.woff2', fontUrl));
  return cssCache.get(key);
};

// ---- markdown extras ----
md.renderer.rules.heading_open = (t, i, o, e, self) => { t[i].attrSet('id', slug(t[i + 1].content)); return self.renderToken(t, i, o); };
md.renderer.rules.heading_close = (t, i, o, e, self) =>
  ` <a class="anchor" href="#${t[i - 2].attrGet('id')}" aria-label="Link to this section">#</a>` + self.renderToken(t, i, o);
md.renderer.rules.table_open = () => '<div class="tbl"><table>';
md.renderer.rules.table_close = () => '</table></div>';

// images: lazy, async, and width/height read from the file in static/ (no layout jump while loading)
const dimCache = new Map();
function dims(f) {
  if (dimCache.has(f)) return dimCache.get(f);
  let r = null;
  try {
    const b = fs.readFileSync(f);
    if (b.readUInt32BE(0) === 0x89504e47) r = [b.readUInt32BE(16), b.readUInt32BE(20)];
    else if (b.toString('latin1', 0, 3) === 'GIF') r = [b.readUInt16LE(6), b.readUInt16LE(8)];
    else if (b[0] === 0xff && b[1] === 0xd8)
      for (let i = 2; i < b.length - 9;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { r = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; break; }
        i += 2 + b.readUInt16BE(i + 2);
      }
  } catch { /* not a local image */ }
  dimCache.set(f, r);
  return r;
}
const image = md.renderer.rules.image;
md.renderer.rules.image = (t, i, o, e, self) => {
  const a = t[i], src = a.attrGet('src') || '';
  a.attrSet('loading', 'lazy'); a.attrSet('decoding', 'async');
  const d = src.startsWith('/') && dims(path.join('static', decodeURI(src.split(/[?#]/)[0])));
  if (d) { a.attrSet('width', d[0]); a.attrSet('height', d[1]); }
  return image(t, i, o, e, self);
};

function load(file) {
  let t = fs.readFileSync(file, 'utf8'), meta = {};
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    t = t.slice(m[0].length);
    for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  }
  const env = {}, tokens = md.parse(t, env);
  const heads = tokens.flatMap((k, i) => k.type === 'heading_open' && /^h[23]$/.test(k.tag) ? [[k.tag, tokens[i + 1].content]] : []);
  return { meta, html: md.renderer.render(tokens, md.options, env), heads };
}
const toc = heads => heads.length > 2
  ? `<div class="toc"><b>Contents</b><ul>${heads.map(([tag, s]) => `<li class="${tag}"><a href="#${slug(s)}">${esc(s.replace(/[$`*_]/g, ''))}</a></li>`).join('')}</ul></div>` : '';

// ---- content tree ----
function walk(dir, url) {
  const node = { url, name: path.basename(dir), pages: [], dirs: [], index: null, mtime: fs.statSync(dir).mtime };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^[._]/.test(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) node.dirs.push(walk(f, `${url}${e.name}/`));
    else if (e.name === 'index.md') node.index = load(f);
    else if (e.name.endsWith('.md')) {
      const { meta, html, heads } = load(f), name = e.name.slice(0, -3), st = fs.statSync(f), draft = meta.draft === 'true';
      if (draft && !DRAFTS) continue;
      node.pages.push({ name, url: `${url}${name}/`, title: (meta.title || name) + (draft ? ' [draft]' : ''), date: meta.date || '', updated: meta.updated || '',
        desc: meta.description || '', tags: csv(meta.tags), toc: meta.toc === 'true' ? toc(heads) : '', html, size: st.size, mtime: st.mtime });
    }
  }
  node.pages.sort(cmp);
  node.dirs.sort((a, b) => a.name.localeCompare(b.name));
  return node;
}

const root = walk('content', '/');
const flat = n => [...n.pages, ...n.dirs.flatMap(flat)];
const all = flat(root);
const dated = all.filter(p => p.date).sort(cmp);
const label = n => n.index?.meta.title || n.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const nav = [['/', 'Home'], ...root.dirs.map(d => [d.url, label(d)]), ...root.pages.filter(p => !p.date).map(p => [p.url, p.title])];
const navHtml = nav.map(([h, n]) => `<a class="btn" href="${h}">${esc(n)}</a>`).join('');
const tagMap = new Map();
for (const p of all) for (const t of p.tags) (tagMap.get(t) || tagMap.set(t, []).get(t)).push(p);

const list = ps => `<ul class="posts">${ps.map(p =>
  `<li><tt><time datetime="${p.date}">${p.date}</time></tt> <a href="${p.url}">${esc(p.title)}</a>${Date.now() - new Date(p.date) < 30 * 864e5 ? ' <b class="new">NEW!</b>' : ''}</li>`).join('')}</ul>`;

function listing(n) {
  const rows = [
    ...(n.url !== '/' ? [['[DIR]', up(n.url), 'Parent Directory', '', '-']] : []),
    ...n.dirs.map(d => ['[DIR]', d.url, d.name + '/', fmt(d.mtime), '-']),
    ...n.pages.map(p => ['[TXT]', p.url, p.title, p.date || fmt(p.mtime), kb(p.size)]),
  ];
  return `<table class="dir"><tr><th></th><th>Name</th><th>Date</th><th>Size</th></tr>${rows.map(([i, h, nm, d, s]) =>
    `<tr><td>${i}</td><td><a href="${h}">${esc(nm)}</a></td><td>${d}</td><td>${s}</td></tr>`).join('')}</table>`;
}

const crumbs = url => {
  const segs = url.split('/').filter(Boolean);
  return segs.length ? `<p class="crumbs">You are here: <a href="/">Home</a>${segs.map((s, i) =>
    ` &raquo; ${i < segs.length - 1 ? `<a href="/${segs.slice(0, i + 1).join('/')}/">${esc(s)}</a>` : esc(s)}`).join('')}</p>` : '';
};

// ---- page shell ----
const updated = fmt(Date.now());
const icon = ['svg', 'png', 'ico'].map(e => `favicon.${e}`).find(f => fs.existsSync(`static/${f}`));
const iconTag = icon ? `<link rel="icon" href="/${icon}">`
  : `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23000080'/%3E%3Cpath d='M3 9l2-2 2 2 2-2 2 2 2-2' fill='none' stroke='%23ff0' stroke-width='1.5'/%3E%3C/svg%3E">`;
// Chromium prerenders a link on hover, so clicking feels instant (declarative, not JavaScript)
const speculate = '<script type="speculationrules">{"prerender":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/feed.xml"}}]},"eagerness":"moderate"}]}</script>';

function layout({ title, body, url = '/', desc = '', noindex = false }) {
  const t = esc(SITE.title), full = (title ? esc(title) + ' - ' : '') + t, d = esc(desc || SITE.tagline);
  const font = body.includes('<math') ? `<link rel="preload" href="${fontUrl}" as="font" type="font/woff2" crossorigin>` : '';
  const seo = noindex ? '<meta name="robots" content="noindex">' : SITE_URL ? `<link rel="canonical" href="${SITE_URL}${url}">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light"><meta name="theme-color" content="#008080"><title>${full}</title><meta name="description" content="${d}"><meta property="og:title" content="${full}"><meta property="og:description" content="${d}">${seo}<link rel="alternate" type="application/rss+xml" href="/feed.xml">${iconTag}${font}<style>${cssFor(body)}</style>${speculate}</head><body><a class="skip" href="#main">Skip to content</a><div id="page"><div class="bar"><span>${full}</span><span class="wb" aria-hidden="true"><i>_</i><i>&#9633;</i><i>&times;</i></span></div><div class="inner"><header><h1><a href="/">${t}</a></h1><p>${esc(SITE.tagline)}</p></header><div class="cols"><nav><b>Menu</b>${navHtml}</nav><main id="main">${crumbs(url)}`
    + body
    + `</main></div><footer><hr><p>Last updated ${updated} &bull; <a href="/feed.xml">RSS</a></p></footer></div><div id="status"><span>Done</span><span>${all.length} pages</span></div></div></body></html>`;
}

const written = [];
const out = (url, html) => {
  const f = path.join('dist', url, 'index.html');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
  written.push([url, html]);
};

fs.rmSync('dist', { recursive: true, force: true });

function emit(n) {
  const where = esc(n.url), desc = n.index?.meta.description;
  if (n.url === '/') out('/', layout({ title: '', desc, body: (n.index?.html || '') + (dated.length ? `<h2>Latest posts</h2>${list(dated.slice(0, 5))}` : '') + (tagMap.size ? '<p><a href="/tags/">Browse by tag &raquo;</a></p>' : '') }));
  else out(n.url, layout({ title: label(n), url: n.url, desc, body: (n.index ? n.index.html + `<h2>Index of ${where}</h2>` : `<h1>Index of ${where}</h1>`) + listing(n) }));
  const seq = n.pages.filter(p => p.date);
  for (const p of n.pages) {
    const i = seq.indexOf(p), older = seq[i + 1], newer = seq[i - 1];
    const nb = (!older && !newer) ? '' : `<hr><p class="pn"><span>${older ? `<a href="${older.url}">&laquo; ${esc(older.title)}</a>` : ''}</span><span>${newer ? `<a href="${newer.url}">${esc(newer.title)} &raquo;</a>` : ''}</span></p>`;
    const tags = p.tags.length ? ` &middot; ${p.tags.map(t => `<a href="/tags/${slug(t)}/">${esc(t)}</a>`).join(', ')}` : '';
    const meta = p.date ? `<p class="meta">Posted <time datetime="${p.date}">${p.date}</time>${p.updated ? ` &middot; Updated <time datetime="${p.updated}">${p.updated}</time>` : ''}${tags}</p>` : '';
    out(p.url, layout({ title: p.title, url: p.url, desc: p.desc, body: `<article><h1>${esc(p.title)}</h1>${meta}${p.toc}${p.html}</article>${nb}` }));
  }
  n.dirs.forEach(emit);
}
emit(root);

if (tagMap.size && !root.dirs.some(d => d.name === 'tags')) {            // /tags/ and /tags/<tag>/ listings
  const tags = [...tagMap].sort(([a], [b]) => a.localeCompare(b));
  out('/tags/', layout({ title: 'Tags', url: '/tags/', body: `<h1>Index of /tags/</h1>${listing({ url: '/tags/', pages: [], dirs: tags.map(([t, ps]) => ({ name: slug(t), url: `/tags/${slug(t)}/`, mtime: ps[0].date || ps[0].mtime })) })}` }));
  for (const [t, ps] of tags) out(`/tags/${slug(t)}/`, layout({ title: `Tag: ${t}`, url: `/tags/${slug(t)}/`, body: `<h1>Index of /tags/${esc(slug(t))}/</h1>${listing({ url: `/tags/${slug(t)}/`, dirs: [], pages: ps.slice().sort(cmp) })}` }));
}
fs.writeFileSync('dist/404.html', layout({ title: 'Not Found', noindex: true, body: '<h1>404 Not Found</h1><p>The requested URL was not found on this server.</p><p><a href="/">Back to the home page</a></p>' }));

fs.writeFileSync('dist/feed.xml', `<?xml version="1.0"?><rss version="2.0"><channel><title>${esc(SITE.title)}</title><link>${SITE_URL}/</link><description>${esc(SITE.tagline)}</description><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${dated.map(p =>
  `<item><title>${esc(p.title)}</title><link>${SITE_URL}${p.url}</link>${SITE_URL ? `<guid>${SITE_URL}${p.url}</guid>` : ''}<pubDate>${new Date(p.date).toUTCString()}</pubDate>${p.desc ? `<description>${esc(p.desc)}</description>` : ''}</item>`).join('')}</channel></rss>`);
if (SITE_URL) {
  fs.writeFileSync('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', ...all.map(p => p.url)].map(u => `<url><loc>${SITE_URL}${u}</loc></url>`).join('')}</urlset>`);
  fs.writeFileSync('dist/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
}

if (fs.existsSync('static')) fs.cpSync('static', 'dist', { recursive: true });
fs.renameSync('dist/fonts/lm-math.woff2', 'dist' + fontUrl);
fs.writeFileSync('dist/_headers', '/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n/*\n  Cache-Control: public, max-age=0, must-revalidate\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n');

// warn about internal links and images that point nowhere
const exists = f => { try { return fs.statSync(f).isFile() || fs.existsSync(path.join(f, 'index.html')); } catch { return false; } };
let broken = 0;
for (const [url, html] of written)
  for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g))
    if (!exists(path.join('dist', decodeURI(m[1])))) { console.warn(`Broken link ${m[1]} on ${url}`); broken++; }

// npm run release: also write .br and .gz copies for hosts that serve precompressed files
if (process.argv.includes('--compress')) {
  const files = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of files('dist').filter(f => /\.(html|xml|txt|svg)$/.test(f))) {
    const b = fs.readFileSync(f);
    fs.writeFileSync(f + '.br', zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
    fs.writeFileSync(f + '.gz', zlib.gzipSync(b, { level: 9 }));
  }
}
console.log(`Built ${all.length} pages in ${Date.now() - t0} ms${broken ? `, ${broken} broken link(s)` : ''}`);
