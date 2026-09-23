/* בונה את sitemap.xml מהקטלוג החי (כל התוכניות המוצגות), כדי שגוגל ימצא כל
   דף תוכנית. רץ בכל פריסה ופעם ביום (.github/workflows/pages.yml). אם השרת
   לא עונה — נופל לעותק שבמאגר (data/episodes.json). */
import { readFileSync, writeFileSync } from 'node:fs';

const site = JSON.parse(readFileSync('data/site.json', 'utf8'));
const base = site.url.replace(/\/?$/, '/');
const api = site.storage?.cloudflare?.apiBase;

let catalog = null;
if (api) {
  try {
    const r = await fetch(`${api.replace(/\/$/, '')}/api/program/catalog`, { signal: AbortSignal.timeout(20000) });
    if (r.ok) catalog = await r.json();
  } catch (err) { console.warn(`catalog fetch failed: ${err.message}`); }
}
if (!catalog?.episodes?.length) catalog = JSON.parse(readFileSync('data/episodes.json', 'utf8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const today = new Date().toISOString().slice(0, 10);
const pages = [
  { loc: base, priority: '1.0', changefreq: 'weekly' },
  { loc: `${base}archive.html`, priority: '0.9', changefreq: 'weekly' },
  { loc: `${base}updates.html`, priority: '0.5', changefreq: 'weekly' },
  { loc: `${base}negishut.html`, priority: '0.2', changefreq: 'yearly' },
  ...catalog.episodes
    .filter((e) => e && e.visible !== false && e.slug)
    .map((e) => ({ loc: `${base}episode.html?ep=${encodeURIComponent(e.slug)}`, lastmod: /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? e.date : undefined, priority: '0.7', changefreq: 'monthly' })),
];
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${esc(p.loc)}</loc>${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ''}<changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`).join('\n')}
</urlset>
`;
writeFileSync('sitemap.xml', xml);
console.log(`sitemap.xml: ${pages.length} pages (built ${today})`);
