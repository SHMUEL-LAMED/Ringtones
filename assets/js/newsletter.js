/* המייל למאזינים: בונה את הטיוטה שנוצרת בג'ימייל על תוכנית חדשה.
   מודול טהור — בלי DOM ובלי רשת — כדי שאפשר יהיה לבדוק אותו ב־Node:
     build(episode, ctx, opts) → { subject, preheader, html, bodyHtml, text }
     raw({ to, bcc, subject, html, text })  → ההודעה כ־MIME בקידוד base64url (מה ש־Gmail מקבל)
     STYLES — סגנונות העיצוב של המייל, chunk — חלוקת הנמענים לכמה טיוטות.
   המייל בנוי מטבלאות עם עיצוב בתוך התגיות (inline), מימין לשמאל, כמו שתוכנות
   הדואר (ג'ימייל, אאוטלוק, הטלפון) מציגות נכון. */
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const SANS = "Heebo, 'Segoe UI', 'Arial Hebrew', Arial, sans-serif";
  const DISPLAY = "Karantina, Heebo, 'Arial Hebrew', Arial, sans-serif";
  const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&family=Karantina:wght@700&display=swap';

  /* ---------- סגנונות ---------- */

  /** "#f0c65a" → הצבע של הטקסט שיושב עליו (כהה על צבע בהיר, לבן על צבע כהה) */
  function inkFor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return '#15110a';
    const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#15110a' : '#ffffff';
  }
  /** צבע ב־HSL לסגנון הצבעוני (לפי הגוון של התוכנית באתר) */
  const hsl = (h, s, l) => `hsl(${Math.round(h)}, ${s}%, ${l}%)`;

  const STYLES = {
    night: { name: 'אולפן לילה', hint: 'כמו האתר: רקע חצות וזהב חם', bg: '#06080f', card: '#121729', text: '#f6f2e8', muted: '#b3ad9e', accent: '#f0c65a', border: '#2a3048', soft: '#1a2036', dark: true },
    gold: { name: 'זהב בהיר', hint: 'קרם חם, זהב עמוק — נעים לקריאה', bg: '#f5f0e6', card: '#fffcf6', text: '#140f08', muted: '#6b6252', accent: '#a87a12', border: '#e8dfc8', soft: '#f7f1e3', dark: false },
    clean: { name: 'נקי', hint: 'לבן, שחור, מינימלי', bg: '#f2f2f2', card: '#ffffff', text: '#111111', muted: '#6a6a6a', accent: '#111111', border: '#e4e4e4', soft: '#f6f6f6', dark: false },
    vivid: { name: 'צבעוני', hint: 'הצבע של התוכנית, כמו העטיפה שלה באתר', bg: null, card: null, text: '#ffffff', muted: '#d7d2e6', accent: null, border: null, soft: null, dark: true },
  };
  /** הסגנון המלא לתוכנית: הצבעוני נגזר מהגוון, ואפשר להחליף את צבע ההדגשה */
  function palette(opts, ctx) {
    const base = STYLES[opts.style] || STYLES.night;
    const p = { ...base };
    if (opts.style === 'vivid') {
      const h = Number.isFinite(Number(ctx.hue)) ? Number(ctx.hue) : 268;
      p.bg = hsl(h, 55, 10); p.card = hsl(h, 40, 17); p.border = hsl(h, 35, 26); p.soft = hsl(h, 38, 21); p.accent = hsl((h + 40) % 360, 90, 70);
    }
    if (/^#[0-9a-f]{6}$/i.test(opts.accent || '')) p.accent = opts.accent;
    p.accentInk = /^#/.test(p.accent) ? inkFor(p.accent) : '#15110a';
    return p;
  }

  /* ---------- טקסטים ---------- */

  const paragraphs = (text) => String(text || '').replace(/\r/g, '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const firstSentence = (text, max = 120) => (paragraphs(text)[0] || '').split(/(?<=[.!?…])\s/)[0].trim().slice(0, max);
  const label = (e) => String(e?.title || '').trim() || 'תוכנית בלי שם';

  /** ברירות המחדל לתוכנית: הנושא והפתיחה. השאר (סגנון, חתימה, מה לכלול) נשמר בין תוכניות. */
  function defaults(episode, ctx = {}) {
    const name = ctx.siteName || 'ראש בראש';
    return {
      subject: `🎙️ תוכנית חדשה ב${name}: ${label(episode)}`,
      intro: `שלום!\nתוכנית חדשה עלתה לאתר — "${label(episode)}". מוזמנים להאזין באתר, או להוריד את הקובץ ולשמוע בדרך.`,
      signature: `שבוע טוב ומוזיקלי,\nצוות ${name}`,
      style: 'night', accent: '', cover: 'side',
      listenLabel: 'להאזנה באתר', downloadLabel: 'הורדת התוכנית',
      // התיאור במייל: מתחיל מהתיאור של התוכנית באתר, ואפשר לערוך אותו למייל בלבד
      description: String(episode?.description || ''), descTitle: 'על התוכנית',
      show: { description: true, guests: true, links: true, download: true, phone: true, unsubscribe: true },
    };
  }

  /* ---------- ה־HTML ---------- */

  /**
   * ctx: { siteName, tagline, siteUrl, listenUrl, downloadUrl, unsubscribeUrl, dateText, durationText, hue, contacts:{ phone, phone2, phoneNote } }
   * opts: כמו defaults() אחרי עריכה.
   */
  function build(episode, ctx = {}, opts = {}) {
    const o = { ...defaults(episode, ctx), ...opts, show: { ...defaults(episode, ctx).show, ...(opts.show || {}) } };
    const p = palette(o, ctx);
    const name = ctx.siteName || 'ראש בראש';
    const title = label(episode);
    const kicker = [name, episode.number != null ? `תוכנית ${episode.number}` : ''].filter(Boolean).join(' · ');
    const meta = [ctx.dateText, ctx.durationText].filter(Boolean);
    const guests = o.show.guests && Array.isArray(episode.guests) ? episode.guests.filter(Boolean) : [];
    if (guests.length) meta.push(`עם ${guests.join(', ')}`);
    // ליד הכותרת מספיקה התמונה הקטנה (640px); תמונה גדולה למעלה — המלאה
    const cover = String((o.cover === 'full' ? episode.cover || episode.thumb : episode.thumb || episode.cover) || '');
    const coverMode = cover && o.cover !== 'none' ? o.cover : 'none';
    const links = o.show.links && Array.isArray(ctx.links) ? ctx.links.filter((l) => l && l.url) : [];
    const download = o.show.download && ctx.downloadUrl;
    const intro = paragraphs(o.intro), desc = o.show.description ? paragraphs(typeof o.description === 'string' ? o.description : episode.description) : [], sig = paragraphs(o.signature);
    const descTitle = String(o.descTitle ?? 'על התוכנית').trim();
    const preheader = firstSentence(o.intro) || firstSentence(episode.description) || `${kicker} · ${title}`;
    const phone = o.show.phone && ctx.contacts?.phone ? ctx.contacts.phone : '';

    const td = (inner, style = '', attrs = '') => `<td dir="rtl" align="right" style="${style}" ${attrs}>${inner}</td>`;
    const para = (text, style) => `<p style="margin:0 0 12px;font-family:${SANS};font-size:16px;line-height:1.75;color:${p.text};${style || ''}">${esc(text).replace(/\n/g, '<br>')}</p>`;
    const button = (href, text, primary) => `<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 26px;border-radius:999px;font-family:${SANS};font-size:16px;font-weight:900;line-height:1.2;text-align:center;white-space:nowrap;text-decoration:none;mso-padding-alt:0;${primary ? `background:${p.accent};color:${p.accentInk};border:2px solid ${p.accent}` : `background:transparent;color:${p.text};border:2px solid ${p.border}`}">${esc(text)}</a>`;

    const titleBlock = `
<p style="margin:0 0 10px;font-family:${SANS};font-size:13px;font-weight:900;letter-spacing:.02em;color:${p.accent}">✦ ${esc(kicker)}</p>
<h1 class="h1" style="margin:0;font-family:${DISPLAY};font-size:46px;font-weight:700;line-height:1.05;color:${p.text}">${esc(title)}</h1>
${meta.length ? `<p style="margin:10px 0 0;font-family:${SANS};font-size:14px;font-weight:700;line-height:1.6;color:${p.muted}">${esc(meta.join(' · '))}</p>` : ''}`;

    const header = coverMode === 'side'
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl"><tr>
${td(`<img src="${esc(cover)}" width="160" height="160" alt="" style="display:block;width:160px;height:160px;border-radius:18px;object-fit:cover;border:1px solid ${p.border}">`, 'width:160px;padding:0 0 0 22px;vertical-align:top', 'class="cv"')}
${td(titleBlock, 'vertical-align:top', 'class="tb"')}
</tr></table>`
      : titleBlock;
    const fullCover = coverMode === 'full' ? `<tr>${td(`<img src="${esc(cover)}" width="600" alt="" class="w" style="display:block;width:100%;max-width:600px;height:auto;border:0">`, 'padding:0')}</tr>` : '';

    const bodyHtml = `
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${p.bg};opacity:0">${esc(preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" bgcolor="${p.bg}" style="background:${p.bg};margin:0;padding:0">
<tr><td align="center" style="padding:28px 12px 36px">
<table role="presentation" class="w" width="600" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:600px;max-width:100%">
<tr>${td(`<span style="font-family:${SANS};font-size:13px;font-weight:900;letter-spacing:.03em;color:${p.muted}">${esc(ctx.tagline || name)}</span>`, 'padding:0 6px 14px')}</tr>
<tr><td dir="rtl" bgcolor="${p.card}" style="background:${p.card};border:1px solid ${p.border};border-radius:26px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl">
${fullCover}
<tr>${td(header, 'padding:30px 32px 6px', 'class="p"')}</tr>
${intro.length ? `<tr>${td(intro.map((t) => para(t)).join(''), 'padding:18px 32px 0', 'class="p"')}</tr>` : ''}
<tr>${td(`<table role="presentation" class="bts" cellpadding="0" cellspacing="0" border="0" dir="rtl"><tr>${td(button(ctx.listenUrl || ctx.siteUrl || '#', `▶  ${o.listenLabel || 'להאזנה באתר'}`, true), 'padding:6px 0 6px 10px', 'class="bt"')}${download ? td(button(ctx.downloadUrl, `⬇  ${o.downloadLabel || 'הורדת התוכנית'}`, false), 'padding:6px 0', 'class="bt"') : ''}</tr></table>`, 'padding:14px 32px 10px', 'class="p"')}</tr>
${desc.length ? `<tr>${td(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl"><tr>${td(`${descTitle ? `<p style="margin:0 0 8px;font-family:${SANS};font-size:13px;font-weight:900;color:${p.accent}">${esc(descTitle)}</p>` : ''}${desc.map((t) => para(t, `font-size:15px;color:${p.dark ? p.text : '#2b2620'}`)).join('')}`, `padding:18px 20px 8px;background:${p.soft};border-radius:18px`)}</tr></table>`, 'padding:14px 32px 0', 'class="p"')}</tr>` : ''}
${links.length ? `<tr>${td(`<p style="margin:0 0 6px;font-family:${SANS};font-size:13px;font-weight:900;color:${p.accent}">עוד מהתוכנית</p>${links.map((l) => `<p style="margin:0 0 6px;font-family:${SANS};font-size:15px;line-height:1.6"><a href="${esc(l.url)}" target="_blank" style="color:${p.text};font-weight:800;text-decoration:underline;text-underline-offset:3px">${esc(l.label || l.url)}</a></p>`).join('')}`, 'padding:18px 32px 0', 'class="p"')}</tr>` : ''}
${sig.length ? `<tr>${td(sig.map((t) => para(t, `color:${p.muted};font-size:15px`)).join(''), 'padding:22px 32px 26px', 'class="p"')}</tr>` : '<tr><td style="padding:0 0 22px"></td></tr>'}
</table>
</td></tr>
<tr>${td([
      phone ? `📞 <span dir="ltr" style="white-space:nowrap;unicode-bidi:isolate">${esc(phone)}</span>${ctx.contacts?.phoneNote ? ` — ${esc(firstSentence(ctx.contacts.phoneNote, 90))}` : ''}` : '',
      ctx.siteUrl ? `<a href="${esc(ctx.siteUrl)}" target="_blank" dir="ltr" style="color:${p.muted};font-weight:800;text-decoration:underline;white-space:nowrap;unicode-bidi:isolate">${esc(ctx.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '',
      o.show.unsubscribe && ctx.unsubscribeUrl ? `<a href="${esc(ctx.unsubscribeUrl)}" target="_blank" style="color:${p.muted};text-decoration:underline">להסרה מרשימת התפוצה</a>` : '',
    ].filter(Boolean).join(' &nbsp;·&nbsp; ') + (o.show.unsubscribe ? `<br><span>המייל הזה נשלח כי נרשמתם לרשימת התפוצה של ${esc(name)}.</span>` : ''), `padding:22px 12px 0;text-align:center;font-family:${SANS};font-size:12px;font-weight:700;line-height:1.9;color:${p.muted}`, 'align="center"')}</tr>
</table>
</td></tr>
</table>`;

    const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="${p.dark ? 'dark' : 'light'}">
<title>${esc(o.subject)}</title>
<link href="${FONTS_URL}" rel="stylesheet">
<style>
body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
a { color: inherit; }
@media only screen and (max-width: 620px) {
  .w { width: 100% !important; }
  .p { padding-left: 20px !important; padding-right: 20px !important; }
  .h1 { font-size: 36px !important; }
  .cv { display: block !important; width: 100% !important; padding: 0 0 16px !important; }
  .tb { display: block !important; width: 100% !important; }
  .bts { width: 100% !important; }
  .bt { display: block !important; width: 100% !important; padding: 0 0 10px !important; }
  .bt a { display: block !important; }
}
</style>
</head>
<body dir="rtl" bgcolor="${p.bg}" style="margin:0;padding:0;background:${p.bg}">
${bodyHtml}
</body>
</html>`;

    const text = [
      `🎙️ ${kicker}`, title, meta.join(' · '), '',
      ...intro, '',
      `${o.listenLabel || 'להאזנה באתר'}: ${ctx.listenUrl || ctx.siteUrl || ''}`,
      download ? `${o.downloadLabel || 'הורדת התוכנית'}: ${ctx.downloadUrl}` : '',
      desc.length ? '' : null, ...(desc.length ? [...(descTitle ? [`${descTitle}:`] : []), desc.join('\n\n')] : []),
      ...(links.length ? ['', ...links.map((l) => `${l.label || ''}: ${l.url}`)] : []),
      sig.length ? '' : null, ...sig, '',
      phone ? `📞 ${phone}` : '', ctx.siteUrl || '',
      o.show.unsubscribe && ctx.unsubscribeUrl ? `להסרה מרשימת התפוצה: ${ctx.unsubscribeUrl}` : '',
    ].filter((l) => l != null).join('\n').replace(/\n{3,}/g, '\n\n').trim();

    return { subject: o.subject, preheader, html, bodyHtml: `<style>@import url("${FONTS_URL}");</style>${bodyHtml}`, text, palette: p };
  }

  /* ---------- MIME: מה ש־Gmail מקבל ---------- */

  const utf8 = (s) => new TextEncoder().encode(String(s));
  function b64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const base64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
  /** כותרת עם עברית → "encoded words" (RFC 2047); ASCII נשאר כמו שהוא. כל מילה מקודדת
      מוגבלת ל־75 תווים, ולכן נושא ארוך מתחלק לכמה (בלי לחתוך אות או אימוג'י באמצע). */
  function encodeWord(s) {
    s = String(s);
    if (/^[\x20-\x7e]*$/.test(s)) return s;
    const words = []; let cur = '';
    for (const ch of s) {
      if (utf8(cur + ch).length > 45) { words.push(cur); cur = ''; }
      cur += ch;
    }
    if (cur) words.push(cur);
    return words.map((w) => `=?UTF-8?B?${b64(utf8(w))}?=`).join('\r\n ');
  }
  const EMAILS = /[^\s@<>,;:"'()[\]]+@[^\s@<>,;:"'()[\]]+\.[^\s@<>,;:"'()[\]]+/g;
  /** כל כתובות המייל שבטקסט — רשימה מודבקת, קובץ CSV מאקסל ("שם",כתובת), או "שם <כתובת>".
      באותיות קטנות, בלי כפילויות, בסדר שבו הופיעו. */
  function parseEmails(text) {
    const out = new Set();
    for (const m of String(text || '').matchAll(EMAILS)) out.add(m[0].replace(/\.+$/, '').toLowerCase());
    return [...out];
  }
  /** כותרת נמענים מקופלת: כתובת בכל שורה (שורה של כותרת מוגבלת ל־998 תווים) */
  const addressHeader = (name, list) => (list.length ? `${name}: ${list.join(',\r\n ')}` : null);
  function raw({ to = [], cc = [], bcc = [], replyTo = '', subject = '', html = '', text = '' }) {
    const boundary = `rosh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const lines = [
      addressHeader('To', to), addressHeader('Cc', cc), addressHeader('Bcc', bcc),
      replyTo ? `Reply-To: ${replyTo}` : null,
      `Subject: ${encodeWord(subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(b64(utf8(text))),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(b64(utf8(html))),
      `--${boundary}--`,
      '',
    ].filter((l) => l !== null).join('\r\n');
    return base64url(utf8(lines));
  }
  /** [a,b,c,d,e], 2 → [[a,b],[c,d],[e]] */
  function chunk(list, size) {
    const n = Math.max(1, Math.floor(Number(size) || 1)), out = [];
    for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
  }

  window.RoshMail = { STYLES, defaults, build, raw, chunk, parseEmails, encodeWord, base64url, inkFor, palette, FONTS_URL };
})();
