// Create content. Usage:
//   npm run new                          (asks you)
//   npm run new -- post "My title" [folder] [--draft]   -> content/<folder or posts>/my-title.md
//   npm run new -- page about/credits         -> content/about/credits.md
//   npm run new -- folder notes/math          -> content/notes/math/index.md
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const draft = process.argv.includes('--draft');
let [kind, name, where] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!kind || !name) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  kind ||= (await rl.question('Create a post, page or folder? ')).trim();
  name ||= (await rl.question('Title or path: ')).trim();
  if (kind === 'post') where ||= (await rl.question('Folder (Enter for posts): ')).trim();
  rl.close();
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9\s/-]/g, '').trim().replace(/\s+/g, '-');
const title = s => s.split('/').pop().replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const today = new Date().toISOString().slice(0, 10);
let file, body;
if (kind === 'folder') { file = path.join('content', slug(name), 'index.md'); body = `---\ntitle: ${title(slug(name))}\n---\nAbout this folder.\n`; }
else if (kind === 'post') { file = path.join('content', slug(where || 'posts'), slug(name) + '.md'); body = `---\ntitle: ${name}\ndate: ${today}\n${draft ? 'draft: true\n' : ''}---\nWrite here.\n`; }
else if (kind === 'page') { file = path.join('content', slug(name) + '.md'); body = `---\ntitle: ${title(slug(name))}\n---\nWrite here.\n`; }
else { console.error('Usage: npm run new -- post|page|folder <name>'); process.exit(1); }
if (fs.existsSync(file)) { console.error('Already exists: ' + file); process.exit(1); }
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, body);
console.log('Created ' + file);
