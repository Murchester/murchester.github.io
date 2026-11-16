# My homepage

## Commands
- `npm install` once, then `npm run dev`: builds, serves http://localhost:3000, rebuilds on every save and reloads the open tab by itself. Drafts are visible here. A failed build shows its error across the top of the tab and keeps serving the last good version. It serves this computer only; `npm run dev -- --lan` also serves your network (to try it on a phone; drafts are then visible to others on it), and `-- --open` opens the browser. If 3000 is busy it takes the next free port (or set `PORT=3001`).
- `npm run new` asks what to make. Or: `npm run new -- post "My title" [folder] [--draft] [--tags a,b] [--toc]`, `npm run new -- page about/credits`, `npm run new -- folder notes/math`.
- `npm run build` writes the site to `dist/`, and warns about broken internal links, images and `#anchors`, unknown front matter keys, malformed dates and untidy file names. `npm run release` also writes `.br` and `.gz` copies for hosts that serve precompressed files.
- Set `SITE_URL=https://you.example` when building to get absolute RSS links (the feed then carries each post's full text), `sitemap.xml`, `robots.txt` and canonical tags.

## Content
- `content/` is the site. Folders become sections with an automatic "Index of /folder/" listing (add an `index.md` for an intro) and appear in the menu, with the current section drawn pressed.
- A `.md` file is a page. Front matter: `title:`, `date:` (`2026-11-14`, makes it a post), `updated:`, `description:` (otherwise the first paragraph is used), `tags: a, b` (gives /tags/ pages), `toc: true` (contents box), `draft: true` (hidden from builds), `aliases: /old/address/, /other/` (keeps an old address working after you move or rename a page: a small redirect page, plus a real 301 in `dist/_redirects` for hosts that read it). Names starting with `_` or `.` are ignored. Quotes around values are optional.
- Footnotes: `text[^1]` and `[^1]: the note`. Images and files go in `static/` (local images get width and height automatically). `![alt](/pic.png "Caption")` on its own line becomes a figure with a caption. Put `favicon.svg`, `.png` or `.ico` in `static/` to replace the built-in icon.
- Bare `https://...` addresses become links. Raw HTML works, for example `<details><summary>Proof</summary> ... </details>` for a collapsible block that needs no script.
- Every heading gets an `#anchor`; repeated headings are numbered (`examples`, `examples-2`).
- Once there are more than five dated pages, the home page links to an automatic `/archive/` listing every one of them by year (unless you have a folder of that name).

## Math
- Inline: `$a^2$` or `\(a^2\)`. Display: `$$...$$`, `\[...\]`, or `\begin{equation|align|gather|alignat}`.
- `\$` is a literal dollar sign. "$5 and $6" and code blocks are left alone.
- Typeset in Latin Modern Math (`static/fonts/lm-math.woff2`, GUST Font License), loaded only on pages with math.
- `macros.tex` in the project folder works like a LaTeX preamble: `\newcommand`, `\renewcommand`, `\def`, `\DeclareMathOperator` (a pasted `\usepackage` is ignored). Yours win over KaTeX's own, so `\newcommand{\R}{\mathbb{R}}` is fine.
- Chromium draws only core MathML, so the build rewrites what it skips: `\mathbb \mathcal \mathfrak \mathbf \boldsymbol \mathsf \mathtt`, `\boxed`, `\cancel`, `\overline`, `\underline`, `\left|...\right|`, and `cases`, `align` and `array` alignment and rules. The sans and monospace alphabets use Helvetica and Courier because the trimmed font has none.
- Math problems (unknown commands, unbalanced braces, accented text in math) are reported as warnings with the file name, and the formula shows as red source in the page. A single inline formula wider than a phone screen is flagged too; `$$...$$` scrolls instead.

## Notes
- "Last updated" in the footer is the day your content last changed, not the day you ran the build, so rebuilding does not touch unchanged pages.
- Printing hides the frame and shows the address after each external link.
- Quotes, dashes and ellipses are typeset automatically, but `(c)`, `(r)` and `(tm)` stay as typed so labels like (a), (b), (c) survive. Type ©, ® and ™ directly.
- `npm run build` ends with the size of the largest page as sent (compressed); a page under about 14K arrives in the first round trip.
