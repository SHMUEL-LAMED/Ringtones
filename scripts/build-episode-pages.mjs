/* בונה דף סטטי לכל תוכנית שהציבור רואה: episodes/<slug>.html — כדי שגוגל (ותצוגות
   קישור) יראו כותרת, תיאור ותוכן אמיתיים בלי להריץ JavaScript.

   כל דף הוא עותק של episode.html עם:
   - <base href="../"> ראשון ב־<head>, כך שכל הכתובות היחסיות (עיצוב, סקריפטים, קישורים)
     ממשיכות להצביע לשורש האתר;
   - <title>, תיאור, canonical, Open Graph / Twitter ונתונים מובנים (RadioEpisode);
   - data-ep="<slug>" על <body> (episode.js קורא אותו כשאין ?ep=);
   - התוכן עצמו (כותרת, תאריך, תיאור, אורחים) בתוך <article id="episode">, במקום
     "טוענים…" — episode.js מצייר אותו מחדש עם הנגן.

   רץ בפריסה אחרי מפת האתר (.github/workflows/pages.yml). התיקייה episodes/ לא נשמרת
   במאגר (.gitignore). אותו קטלוג כמו מפת האתר: החי, או data/episodes.json כגיבוי. */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { site, base, loadCatalog, publicEpisodes, safeSlug } from './catalog.mjs';

const OUT = 'episodes';
const NAME = site.name || 'ראש בראש';
const DEFAULT_IMAGE = `${base}assets/img/og-default.png`;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** JSON בתוך <script>: בלי "</script>" ובלי הערות HTML */
const jsonScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const heDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
function fmtDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : heDate.format(d);
}
/** 160 תווים ראשונים, בלי לחתוך באמצע מילה כשאפשר */
function clip(text, n = 160) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}
const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

function staticArticle(e, season) {
  const kicker = [e.number != null && e.number !== '' ? `תוכנית ${e.number}` : (e.season === 'sets' ? 'סט' : 'תוכנית'), season?.title].filter(Boolean).join(' · ');
  const date = fmtDate(e.date);
  const paras = String(e.description || '').split(/\n\s*\n|\r?\n/).map((p) => p.trim()).filter(Boolean);
  const guests = (Array.isArray(e.guests) ? e.guests : []).map(String).filter(Boolean);
  return `
        <div class="section-title">
          <div><p class="kicker">${esc(kicker)}</p><h1>${esc(e.title)}</h1></div>
          ${date ? `<strong><time datetime="${esc(e.date)}">${esc(date)}</time></strong>` : ''}
        </div>
        <div class="ep-static">
          ${guests.length ? `<div class="meta"><span class="pill navy">עם ${esc(guests.join(', '))}</span></div>` : ''}
          ${paras.map((p) => `<p class="desc">${esc(p)}</p>`).join('\n          ')}
        </div>
      `;
}

function page(template, e, seasons) {
  const slug = String(e.slug);
  const url = `${base}${OUT}/${encodeURIComponent(slug)}.html`;
  const title = `${e.title || 'תוכנית'} — ${NAME}`;
  const description = clip(e.description) || e.title || NAME;
  const hasCover = isHttps(e.cover);
  const image = hasCover ? e.cover : DEFAULT_IMAGE;
  const season = seasons.find((s) => s.id === e.season);
  const ld = {
    '@context': 'https://schema.org', '@type': 'RadioEpisode', name: e.title, url,
    datePublished: /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? e.date : undefined,
    episodeNumber: e.number != null && e.number !== '' ? e.number : undefined,
    description: e.description || undefined, image,
    partOfSeries: { '@type': 'RadioSeries', name: NAME, url: base },
  };
  const head = [
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="${esc(NAME)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    ...(hasCover ? [] : ['<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">']),
    `<meta property="og:image:alt" content="${esc(hasCover ? e.title : `${NAME} — ${site.tagline || ''}`)}">`,
    `<meta property="og:locale" content="he_IL">`,
    ...(/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? [`<meta property="article:published_time" content="${esc(e.date)}">`] : []),
    `<meta name="twitter:card" content="${hasCover ? 'summary' : 'summary_large_image'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    `<script type="application/ld+json">${jsonScript(ld)}</script>`,
  ].map((l) => `  ${l}`).join('\n');

  let html = template;
  const must = (re, fn) => { if (!re.test(html)) throw new Error(`episode.html: ${re} not found`); html = html.replace(re, fn); };
  must(/<head>\n?/, () => '<head>\n  <base href="../">\n');
  must(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`);
  must(/<meta name="description"[^>]*>/, () => `<meta name="description" content="${esc(description)}">\n${head}`);
  must(/<body([^>]*)>/, (_, attrs) => `<body${attrs.replace(/\s+data-ep="[^"]*"/, '')} data-ep="${esc(slug)}">`);
  must(/(<article id="episode"[^>]*>)[\s\S]*?(<\/article>)/, (_, open, close) => `${open}${staticArticle(e, season)}${close}`);
  return html;
}

const catalog = await loadCatalog();
const seasons = Array.isArray(catalog.seasons) ? catalog.seasons : [];
const template = readFileSync('episode.html', 'utf8');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let n = 0; const skipped = [];
for (const e of publicEpisodes(catalog)) {
  if (!safeSlug(e.slug)) { skipped.push(e.slug); continue; }
  writeFileSync(`${OUT}/${e.slug}.html`, page(template, e, seasons));
  n++;
}
console.log(`${OUT}/: ${n} episode pages${skipped.length ? ` (skipped unsafe slugs: ${skipped.join(', ')})` : ''}`);
