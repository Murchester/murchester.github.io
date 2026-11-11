# My homepage

## Commands
- `npm install` once, then `npm run dev`: builds, serves http://localhost:3000, rebuilds on every save (refresh the tab). Drafts are visible here.
- `npm run new` asks what to make. Or: `npm run new -- post "My title" [folder] [--draft]`, `npm run new -- page about/credits`, `npm run new -- folder notes/math`.
- `npm run build` writes the site to `dist/` and warns about broken internal links and images. `npm run release` also writes `.br` and `.gz` copies for hosts that serve precompressed files.
- Set `SITE_URL=https://you.example` when building to get absolute RSS links, `sitemap.xml`, `robots.txt` and canonical tags.

## Content
- `content/` is the site. Folders become sections with an automatic "Index of /folder/" listing (add an `index.md` for an intro) and appear in the menu.
- A `.md` file is a page. Front matter: `title:`, `date:` (makes it a post), `updated:`, `description:`, `tags: a, b` (gives /tags/ pages), `toc: true` (contents box), `draft: true` (hidden from builds). Names starting with `_` or `.` are ignored.
- Footnotes: `text[^1]` and `[^1]: the note`. Images and files go in `static/` (local images get width and height automatically). Put `favicon.svg`, `.png` or `.ico` in `static/` to replace the built-in icon.

## Math
- Inline: `$a^2$` or `\(a^2\)`. Display: `$$...$$`, `\[...\]`, or `\begin{equation|align|gather|alignat}`.
- `\$` is a literal dollar sign. "$5 and $6" and code blocks are left alone.
- Typeset in Latin Modern Math (`static/fonts/lm-math.woff2`, GUST Font License), loaded only on pages with math.
