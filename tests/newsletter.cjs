/* המייל למאזינים (assets/js/newsletter.js): התוכן, הקישורים, העיצוב, והקידוד ש־Gmail מקבל. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const w = {};
vm.runInNewContext(fs.readFileSync('assets/js/newsletter.js', 'utf8'), { window: w, TextEncoder, btoa });
const M = w.RoshMail;

const ep = { id: 'ep-90', slug: '2026-09-19', number: 90, title: 'שירי הסתיו <b>& "ציטוט"</b>', description: 'פסקה ראשונה. משפט שני.\n\nפסקה שנייה.', guests: ['דוד לוי'], cover: 'https://media.example/c.jpg', thumb: 'https://media.example/t.jpg', links: [] };
const ctx = { siteName: 'ראש בראש', tagline: 'מוזיקה', siteUrl: 'https://site.example/', listenUrl: 'https://site.example/episode.html?ep=2026-09-19&utm_source=email', downloadUrl: 'https://api.example/api/program/download/ep-90', unsubscribeUrl: 'https://site.example/me.html#me-subscribe', dateText: '19 בספטמבר 2026', durationText: 'שעה', hue: 200, links: [{ label: 'הפלייליסט', url: 'https://p.example/list' }], contacts: { phone: '077-226-2271', phoneNote: 'האזנה בשלוחה 1.' } };

// ברירות המחדל: נושא עם שם התוכנית, פתיחה, חתימה
const d = M.defaults(ep, ctx);
assert.match(d.subject, /ראש בראש/); assert(d.subject.includes(ep.title));
assert.equal(d.style, 'night');

const b = M.build(ep, ctx, {});
// הטקסט של התוכנית מוצג כטקסט, לא כ־HTML
assert(!b.html.includes('<b>& "ציטוט"</b>'), 'Title must be escaped');
assert(b.html.includes('שירי הסתיו &lt;b&gt;&amp; &quot;ציטוט&quot;&lt;/b&gt;'));
// כפתור האזנה באתר וקישור הורדה ישיר
assert(b.html.includes('href="https://site.example/episode.html?ep=2026-09-19&amp;utm_source=email"'), 'Listen link');
assert(b.html.includes('href="https://api.example/api/program/download/ep-90"'), 'Direct download link');
assert(b.text.includes(ctx.listenUrl) && b.text.includes(ctx.downloadUrl), 'Plain-text version carries both links');
// מימין לשמאל, התמונה, האורחים, התיאור, הקישורים, הטלפון וההסרה
assert.match(b.html, /<html lang="he" dir="rtl">/);
assert(b.html.includes('https://media.example/t.jpg'), 'Side cover uses the small image');
assert(b.html.includes('עם דוד לוי') && b.html.includes('פסקה שנייה') && b.html.includes('https://p.example/list'));
assert(b.html.includes('077-226-2271') && b.html.includes(ctx.unsubscribeUrl));
assert(b.preheader.length > 0 && b.html.includes(M.STYLES.night.bg));

// אפשרויות העריכה
const off = M.build(ep, ctx, { show: { download: false, description: false, guests: false, links: false, phone: false, unsubscribe: false }, cover: 'none' });
for (const gone of [ctx.downloadUrl, 'פסקה שנייה', 'עם דוד לוי', 'https://p.example/list', '077-226-2271', ctx.unsubscribeUrl, 'media.example']) assert(!off.html.includes(gone), `Toggle left ${gone}`);
assert(M.build(ep, ctx, { cover: 'full' }).html.includes('https://media.example/c.jpg'), 'Full-width cover uses the full image');
const gold = M.build(ep, ctx, { style: 'gold', accent: '#1d4ed8', listenLabel: 'לשמיעה', subject: 'נושא משלי', intro: 'שלום רב', signature: 'בברכה, המגישים' });
assert(gold.html.includes('#f5f0e6') && gold.html.includes('#1d4ed8'), 'Style and accent colour');
assert(gold.html.includes('לשמיעה') && gold.html.includes('שלום רב') && gold.html.includes('בברכה, המגישים') && gold.subject === 'נושא משלי');
assert.equal(M.inkFor('#1d4ed8'), '#ffffff'); assert.equal(M.inkFor('#f0c65a'), '#15110a');
assert.match(M.build(ep, ctx, { style: 'vivid' }).html, /hsl\(200, 55%, 10%\)/, 'Vivid style follows the episode hue');
// תיאור שנערך למייל בלבד, עם כותרת משלו (או בלי כותרת)
const edited = M.build(ep, ctx, { description: 'תיאור שנכתב למייל.\n\nפסקה נוספת.', descTitle: 'מה היה בתוכנית' });
assert(edited.html.includes('תיאור שנכתב למייל.') && edited.html.includes('פסקה נוספת.') && !edited.html.includes('פסקה שנייה'), 'Edited description replaces the site text');
assert(edited.html.includes('מה היה בתוכנית') && !edited.html.includes('>על התוכנית<') && edited.text.includes('מה היה בתוכנית:\nתיאור שנכתב למייל.'));
assert(!M.build(ep, ctx, { descTitle: '' }).html.includes('על התוכנית'), 'Empty heading is left out');
assert(!M.build(ep, ctx, { description: '   ' }).html.includes('פסקה שנייה'), 'Emptied description leaves the box out');
assert(M.build({ ...ep, description: '' }, ctx, { description: 'נכתב רק במייל' }).html.includes('נכתב רק במייל'), 'A program without a description can get one in the email');
// בלי הקלטה אין כפתור הורדה
assert(!M.build(ep, { ...ctx, downloadUrl: '' }, {}).html.includes('הורדת התוכנית'));

// כתובות: ניקוי, בלי כפילויות, בלי זבל
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
same(M.parseEmails('A@x.com; b@y.co, bad, a@x.com\n"c@z.org",email,name\nd@w.org,דוד\nשרה <Sara@Mail.co.il>.'), ['a@x.com', 'b@y.co', 'c@z.org', 'd@w.org', 'sara@mail.co.il']);
same(M.parseEmails('email,name\n"x@y.com","מאזין"\n'), ['x@y.com']);
same(M.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);

// MIME: הנושא בעברית מקודד במילים של עד 75 תווים, הרשימה בעותק מוסתר, שני חלקים
const longSubject = `🎙️ ${'תוכנית חדשה בראש בראש '.repeat(4)}`;
const enc = M.encodeWord(longSubject);
for (const word of enc.split('\r\n ')) assert(word.length <= 75, `Encoded word too long: ${word.length}`);
const decodeWords = (s) => s.split('\r\n ').map((x) => Buffer.from(x.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8')).join('');
assert.equal(decodeWords(enc), longSubject);
assert.equal(M.encodeWord('Plain ASCII'), 'Plain ASCII');

const bcc = Array.from({ length: 120 }, (_, i) => `listener${i}@example.com`);
const raw = M.raw({ to: ['me@example.com'], bcc, replyTo: 'hosts@example.com', subject: longSubject, html: b.html, text: b.text });
assert.match(raw, /^[A-Za-z0-9_-]+$/, 'base64url, no padding');
const mime = Buffer.from(raw, 'base64url').toString('utf8');
const [head, ...rest] = mime.split('\r\n\r\n');
assert(head.split('\r\n').every((line) => line.length <= 998), 'Header lines stay under the RFC limit');
const headers = head.replace(/\r\n /g, ' ');
assert.match(headers, /^To: me@example\.com$/m);
assert.match(headers, /^Reply-To: hosts@example\.com$/m);
assert.equal((headers.match(/^Bcc: (.*)$/m)[1]).split(/,\s*/).length, 120);
assert.equal(decodeWords(head.match(/^Subject: ([\s\S]*?)\r\n(?=[A-Z])/m)[1]), longSubject);
const body = rest.join('\r\n\r\n');
const parts = [...body.matchAll(/Content-Type: (text\/(?:plain|html)); charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)];
assert.equal(parts.length, 2);
const html = Buffer.from(parts.find((p) => p[1] === 'text/html')[2].replace(/\r\n/g, ''), 'base64').toString('utf8');
const text = Buffer.from(parts.find((p) => p[1] === 'text/plain')[2].replace(/\r\n/g, ''), 'base64').toString('utf8');
assert.equal(html, b.html); assert.equal(text, b.text);
// בלי עותק מוסתר (טיוטת בדיקה) — אין שורת Bcc
assert(!Buffer.from(M.raw({ to: ['me@example.com'], subject: 'x', html: '<p>x</p>', text: 'x' }), 'base64url').toString().includes('Bcc:'));

console.log('Newsletter: content, links, styles, options, addresses and Gmail MIME encoding passed.');
