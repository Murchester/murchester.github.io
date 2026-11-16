// Static site builder: content/*.md -> dist/. No runtime JS, no web fonts, CSS inlined.
// Math is typeset here with KaTeX (MathML output) and adjusted for Chromium; macros.tex is the optional math preamble.
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
let cur = '';                                        // file being rendered, so a math problem can name it
const macros = {};                                   // filled from macros.tex below
const mathCache = new Map();

// Chromium implements only the core of MathML, so the few KaTeX features it ignores are rewritten here
// into plain markup that style.css (the "mx" chunk) draws. Every browser then shows the same thing.
const ALPHABETS = {                                  // mathvariant -> first code points of [capitals, smalls, Greek capitals, Greek smalls, digits]
  bold: [0x1D400, 0x1D41A, 0x1D6A8, 0x1D6C2, 0x1D7CE], italic: [0x1D434, 0x1D44E, 0x1D6E2, 0x1D6FC],
  'bold-italic': [0x1D468, 0x1D482, 0x1D71C, 0x1D736], script: [0x1D49C], fraktur: [0x1D504, 0x1D51E],
  'double-struck': [0x1D538, 0x1D552, 0, 0, 0x1D7D8],
};
const LETTERLIKE = {                                 // letters Unicode files under Letterlike Symbols instead
  italic: { h: 0x210E }, script: { B: 0x212C, E: 0x2130, F: 0x2131, H: 0x210B, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211B },
  fraktur: { C: 0x212D, H: 0x210C, I: 0x2111, R: 0x211C, Z: 0x2128 },
  'double-struck': { C: 0x2102, H: 0x210D, N: 0x2115, P: 0x2119, Q: 0x211A, R: 0x211D, Z: 0x2124 },
};
const GREEK_EXTRAS = { 0x2202: 25, 0x3F5: 26, 0x3D1: 27, 0x3F0: 28, 0x3D5: 29, 0x3F1: 30, 0x3D6: 31 };
const SAME_GLYPHS = { 'bold-script': 'script', 'bold-fraktur': 'fraktur' };
const FALLBACK = { 'sans-serif': 'x-sans', 'bold-sans-serif': 'x-sans x-b', 'sans-serif-italic': 'x-sans x-i', 'sans-serif-bold-italic': 'x-sans x-b x-i', monospace: 'x-mono', 'bold-script': 'x-b', 'bold-fraktur': 'x-b' };
const ENCLOSURE = { box: 'x-box', top: 'x-top', bottom: 'x-bottom', left: 'x-left', right: 'x-right', updiagonalstrike: 'x-up', downdiagonalstrike: 'x-down', horizontalstrike: 'x-h' };

function styled(variant, ch) {
  const a = ALPHABETS[variant], cp = ch.codePointAt(0);
  let to = LETTERLIKE[variant]?.[ch] || 0;
  if (!to && a) {
    if (cp >= 65 && cp <= 90) to = a[0] && a[0] + cp - 65;
    else if (cp >= 97 && cp <= 122) to = a[1] && a[1] + cp - 97;
    else if (cp >= 48 && cp <= 57) to = a[4] && a[4] + cp - 48;
    else if (cp >= 0x391 && cp <= 0x3A1) to = a[2] && a[2] + cp - 0x391;
    else if (cp === 0x3F4) to = a[2] && a[2] + 17;
    else if (cp >= 0x3A3 && cp <= 0x3A9) to = a[2] && a[2] + cp - 0x3A3 + 18;
    else if (cp === 0x2207) to = a[2] && a[2] + 25;
    else if (cp >= 0x3B1 && cp <= 0x3C9) to = a[3] && a[3] + cp - 0x3B1;
    else if (cp in GREEK_EXTRAS) to = a[3] && a[3] + GREEK_EXTRAS[cp];
  }
  return to ? String.fromCodePoint(to) : ch;
}

// KaTeX's MathML is plain nested tags (self-closing only for empty ones like <mspace/>, no comments), so a tiny parser is all this needs
const attr = (n, k) => n.a.find(x => x[0] === k)?.[1];
const setAttr = (n, k, v) => { const x = n.a.find(y => y[0] === k); if (x) x[1] = v; else n.a.push([k, v]); };
const delAttr = (n, ...ks) => { n.a = n.a.filter(x => !ks.includes(x[0])); };
const addClass = (n, c) => setAttr(n, 'class', [attr(n, 'class'), c].filter(Boolean).join(' '));
const textOf = n => n.k.map(k => typeof k === 'string' ? k : textOf(k)).join('');
const serialize = ns => ns.map(n => typeof n === 'string' ? n : `<${n.t}${n.a.map(([k, v]) => ` ${k}="${v}"`).join('')}${n.sc ? '/>' : `>${serialize(n.k)}</${n.t}>`}`).join('');

