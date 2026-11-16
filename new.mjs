// Create content. Usage:
//   npm run new                                                       (asks you)
//   npm run new -- post "My title" [folder] [--draft] [--tags a,b] [--toc]   -> content/<folder or posts>/my-title.md
//   npm run new -- page about/credits                                 -> content/about/credits.md
//   npm run new -- folder notes/math                                  -> content/notes/math/index.md
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const argv = process.argv.slice(2);
let draft = argv.includes('--draft');
const toc = argv.includes('--toc');
const ti = argv.findIndex(a => a === '--tags' || a.startsWith('--tags='));
let tags = ti < 0 ? '' : argv[ti].includes('=') ? argv[ti].split('=')[1] : argv[ti + 1] || '';
let [kind, name, where] = argv.filter((a, i) => !a.startsWith('--') && !(i && argv[i - 1] === '--tags'));
if (!kind || !name) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  kind ||= (await rl.question('Create a post, page or folder? ')).trim();
  name ||= (await rl.question('Title or path: ')).trim();
  if (kind.toLowerCase() === 'post') {
    const folders = fs.existsSync('content') ? fs.readdirSync('content', { withFileTypes: true }).filter(d => d.isDirectory() && !/^[_.]/.test(d.name)).map(d => d.name) : [];
    where ||= (await rl.question(`Folder (Enter for posts${folders.length ? `; yours: ${folders.join(', ')}` : ''}): `)).trim();
    tags ||= (await rl.question('Tags, separated by commas (Enter for none): ')).trim();
    draft ||= /^y/i.test((await rl.question('Keep it as a draft for now? (y/N) ')).trim());
  }
  rl.close();
}
kind = (kind || '').toLowerCase();
const slug = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s/-]/g, '').trim().replace(/\s+/g, '-').replace(/-{2,}/g, '-');
const title = s => s.split('/').pop().replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const now = new Date(), pad = n => String(n).padStart(2, '0');
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;   // your own calendar day, not UTC's
if (['post', 'page', 'folder'].includes(kind) && !slug(name).split('/').pop()) { console.error('That name has no letters or digits to build a file name from.'); process.exit(1); }
const front = (...lines) => `---\n${lines.filter(Boolean).join('\n')}\n---\n`;
const tagLine = tags.split(',').map(t => t.trim()).filter(Boolean).join(', ');
let file, body;
if (kind === 'folder') { file = path.join('content', slug(name), 'index.md'); body = front(`title: ${title(slug(name))}`) + 'About this folder.\n'; }
else if (kind === 'post') { file = path.join('content', slug(where || 'posts'), slug(name) + '.md'); body = front(`title: ${name}`, `date: ${today}`, tagLine && `tags: ${tagLine}`, toc && 'toc: true', draft && 'draft: true') + 'Write here.\n'; }
else if (kind === 'page') { file = path.join('content', slug(name) + '.md'); body = front(`title: ${title(slug(name))}`) + 'Write here.\n'; }
else { console.error('Usage: npm run new -- post|page|folder <name>'); process.exit(1); }
if (fs.existsSync(file)) { console.error('Already exists: ' + file); process.exit(1); }
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, body);
const url = '/' + path.relative('content', file).split(path.sep).join('/').replace(/\.md$/, '').replace(/(^|\/)index$/, '') + '/';
console.log(`Created ${file}  ->  ${url.replace('//', '/')}${draft ? '\n(draft: visible in npm run dev, left out of builds until you remove the draft line)' : ''}`);