function fixML(n) {
  n.k.forEach(k => typeof k !== 'string' && fixML(k));
  const v = attr(n, 'mathvariant');
  if (v && v !== 'normal' && /^(mi|mn|mtext)$/.test(n.t)) {            // \mathbb, \mathcal, \mathbf, \boldsymbol ...: Chromium ignores mathvariant
    const base = SAME_GLYPHS[v] || v;
    if (ALPHABETS[base]) n.k = n.k.map(k => typeof k === 'string' ? k.replace(/&#?\w+;|[\s\S]/gu, c => c.length > 1 && c[0] === '&' ? c : styled(base, c)) : k);
    if (FALLBACK[v]) addClass(n, FALLBACK[v]);
    delAttr(n, 'mathvariant');
  }
  if ((n.t === 'mover' && attr(n, 'accent') === 'true' || n.t === 'munder' && attr(n, 'accentunder') === 'true')
      && n.k.length === 2 && n.k[1].t === 'mo' && textOf(n.k[1]) === '\u203E') {   // \overline, \underline: a rule that always spans the whole base
    n.a = [['class', n.t === 'mover' ? 'x-over' : 'x-under']]; n.t = 'mrow'; n.k = [n.k[0]];
  } else if (n.t === 'menclose') {                                       // \boxed, \fbox, \cancel, and the frame around |c|c| arrays
    const c = (attr(n, 'notation') || '').split(/\s+/).map(w => ENCLOSURE[w]).filter(Boolean);
    n.t = 'mrow'; n.a = c.length ? [['class', c.join(' ')]] : [];
  } else if (n.t === 'mtable') {                                          // columnalign, \hline and | in arrays: per-cell classes instead of attributes Chromium skips
    const list = k => (attr(n, k) || '').split(/\s+/).filter(Boolean), al = list('columnalign'), cl = list('columnlines'), rl = list('rowlines');
    const at = (a, i) => a[Math.min(i, a.length - 1)];
    const rows = n.k.filter(r => r.t === 'mtr'), cols = Math.max(0, ...rows.map(r => r.k.filter(c => c.t === 'mtd').length));
    rows.forEach((r, i) => r.k.filter(c => c.t === 'mtd').forEach((c, j) => {
      if (at(al, j) === 'left') addClass(c, 'l'); else if (at(al, j) === 'right') addClass(c, 'r');
      if (at(cl, j) === 'solid' && j < cols - 1) addClass(c, 'x-col');
      if (at(rl, i) === 'solid' && i < rows.length - 1) addClass(c, 'x-row');
    }));
    if (al[0] === 'right') addClass(n, 'ag');                             // align, aligned, alignat: columns pair up as right | left
    delAttr(n, 'columnalign', 'columnlines', 'rowlines');
  } else if (n.t === 'mo' && attr(n, 'fence') === 'true') {              // \left| \right|: grow like parentheses do, and sit tight against the content as in TeX
    if (attr(n, 'stretchy') === undefined) { setAttr(n, 'stretchy', 'true'); setAttr(n, 'symmetric', 'true'); }
    if (attr(n, 'lspace') === undefined) { setAttr(n, 'lspace', '0'); setAttr(n, 'rspace', '0'); }
  }
}
function mathFix(html, tex) {
  html = html.replace(/ =(?=")/g, '=');                              // KaTeX writes class ="mtr-glue" with a stray space; quotes in text are always escaped, so this only touches tags
  const root = { k: [] }, stack = [root];
  for (const m of html.matchAll(/<(\/?)([a-z]+)((?:\s[^>]*)?)>|[^<]+/g)) {
    const top = stack[stack.length - 1];
    if (m[2] === undefined) top.k.push(m[0]);
    else if (m[1]) stack.pop();
    else {
      const sc = m[3].endsWith('/'), n = { t: m[2], a: [...m[3].matchAll(/\s([\w:-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]), k: [], sc };
      top.k.push(n);
      if (!sc) stack.push(n);                                            // <mspace width="1em"/> has no children and no closing tag
    }
  }
  if (serialize(root.k) !== html) { warnOnce(`${cur}: math: could not post-process "${tex.trim().slice(0, 36)}", so it is shown as KaTeX wrote it`); return html; }   // safety net: never ship a mangled formula
  root.k.forEach(k => typeof k !== 'string' && fixML(k));
  return serialize(root.k);
}

const toMathML = (tex, display) => {
  const key = (display ? 'D' : 'I') + tex;
  let html = mathCache.get(key);
  if (html === undefined) {
    try {
      html = katex.renderToString(tex, { displayMode: display, output: 'mathml', throwOnError: true, macros: { ...macros },
        strict: (code, msg) => { warnOnce(`${cur}: math: ${msg}`); return 'ignore'; } })
        .replace(/<annotation encoding="application\/x-tex">[\s\S]*?<\/annotation>/, '')
        .replace(/<semantics>([\s\S]*)<\/semantics>/, '$1')
        .replace(/^<span class="katex">([\s\S]*)<\/span>$/, '$1')   // wrapper nothing styles
        .replace(' xmlns="http://www.w3.org/1998/Math/MathML"', '');   // implied by the HTML parser
      html = mathFix(html, tex);
      const symbols = (html.match(/<(mi|mn|mo|mtext)[ >]/g) || []).length;
      if (!display && symbols > 30) warnOnce(`${cur}: inline math "${tex.trim().slice(0, 36)}..." is wide (${symbols} symbols) and will run off narrow screens; $$...$$ scrolls instead`);
    } catch (e) {
      const why = String(e.message).replace(/^KaTeX parse error: /, '').replace(/ at position \d+:[\s\S]*$/, '').trim();
      warn(`${cur}: math error in "${tex.trim().slice(0, 40)}": ${why}`);
      html = `<span class="katex-error" title="${esc(why)}">${esc(tex)}</span>`;
    }
    mathCache.set(key, html);
  }
  return html;
};

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

const md = new MarkdownIt({ html: true, typographer: true, linkify: true }).use(mathPlugin).use(footnote);
md.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });    // only http(s):// becomes a link, so notes.md or a.b stay text

// the typographer would turn "(c)", "(r)" and "(tm)" into symbols; in lists and proofs they are labels, so they stay as typed
const labels = (state, f) => state.tokens.forEach(t => t.type === 'inline' && t.children.forEach(c => c.type === 'text' && (c.content = f(c.content))));
md.core.ruler.before('replacements', 'keep_labels', state => labels(state, s => s.replace(/\((c|r|tm)\)/gi, '($1\u0001)')));
md.core.ruler.after('replacements', 'restore_labels', state => labels(state, s => s.replace(/\u0001/g, '')));

// every heading gets an id, unique within the page: "Examples" twice gives examples and examples-2
md.core.ruler.push('heading_ids', state => {
  const seen = new Set();
  state.tokens.forEach((t, i) => {
    if (t.type !== 'heading_open') return;
    const base = slug(state.tokens[i + 1].content) || 'section';
    let id = base;
    for (let n = 2; seen.has(id); n++) id = `${base}-${n}`;
    seen.add(id);
    t.attrSet('id', id);
  });
});

// ![alt](/pic.png "Caption") alone in a paragraph becomes <figure> with a <figcaption>
md.core.ruler.push('figures', state => {
  const T = state.tokens;
  for (let i = 1; i < T.length - 1; i++) {
    const k = T[i];
    if (k.type !== 'inline' || k.children?.length !== 1 || k.children[0].type !== 'image' || T[i - 1].type !== 'paragraph_open') continue;
    const img = k.children[0], cap = img.attrGet('title');
    if (!cap) continue;
    img.attrs = img.attrs.filter(([name]) => name !== 'title');
    T[i - 1].tag = T[i + 1].tag = 'figure';
    const c = new state.Token('html_inline', '', 0);
    c.content = `<figcaption>${esc(cap)}</figcaption>`;
    k.children.push(c);
  }
});

const DRAFTS = process.env.DRAFTS === '1';                 // npm run dev shows drafts, builds don't
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const t0 = Date.now();
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const slug = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-');
const pad = n => String(n).padStart(2, '0');
const fmt = d => typeof d === 'string' ? d.slice(0, 10) : (d = new Date(d), `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);   // dates in your own time zone
const kb = n => (n / 1024).toFixed(1) + 'K';
const up = url => url.replace(/[^/]+\/$/, '');
const csv = s => (s || '').replace(/^\[|\]$/g, '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const cmp = (a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name);
const yes = v => /^(true|yes|1)$/i.test(v || '');
const warnings = [];
const warn = msg => { warnings.push(msg); console.warn('Warning: ' + msg); };
const noted = new Set();
const warnOnce = msg => { if (!noted.has(msg)) { noted.add(msg); warn(msg); } };
let drafts = 0, newest = 0;                                  // newest = last time any published content file changed
const bump = st => { newest = Math.max(newest, st.mtimeMs); };

// ---- macros.tex works like a LaTeX preamble: \newcommand, \renewcommand, \def, \DeclareMathOperator. Yours win over KaTeX's own ones. ----
if (fs.existsSync('macros.tex')) {
  const run = t => katex.renderToString(t, { macros, globalGroup: true, throwOnError: true, output: 'mathml' });
  const statements = [];
  let stmt = '', depth = 0;
  for (const raw of fs.readFileSync('macros.tex', 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/(^|[^\\])%.*$/, '$1');
    if (!stmt && !line.trim()) continue;
    stmt += line + '\n';
    for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '\\') i++; else if (c === '{') depth++; else if (c === '}') depth--; }
    if (depth <= 0) { statements.push(stmt.trim()); stmt = ''; depth = 0; }
  }
  if (stmt.trim()) statements.push(stmt.trim());
  for (let s of statements) {
    if (/^\\(usepackage|RequirePackage|documentclass)\b/.test(s)) continue;           // pasted preambles are fine; KaTeX already knows amsmath
    s = s.replace(/^\\DeclareMathOperator(\*?)\s*\{\s*(\\[A-Za-z]+)\s*\}\s*\{([\s\S]*)\}$/, '\\newcommand{$2}{\\operatorname$1{$3}}');
    try { run(s); }
    catch (e) {
      const why = String(e.message).replace(/^KaTeX parse error: /, '').replace(/ at position \d+:[\s\S]*$/, '');
      if (/attempting to redefine/.test(why)) { try { run(s.replace(/^\\newcommand/, '\\renewcommand')); continue; } catch (e2) { /* reported below */ } }
      warn(`macros.tex: ${s.replace(/\s+/g, ' ').slice(0, 50)}: ${why}`);
    }
  }
}

// ---- CSS: style.css is split by /*@name*/ markers; a page only gets the chunks it uses ----
const fontHash = crypto.createHash('sha1').update(fs.readFileSync('static/fonts/lm-math.woff2')).digest('hex').slice(0, 8);
const fontUrl = `/fonts/lm-math.${fontHash}.woff2`;          // content-hashed name: cacheable forever
const sheet = fs.readFileSync('style.css', 'utf8').split(/\/\*@(\w+)\*\//);
const chunks = [['core', sheet[0]]];
for (let i = 1; i < sheet.length; i += 2) chunks.push([sheet[i], sheet[i + 1]]);
const wants = {
  math: b => b.includes('<math'), mx: b => /class="(?:[^"]* )?x-/.test(b), code: b => /<(pre|code|kbd)/.test(b), tbl: b => b.includes('class="tbl"'),
  scroll: b => /<pre|class="(tbl|math-block)"/.test(b), dir: b => b.includes('class="dir"'), list: b => b.includes('class="posts"'),
  fn: b => b.includes('class="footnotes"'), toc: b => b.includes('class="toc"'), fig: b => b.includes('<figure'), det: b => b.includes('<details'),
};
const minify = c => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/;}/g, '}').trim();
const cssCache = new Map();
const cssFor = body => {
  const use = chunks.map(([n, c]) => (n === 'core' || !wants[n] || wants[n](body)) ? c : '');
  const key = use.map(c => c ? 1 : 0).join('');
  if (!cssCache.has(key)) cssCache.set(key, minify(use.join('')).replace('/fonts/lm-math.woff2', fontUrl));
  return cssCache.get(key);
};

// Every page carries only the CSS it can use: a selector that needs an element, class or id the page does not contain is dropped
// (an h4 rule on a page without an h4). Anything the check cannot be sure about is kept, so the rendering never changes.
const splitSelectors = s => {
  const parts = []; let depth = 0, quote = '', cur = '';
  for (const c of s) {
    if (quote) { cur += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === ',' && !depth) { parts.push(cur); cur = ''; } else cur += c;
  }
  return [...parts, cur];
};
function prune(css, page) {
  const value = name => [...page.matchAll(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, 'gi'))].map(m => m[1] ?? m[2] ?? m[3]);   // raw HTML may quote however it likes
  const tags = new Set([...page.matchAll(/<([a-z][\w-]*)/gi)].map(m => m[1].toLowerCase()));
  const classes = new Set(value('class').flatMap(v => v.split(/\s+/)));
  const ids = new Set(value('id'));
  const possible = sel => {
    if (sel.includes('\\')) return true;
    let s = sel;
    for (let before; before !== s;) { before = s; s = s.replace(/:[\w-]+\([^()]*\)/g, ''); }   // :is(...), :not(...), :nth-child(...)
    s = s.replace(/\[[^\]]*\]/g, '').replace(/::?[\w-]+/g, '');
    return s.split(/[\s>+~]+/).filter(Boolean).every(compound => {
      const m = compound.match(/^([a-z][\w-]*|\*)?((?:[.#][\w-]+)*)$/i);
      if (!m) return true;
      if (m[1] && m[1] !== '*' && !tags.has(m[1].toLowerCase())) return false;
      return [...m[2].matchAll(/([.#])([\w-]+)/g)].every(([, kind, name]) => (kind === '.' ? classes : ids).has(name));
    });
  };
  let out = '', i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) { out += css.slice(i); break; }
    let depth = 1, j = open + 1, quote = '';
    for (; j < css.length && depth; j++) {
      const c = css[j];
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '{') depth++; else if (c === '}') depth--;
    }
    const head = css.slice(i, open), block = css.slice(open, j);
    if (head.trimStart().startsWith('@')) out += head + block;
    else { const keep = splitSelectors(head).filter(possible); if (keep.length) out += keep.join(',') + block; }
    i = j;
  }
  return out;
}

// ---- markdown extras ----
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
    else if (b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i < b.length - 9;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { r = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; break; }
        i += 2 + b.readUInt16BE(i + 2);
      }
    } else if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const k = b.toString('latin1', 12, 16);
      if (k === 'VP8 ') r = [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
      else if (k === 'VP8L') { const v = b.readUInt32LE(21); r = [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
      else if (k === 'VP8X') r = [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
    } else if (f.endsWith('.svg')) {
      const t = b.toString('utf8', 0, 2048), w = t.match(/<svg[^>]*\swidth="([\d.]+)(?:px)?"/), h = t.match(/<svg[^>]*\sheight="([\d.]+)(?:px)?"/),
        vb = t.match(/viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
      r = w && h ? [+w[1], +h[1]] : vb ? [+vb[1], +vb[2]] : null;
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

const KEYS = new Set(['title', 'date', 'updated', 'description', 'tags', 'toc', 'draft', 'aliases']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function excerpt(tokens) {                                   // first plain paragraph, used when there is no description:
  for (let i = 1; i < tokens.length; i++) {
    const k = tokens[i];
    if (k.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 1].level !== 0 || k.children.some(c => c.type === 'math')) continue;
    const s = k.children.filter(c => c.type === 'text' || c.type === 'code_inline').map(c => c.content).join('').replace(/\s+/g, ' ').trim();
    if (s.length < 20) continue;
    return s.length <= 160 ? s : s.slice(0, 160).replace(/\s+\S*$/, '') + '\u2026';
  }
  return '';
}
function load(file) {
  cur = file;
  try {
    let t = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''), meta = {};
    const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (m) {
      t = t.slice(m[0].length);
      for (const l of m[1].split('\n')) {
        const i = l.indexOf(':');
        if (i < 1) continue;
        const k = l.slice(0, i).trim();
        meta[k] = l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
        if (!KEYS.has(k)) warn(`${file}: unknown front matter key "${k}" (known: ${[...KEYS].join(', ')})`);
      }
      for (const k of ['date', 'updated'])
        if (meta[k] && !(DATE.test(meta[k]) && !isNaN(new Date(meta[k])))) warn(`${file}: ${k} "${meta[k]}" should look like 2026-11-14`);
    }
    const env = {}, tokens = md.parse(t, env);
    const inline = t => md.renderer.renderInline(t.children, md.options, env).replace(/<sup class="footnote-ref">[\s\S]*?<\/sup>|<\/?a\b[^>]*>/g, '');   // heading text as HTML, math included, without links
    const heads = tokens.flatMap((k, i) => k.type === 'heading_open' && /^h[23]$/.test(k.tag) ? [[k.tag, inline(tokens[i + 1]), k.attrGet('id')]] : []);
    return { meta, html: md.renderer.render(tokens, md.options, env), heads, desc: meta.description || excerpt(tokens) };
  } catch (e) { e.message = `${file}: ${e.message}`; throw e; }
}
const toc = heads => heads.length > 2
  ? `<div class="toc"><b>Contents</b><ul>${heads.map(([tag, s, id]) => `<li class="${tag}"><a href="#${id}">${s}</a></li>`).join('')}</ul></div>` : '';

// ---- content tree ----
const tidy = (name, file) => { if (!/^[a-z0-9_-]+$/.test(name)) warn(`${file}: the URL will contain "${name}"; lowercase letters, digits and dashes make nicer addresses`); };
function walk(dir, url) {
  const node = { url, name: path.basename(dir), pages: [], dirs: [], index: null, mtime: fs.statSync(dir).mtime };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^[._]/.test(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { tidy(e.name, f); node.dirs.push(walk(f, `${url}${e.name}/`)); }
    else if (e.name === 'index.md') { node.index = load(f); bump(fs.statSync(f)); }
    else if (e.name.endsWith('.md')) {
      const { meta, html, heads, desc } = load(f), name = e.name.slice(0, -3), st = fs.statSync(f), draft = yes(meta.draft);
      if (draft && !DRAFTS) { drafts++; continue; }
      tidy(name, f);
      bump(st);
      node.pages.push({ name, url: `${url}${name}/`, title: (meta.title || name) + (draft ? ' [draft]' : ''), date: meta.date || '', updated: meta.updated || '',
        desc, tags: csv(meta.tags), aliases: csv(meta.aliases), toc: yes(meta.toc) ? toc(heads) : '', html, size: st.size, mtime: st.mtime });
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
const navFor = url => nav.map(([h, n]) => `<a class="btn" href="${h}"${(h === '/' ? url === '/' : url.startsWith(h)) ? ' aria-current="page"' : ''}>${esc(n)}</a>`).join('');
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
const updated = fmt(newest || Date.now());              // when the content last changed, so unchanged pages stay byte-identical between builds
const icon = ['svg', 'png', 'ico'].map(e => `favicon.${e}`).find(f => fs.existsSync(`static/${f}`));
const iconTag = icon ? `<link rel="icon" href="/${icon}">`
  : `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23000080'/%3E%3Cpath d='M3 9l2-2 2 2 2-2 2 2 2-2' fill='none' stroke='%23ff0' stroke-width='1.5'/%3E%3C/svg%3E">`;
// Chromium prerenders a link on hover, so clicking feels instant (declarative, not JavaScript)
const speculate = '<script type="speculationrules">{"prerender":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/*.*"}}]},"eagerness":"moderate"}]}</script>';

function layout({ title, body, url = '/', desc = '', noindex = false, rel = '' }) {
  const t = esc(SITE.title), full = (title ? esc(title) + ' - ' : '') + t, d = esc(desc || SITE.tagline);
  const font = body.includes('<math') ? `<link rel="preload" href="${fontUrl}" as="font" type="font/woff2" crossorigin>` : '';
  const brand = body.includes('<h1') ? 'div' : 'h1';             // one <h1> per page: the page's own, else the site name
  const seo = noindex ? '<meta name="robots" content="noindex">' : SITE_URL ? `<link rel="canonical" href="${SITE_URL}${url}">` : '';
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#008080"><title>${full}</title><meta name="description" content="${d}"><meta property="og:title" content="${full}"><meta property="og:description" content="${d}">${seo}<link rel="alternate" type="application/rss+xml" title="${t}" href="/feed.xml">${rel}${iconTag}${font}<style>\u0000</style>${speculate}</head><body><a class="skip" href="#main">Skip to content</a><div id="page"><div class="bar"><span>${full}</span><span class="wb" aria-hidden="true"><i>_</i><i>&#9633;</i><i>&times;</i></span></div><div class="inner"><header><${brand} class="site"><a href="/">${t}</a></${brand}><p>${esc(SITE.tagline)}</p></header><div class="cols"><nav aria-label="Menu"><b>Menu</b>${navFor(url)}</nav><main id="main" tabindex="-1">${crumbs(url)}`
    + body
    + `</main></div><footer><hr><p>Last updated ${updated} &bull; <a href="/feed.xml">RSS</a></p></footer></div><div id="status" aria-hidden="true"><span>Done</span><span>${all.length} pages</span></div></div></body></html>`;
  return doc.replace('\u0000', () => prune(cssFor(body), doc));
}

const written = [];
const seenUrls = new Set();
const out = (url, html) => {
  if (seenUrls.has(url)) warn(`two pages produce ${url} (a file and a folder with the same name?); one overwrites the other`);
  seenUrls.add(url);
  const f = path.join('dist', url, 'index.html');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
  written.push([url, html]);
};

fs.rmSync('dist', { recursive: true, force: true });

// an automatic /archive/ (every dated page, by year) once the home page's five latest posts are not everything
const hasArchive = dated.length > 5 && !root.dirs.some(d => d.name === 'archive');

// aliases: in the front matter, keeps an old address working after a page moves (a small redirect page, plus a real 301 for hosts that read _redirects)
const redirects = [];
function redirect(from, to, title) {
  from = '/' + from.replace(/^\/+/, '');
  const file = /\.\w+$/.test(from);
  if (!file) from = from.replace(/\/*$/, '/');
  if (from === to) return warn(`aliases: ${from} is the page's own address`);
  redirects.push([from, to]);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(title)}</title><meta name="robots" content="noindex"><link rel="canonical" href="${SITE_URL}${to}"><meta http-equiv="refresh" content="0;url=${to}"><p>This page has moved to <a href="${to}">${esc(title)}</a>.`;
  if (!file) return out(from, html);
  if (seenUrls.has(from)) warn(`two pages produce ${from}; one overwrites the other`);
  seenUrls.add(from);
  fs.mkdirSync(path.dirname('dist' + from), { recursive: true });
  fs.writeFileSync('dist' + from, html);
}

const more = links => links.filter(Boolean).length ? `<p>${links.filter(Boolean).join(' &middot; ')}</p>` : '';

function emit(n) {
  const where = esc(n.url), desc = n.index?.desc;
  if (n.url === '/') out('/', layout({ title: '', desc, body: (n.index?.html || '') + (dated.length ? `<h2>Latest posts</h2>${list(dated.slice(0, 5))}` : '') + more([hasArchive && '<a href="/archive/">All posts &raquo;</a>', tagMap.size && '<a href="/tags/">Browse by tag &raquo;</a>']) }));
  else out(n.url, layout({ title: label(n), url: n.url, desc, body: (n.index ? n.index.html + `<h2>Index of ${where}</h2>` : `<h1>Index of ${where}</h1>`) + listing(n) }));
  const seq = n.pages.filter(p => p.date);
  for (const p of n.pages) {
    const i = seq.indexOf(p), older = seq[i + 1], newer = seq[i - 1];
    const rel = (older ? `<link rel="prev" href="${older.url}">` : '') + (newer ? `<link rel="next" href="${newer.url}">` : '');
    const nb = (!older && !newer) ? '' : `<hr><p class="pn"><span>${older ? `<a href="${older.url}">&laquo; ${esc(older.title)}</a>` : ''}</span><span>${newer ? `<a href="${newer.url}">${esc(newer.title)} &raquo;</a>` : ''}</span></p>`;
    const tags = p.tags.length ? ` &middot; ${p.tags.map(t => `<a href="/tags/${slug(t)}/">${esc(t)}</a>`).join(', ')}` : '';
    const meta = p.date ? `<p class="meta">Posted <time datetime="${p.date}">${p.date}</time>${p.updated ? ` &middot; Updated <time datetime="${p.updated}">${p.updated}</time>` : ''}${tags}</p>` : '';
    out(p.url, layout({ title: p.title, url: p.url, desc: p.desc, rel, body: `<article><h1>${esc(p.title)}</h1>${meta}${p.toc}${p.html}</article>${nb}` }));
    p.aliases.forEach(a => redirect(a, p.url, p.title));
  }
  csv(n.index?.meta.aliases).forEach(a => redirect(a, n.url, label(n)));
  n.dirs.forEach(emit);
}
emit(root);

if (hasArchive) {
  const years = [...new Set(dated.map(p => p.date.slice(0, 4)))];
  out('/archive/', layout({ title: 'Archive', url: '/archive/', desc: 'Every post, newest first.', body: `<h1>Archive</h1>${years.map(y => `<h2>${y}</h2>${list(dated.filter(p => p.date.startsWith(y)))}`).join('')}` }));
}

if (tagMap.size && !root.dirs.some(d => d.name === 'tags')) {            // /tags/ and /tags/<tag>/ listings
  const tags = [...tagMap].sort(([a], [b]) => a.localeCompare(b));
  out('/tags/', layout({ title: 'Tags', url: '/tags/', body: `<h1>Index of /tags/</h1>${listing({ url: '/tags/', pages: [], dirs: tags.map(([t, ps]) => ({ name: slug(t), url: `/tags/${slug(t)}/`, mtime: ps[0].date || ps[0].mtime })) })}` }));
  for (const [t, ps] of tags) out(`/tags/${slug(t)}/`, layout({ title: `Tag: ${t}`, url: `/tags/${slug(t)}/`, body: `<h1>Index of /tags/${esc(slug(t))}/</h1>${listing({ url: `/tags/${slug(t)}/`, dirs: [], pages: ps.slice().sort(cmp) })}` }));
}
fs.writeFileSync('dist/404.html', layout({ title: 'Not Found', url: '', noindex: true, body: '<h1>404 Not Found</h1><p>The requested URL was not found on this server.</p><p><a href="/">Back to the home page</a></p>' }));

// RSS: full text for readers when SITE_URL is set (relative links become absolute), stable lastBuildDate
const absolute = h => h.replace(/(href|src)="\//g, `$1="${SITE_URL}/`);
const cdata = h => `<![CDATA[${h.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
fs.writeFileSync('dist/feed.xml', `<?xml version="1.0" encoding="utf-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>${esc(SITE.title)}</title><link>${SITE_URL}/</link><description>${esc(SITE.tagline)}</description><language>en</language>${SITE_URL ? `<atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>` : ''}<lastBuildDate>${new Date(newest || Date.now()).toUTCString()}</lastBuildDate>${dated.map(p =>
  `<item><title>${esc(p.title)}</title><link>${SITE_URL}${p.url}</link>${SITE_URL ? `<guid>${SITE_URL}${p.url}</guid>` : ''}<pubDate>${new Date(p.date).toUTCString()}</pubDate>${p.tags.map(t => `<category>${esc(t)}</category>`).join('')}${p.desc ? `<description>${esc(p.desc)}</description>` : ''}${SITE_URL ? `<content:encoded>${cdata(absolute(p.html))}</content:encoded>` : ''}</item>`).join('')}</channel></rss>`);
if (SITE_URL) {
  const dirs = n => n.dirs.flatMap(d => [d, ...dirs(d)]);
  const lastmod = new Map(all.map(p => [p.url, p.updated || p.date]));
  const urls = ['/', ...dirs(root).map(d => d.url), ...all.map(p => p.url), ...(hasArchive ? ['/archive/'] : [])];
  fs.writeFileSync('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u =>
    `<url><loc>${SITE_URL}${u}</loc>${DATE.test(lastmod.get(u) || '') ? `<lastmod>${lastmod.get(u)}</lastmod>` : ''}</url>`).join('')}</urlset>`);
  fs.writeFileSync('dist/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
}

if (fs.existsSync('static')) fs.cpSync('static', 'dist', { recursive: true });
if (redirects.length) fs.writeFileSync('dist/_redirects', redirects.map(([a, b]) => `${a} ${b} 301`).join('\n') + '\n');
fs.renameSync('dist/fonts/lm-math.woff2', 'dist' + fontUrl);
fs.writeFileSync('dist/_headers', '/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n/*\n  Cache-Control: public, max-age=0, must-revalidate\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n');

// warn about internal links, images and #anchors that point nowhere
const exists = f => { try { return fs.statSync(f).isFile() || fs.existsSync(path.join(f, 'index.html')); } catch { return false; } };
const ids = new Map(written.map(([url, html]) => [url, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))]));
let broken = 0;
for (const [url, html] of written) {
  for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)([^"]*)"/g)) {
    const frag = m[2].match(/#(.+)$/)?.[1];
    if (!exists(path.join('dist', decodeURI(m[1])))) { console.warn(`Broken link ${m[1]} on ${url}`); broken++; }
    else if (frag && ids.has(m[1]) && !ids.get(m[1]).has(frag)) { console.warn(`Broken anchor ${m[1]}#${frag} on ${url}`); broken++; }
  }
  for (const m of html.matchAll(/href="#([^"]+)"/g))
    if (!ids.get(url).has(m[1])) { console.warn(`Broken anchor #${m[1]} on ${url}`); broken++; }
}

// npm run release: also write .br and .gz copies for hosts that serve precompressed files
if (process.argv.includes('--compress')) {
  const files = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of files('dist').filter(f => /\.(html|xml|txt|svg)$/.test(f))) {
    const b = fs.readFileSync(f);
    fs.writeFileSync(f + '.br', zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }));
    fs.writeFileSync(f + '.gz', zlib.gzipSync(b, { level: 9 }));
  }
}
let big = ['', 0];
for (const [url, html] of written) {                         // how much the biggest page costs on the wire (about 14K still fits the first round trip)
  const n = zlib.brotliCompressSync(Buffer.from(html), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  if (n > big[1]) big = [url, n];
}
console.log(`Built ${all.length} pages in ${Date.now() - t0} ms${big[1] ? ` (largest: ${big[0]}, ${kb(big[1])} compressed)` : ''}${drafts ? `, ${drafts} draft(s) skipped` : ''}${broken ? `, ${broken} broken link(s)` : ''}${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
