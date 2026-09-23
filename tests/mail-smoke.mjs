/* בדיקת דפדפן לטיוטת המייל למאזינים (mail.html והחלון באזור הניהול) — מול Worker מדומה,
   ספריית Google מדומה ו־Gmail API מדומה. בלי רשת ובלי חשבון אמיתי.
   הרצה:  npx http-server -p 4180 .   (בחלון אחד)
          node tests/mail-smoke.mjs   (בחלון שני; דורש Playwright כמו שאר הבדיקות) */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const API = 'https://rosh-berosh.smwlyqswkwt232.workers.dev';
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✕'} ${msg}`); if (!ok) fails.push(msg); };
const catalog = JSON.parse(readFileSync(new URL('../data/episodes.json', import.meta.url), 'utf8'));
const EP = catalog.episodes.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[3];
const SUBS = ['one@example.com', 'Two@Example.com', 'two@example.com', 'three@example.com', 'not-an-email'];

let admin = true, subsMode = 'ok', gmailMode = 'ok', userdata = null, published = null;
const listAdds = [];   // מה שנשלח להוספה לרשימת התפוצה
const drafts = []; let tokenRequests = 0;

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1360, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,range', 'access-control-allow-methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS' };
await ctx.route(`${API}/**`, async (route) => {
  const req = route.request(); const p = new URL(req.url()).pathname; const m = req.method(); const auth = req.headers().authorization;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  if (m === 'OPTIONS') return json({});
  if (p === '/api/program/me') return auth ? json({ user: { email: 'admin@example.com', name: 'בדיקה', isAdmin: admin } }) : json({ user: null }, 401);
  if (p === '/api/program/catalog' && m === 'GET') return json({ ...(published || catalog), ...(auth ? { versionId: 'v1' } : {}) });
  if (p === '/api/program/catalog' && m === 'POST') { const b = req.postDataJSON(); published = { seasons: b.seasons, episodes: b.episodes, settings: b.settings }; return json({ ok: true, versionId: 'v2', notified: 0 }); }
  if (p === '/api/program/draft' && m === 'GET') return json({ draft: null });
  if (p === '/api/program/draft') return json({ ok: true, updatedAt: new Date().toISOString(), by: 'admin@example.com' });
  if (p === '/api/program/userdata' && m === 'GET') return auth ? json({ data: userdata }) : json({ error: 'x' }, 401);
  if (p === '/api/program/userdata' && m === 'PUT') { userdata = req.postDataJSON().data; return json({ ok: true }); }
  if (p === '/api/program/subscribers' && m === 'POST') {
    if (!admin) return json({ error: 'אין הרשאת ניהול.' }, 403);
    const content = req.postDataJSON().content; listAdds.push(content);
    const emails = [...new Set((content.match(/[^\s@,;<>"']+@[^\s@,;<>"']+\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase()))];
    const fresh = emails.filter((e) => !SUBS.some((x) => x.toLowerCase() === e));
    SUBS.push(...fresh);
    return json({ ok: true, found: emails.length, added: fresh.length, duplicates: emails.length - fresh.length, optedOut: 0, skipped: 0 });
  }
  if (p === '/api/program/subscribers') {
    if (!admin) return json({ error: 'אין הרשאת ניהול.' }, 403);
    if (subsMode === 'missing') return json({ error: 'הנתיב לא נמצא.' }, 404);
    return json({ subscribers: SUBS.map((email) => ({ email, name: '' })), active: SUBS.length });
  }
  if (p === '/api/program/likes') return json({ counts: {}, mine: [] });
  return json({ error: 'לא נמצא' }, 404);
});
// Gmail API מדומה
await ctx.route('https://gmail.googleapis.com/**', async (route) => {
  const req = route.request(); const p = new URL(req.url()).pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return json({});
  if (req.headers().authorization !== 'Bearer tok-1') return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
  if (gmailMode === 'disabled') return json({ error: { code: 403, message: 'Gmail API has not been used in project 601586229891 before or it is disabled.', status: 'PERMISSION_DENIED' } }, 403);
  if (p.endsWith('/profile')) return json({ emailAddress: 'admin@example.com' });
  if (p.endsWith('/drafts') && req.method() === 'POST') { const raw = req.postDataJSON().message.raw; drafts.push(Buffer.from(raw, 'base64url').toString('utf8')); return json({ id: `r-${drafts.length}`, message: { id: `18ab${drafts.length}`, threadId: 't' } }); }
  return json({ error: { code: 404 } }, 404);
});
await ctx.route('https://accounts.google.com/**', (route) => route.abort());
await ctx.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await ctx.route('https://media.example/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }));
// ספריית Google מדומה: כפתור כניסה, והרשאה לג'ימייל (מחזירה טוקן)
await ctx.exposeFunction('__tokenRequested', () => { tokenRequests++; });
await ctx.addInitScript(() => {
  window.google = { accounts: {
    id: { initialize() {}, renderButton(el) { el.innerHTML = '<button type="button">Google</button>'; }, prompt() {} },
    oauth2: {
      initTokenClient(cfg) { window.__tokenCfg = cfg; return { requestAccessToken(o) { window.__tokenRequested(); window.__lastHint = o?.login_hint; setTimeout(() => cfg.callback(window.__deny ? { error: 'access_denied' } : { access_token: 'tok-1', expires_in: 3600, scope: cfg.scope }), 30); } }; },
      hasGrantedAllScopes: (r, s) => String(r.scope || '').split(' ').includes(s),
    },
  } };
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('dialog', (d) => d.accept());
const frameText = () => page.frameLocator('[data-m-frame]').locator('body').innerText();
const frameHtml = () => page.evaluate(() => document.querySelector('[data-m-frame]').srcdoc);
const header = (mime, name) => (mime.split('\r\n\r\n')[0].replace(/\r\n /g, ' ').match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1] || '';
const partOf = (mime, type) => { const m = mime.match(new RegExp(`Content-Type: ${type}; charset="UTF-8"\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+?)\\r\\n--`)); return m ? Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8') : ''; };
const subjectOf = (mime) => header(mime, 'Subject').split(' ').map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8')).join('');
const settle = (ms = 400) => page.waitForTimeout(ms);
// SHOTS=<תיקייה> שומר צילומי מסך של העורך (לבדיקה בעין; לא חלק מהבדיקה)
const shot = (name) => (process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }) : null);

/* ---------- השער ---------- */
await page.goto(`${BASE}/mail.html`);
await page.waitForSelector('#mail-gate:not([hidden])');
check((await page.locator('#mail-google button').count()) === 1, 'בלי חיבור: כפתור כניסה עם Google');

/* ---------- מנהל מחובר: העורך ---------- */
await page.evaluate(() => localStorage.setItem('rosh:cf:session', JSON.stringify({ token: 'test', user: { email: 'admin@example.com', name: 'בדיקה', isAdmin: true } })));
await page.goto(`${BASE}/mail.html?ep=${encodeURIComponent(EP.slug)}`);
await page.waitForSelector('.mail-composer', { timeout: 15000 });
check((await page.locator('[data-m="ep"]').inputValue()) === EP.id, 'התוכנית מהכתובת נבחרה');
check((await page.locator('[data-m="subject"]').inputValue()).includes(EP.title), 'הנושא כולל את שם התוכנית');
await page.waitForFunction(() => document.querySelector('[data-m-frame]')?.contentDocument?.body?.innerText.includes('להאזנה באתר'));
check((await frameText()).includes(EP.title), 'התצוגה המקדימה מציגה את התוכנית');
check(await page.locator('[data-m-frame]').evaluate((f) => f.offsetHeight > 500), 'התצוגה המקדימה בגובה המייל (ה־CSP מאפשר אותה)');
{
  const html = await frameHtml();
  check(html.includes(`episode.html?ep=${encodeURIComponent(EP.slug)}&amp;utm_source=email`), 'כפתור האזנה לדף התוכנית באתר');
  check(html.includes(`${API}/api/program/download/${encodeURIComponent(EP.id)}`), 'קישור הורדה ישיר');
}
await page.waitForFunction(() => /3 כתובות/.test(document.querySelector('[data-m-count]')?.textContent || ''));
check(/3 כתובות מרשימת התפוצה/.test(await page.locator('[data-m-count]').innerText()), 'רשימת התפוצה נטענה — בלי כפילויות ובלי כתובת לא תקינה');
check((await page.locator('[data-m="to"]').inputValue()) === 'admin@example.com', 'הנמען הגלוי: החשבון המחובר');

// עריכה: סגנון, צבע, טקסט, מה נכנס
await page.click('[data-mstyle="gold"]');
await page.fill('[data-m="intro"]', 'שלום לכולם!\n\nהתוכנית החדשה כאן.');
await page.fill('[data-m="accent"]', '#1d4ed8');
await page.uncheck('[data-mshow="phone"]');
await page.click('[data-mcover="none"]');
await settle();
{
  const html = await frameHtml();
  check(html.includes('#f5f0e6') && html.includes('#1d4ed8'), 'סגנון "זהב בהיר" וצבע ההדגשה נכנסו לתצוגה');
  check(html.includes('התוכנית החדשה כאן.') && !html.includes('077-226-2271'), 'הפתיחה נערכה והטלפון הוסר');
  check(!/<img[^>]+(cover|media)/.test(html), '"בלי תמונה"');
}
// תיאור התוכנית: מתחיל מהאתר, נערך למייל בלבד
check((await page.locator('[data-m="description"]').inputValue()) === (EP.description || ''), 'שדה התיאור מתחיל מהתיאור של התוכנית באתר');
await page.fill('[data-m="description"]', 'תיאור מיוחד למייל: ראיון בלעדי ושלושה שירים חדשים.');
await page.fill('[data-m="descTitle"]', 'מה היה בתוכנית');
await settle();
{
  const html = await frameHtml();
  check(html.includes('ראיון בלעדי ושלושה שירים חדשים') && html.includes('מה היה בתוכנית'), 'התיאור שנערך והכותרת שלו בתצוגה המקדימה');
  check(await page.locator('[data-mop="desc-reset"]').isVisible(), 'אחרי עריכה: "חזרה לתיאור מהאתר"');
}
await shot('composer-desktop');
await page.click('[data-mview="phone"]');
await settle(200);
check(await page.locator('[data-m-frame]').evaluate((f) => f.getBoundingClientRect().width <= 392), 'תצוגת טלפון');

/* ---------- יצירת הטיוטה בג'ימייל ---------- */
await page.click('[data-mop="create"]');
await page.waitForSelector('.mc-done', { timeout: 10000 });
check(tokenRequests === 1, 'הרשאה לג\'ימייל נתבקשה פעם אחת, מתוך הלחיצה');
check(await page.evaluate(() => window.__tokenCfg.scope === 'https://www.googleapis.com/auth/gmail.compose' && window.__lastHint === 'admin@example.com'), 'רק הרשאת gmail.compose, לחשבון המחובר');
check(drafts.length === 1, 'נוצרה טיוטה אחת');
{
  const mime = drafts[0];
  check(header(mime, 'To') === 'admin@example.com', 'אל: החשבון המחובר');
  check(header(mime, 'Bcc').split(/,\s*/).sort().join(' ') === 'one@example.com three@example.com two@example.com', 'כל רשימת התפוצה בעותק מוסתר');
  check(subjectOf(mime) === await page.locator('[data-m="subject"]').inputValue(), 'הנושא בעברית עבר נכון');
  const html = partOf(mime, 'text/html'), text = partOf(mime, 'text/plain');
  check(html.includes('#f5f0e6') && html.includes('התוכנית החדשה כאן.'), 'הטיוטה בדיוק כמו התצוגה המקדימה');
  check(text.includes(`${API}/api/program/download/`) && text.includes('utm_source=email'), 'גרסת טקסט עם שני הקישורים');
  check(html.includes('ראיון בלעדי ושלושה שירים חדשים') && text.includes('מה היה בתוכנית:'), 'התיאור שנערך נכנס לטיוטה');
}
await shot('composer-done');
check((await page.locator('.mc-done a').first().getAttribute('href')) === 'https://mail.google.com/mail/u/?authuser=admin%40example.com#drafts?compose=18ab1', 'קישור שפותח את הטיוטה בג\'ימייל');
check((await page.locator('[data-mop="create"]').innerText()).includes('טיוטה נוספת'), 'אחרי היצירה: הכפתור מציע טיוטה נוספת');

// רשימה ארוכה: כמה טיוטות
await page.fill('[data-m="chunk"]', '2');
await page.click('[data-mop="create"]');
await page.waitForFunction(() => document.querySelectorAll('.mc-done-links a.gold').length === 2, null, { timeout: 10000 });
check(drafts.length === 3 && header(drafts[1], 'Bcc').split(',').length === 2 && header(drafts[2], 'Bcc').split(',').length === 1, 'עד 2 נמענים בכל טיוטה: שתי טיוטות');
check(tokenRequests === 1, 'הטוקן נשמר בזיכרון לכמה טיוטות');

// טיוטת בדיקה אליי בלבד
await page.click('[data-mmode="me"]');
await page.click('[data-mop="create"]');
await page.waitForFunction((n) => document.querySelector('.mc-done span')?.textContent.includes('טיוטת בדיקה'), null, { timeout: 10000 });
check(drafts.length === 4 && header(drafts[3], 'To') === 'admin@example.com' && !drafts[3].includes('Bcc:'), '"רק אליי": בלי הרשימה');

// הבחירות נשמרות בחשבון לפעם הבאה, עם שם התוכנית כמקום ריק
await settle(3500);
check(userdata?.prefs?.mailDraft?.style === 'gold' && userdata.prefs.mailDraft.accent === '#1d4ed8' && userdata.prefs.mailDraft.show?.phone === false, 'הסגנון והבחירות נשמרו בחשבון');
check(String(userdata?.prefs?.mailDraft?.subject || '').includes('{{title}}') && !String(userdata.prefs.mailDraft.subject).includes(EP.title), 'הנושא נשמר כתבנית — בפעם הבאה ייכנס שם התוכנית הבאה');
check(!(await page.evaluate(() => Object.keys(localStorage).some((k) => /mail/i.test(k)))), 'שום דבר מהמייל לא נשמר במכשיר');

// מעבר לתוכנית אחרת: הניסוח נשאר, השם מתחלף
const other = catalog.episodes.find((e) => e.id !== EP.id && e.title);
await page.selectOption('[data-m="ep"]', other.id);
await settle();
check((await page.locator('[data-m="subject"]').inputValue()).includes(other.title) && !(await page.locator('[data-m="subject"]').inputValue()).includes(EP.title), 'מעבר לתוכנית אחרת: השם בנושא מתחלף');
check((await page.locator('[data-mstyle="gold"]').getAttribute('aria-checked')) === 'true', 'והעיצוב נשאר');
check((await page.locator('[data-m="description"]').inputValue()) === (other.description || '') && (await page.locator('[data-m="descTitle"]').inputValue()) === 'מה היה בתוכנית', 'בתוכנית האחרת: התיאור שלה, והכותרת שבחרתם נשארת');
check(userdata?.prefs?.mailDraft?.descTitle === 'מה היה בתוכנית' && !('description' in (userdata?.prefs?.mailDraft || {})), 'הכותרת נשמרת לפעם הבאה; התיאור — רק של התוכנית הזו');

// העתקת המייל (כשאין Gmail API)
await page.click('[data-mop="copy"]');
await settle(300);
check((await page.locator('.notice-host .notice-text').last().innerText()).includes('המייל הועתק'), 'העתקת המייל להדבקה ידנית');

// Gmail API לא מופעל בפרויקט: הסבר ברור
gmailMode = 'disabled';
await page.click('[data-mmode="all"]');
await page.click('[data-mop="create"]');
await page.waitForSelector('.mc-result .problems', { timeout: 10000 });
check((await page.locator('.mc-result .problems').innerText()).includes('Gmail API עוד לא הופעל'), 'Gmail API לא מופעל: הודעה שמסבירה מה לעשות');
gmailMode = 'ok';

/* ---------- השרת עוד לא מחזיר את הרשימה: ייבוא מקובץ ---------- */
subsMode = 'missing';
await page.goto(`${BASE}/mail.html?ep=${encodeURIComponent(EP.slug)}`);
await page.waitForSelector('.mail-composer');
await page.waitForSelector('[data-m-count] .problems');
check((await page.locator('[data-m-count]').innerText()).includes('ייבאו את הקובץ'), 'בלי הרשימה מהשרת: הסבר איך לייבא');
check(await page.locator('[data-m-listbox]').evaluate((d) => d.open), 'תיבת הרשימה נפתחת לבד');
await page.setInputFiles('[data-m-file]', { name: 'subscribers.csv', mimeType: 'text/csv', buffer: Buffer.from('email,name\n"a@list.com","מאזין"\nb@list.com,שרה\nA@List.com,כפול\n') });
await page.waitForFunction(() => /2 כתובות/.test(document.querySelector('[data-m-count]')?.textContent || ''));
check(true, 'ייבוא CSV מאקסל: 2 כתובות, בלי כפילויות');
subsMode = 'ok';

/* ---------- הוספת כתובות לרשימת התפוצה: הדבקה, קובץ אקסל, ושמירה ברשימה ---------- */
await page.goto(`${BASE}/mail.html?ep=${encodeURIComponent(EP.slug)}`);
await page.waitForSelector('.mail-composer');
await page.waitForFunction(() => /3 כתובות/.test(document.querySelector('[data-m-count]')?.textContent || ''));
check(await page.locator('[data-m-save]').isHidden(), 'כשהרשימה כמו בשרת — אין מה לשמור');
await page.click('[data-mop="add-open"]');
check(await page.locator('[data-m-listbox]').evaluate((d) => d.open) && await page.locator('[data-m="list"]').evaluate((t) => document.activeElement === t), '"+ הוספת כתובות לרשימה" פותח את התיבה, מוכנה להקלדה בסוף');
await page.keyboard.type('דוד לוי <David@New.com>');
await page.waitForSelector('[data-m-save]:not([hidden])');
check((await page.locator('[data-m-save-text]').innerText()).includes('כתובת אחת חדשה'), 'כתובת שהודבקה ועוד אינה ברשימה: מוצעת שמירה ברשימת התפוצה');
check(/4 כתובות/.test(await page.locator('[data-m-count]').innerText()), 'והיא נכנסת כבר לטיוטה הזו');
// קובץ אקסל (xlsx) עם שמות
{
  const zipOf = (files) => {
    const locals = [], centrals = []; let offset = 0;
    for (const [name, text] of files) {
      const nb = Buffer.from(name), raw = Buffer.from(text), data = zlib.deflateRawSync(raw);
      const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(nb.length, 26);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(offset, 42);
      locals.push(l, nb, data); centrals.push(c, nb); offset += 30 + nb.length + data.length;
    }
    const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
  };
  const xlsx = zipOf([
    ['xl/sharedStrings.xml', '<sst><si><t>מייל</t></si><si><t>שם</t></si><si><t>rivka@list.org</t></si><si><t>רבקה</t></si><si><t>one@example.com</t></si></sst>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row r="2"><c t="s"><v>2</v></c><c t="s"><v>3</v></c></row><row r="3"><c t="s"><v>4</v></c></row></sheetData></worksheet>'],
  ]);
  await page.setInputFiles('[data-m-file]', { name: 'רשימה.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
  await page.waitForFunction(() => /5 כתובות/.test(document.querySelector('[data-m-count]')?.textContent || ''));
  check((await page.locator('[data-m-save-text]').innerText()).includes('2 כתובות חדשות'), 'ייבוא מאקסל: כתובת חדשה נוספה, וזו שכבר ברשימה לא הוכפלה');
}
if (process.env.SHOTS) await page.locator('.mc-sec:has([data-m-listbox])').screenshot({ path: `${process.env.SHOTS}/list-add.png` });
await page.click('[data-mop="save-list"]');
await page.waitForFunction(() => document.querySelector('[data-m-save]')?.hidden && /5 כתובות מרשימת התפוצה/.test(document.querySelector('[data-m-count]')?.textContent || ''), null, { timeout: 10000 });
{
  const sent = listAdds.at(-1) || '';
  check(listAdds.length === 1 && sent.includes('דוד לוי <David@New.com>') && sent.includes('rivka@list.org\tרבקה') && !/one@example\.com/.test(sent), 'שמירה ברשימת התפוצה: רק הכתובות החדשות, עם השמות שלידן');
  check((await page.locator('.notice-host .notice-text').last().innerText()).includes('2 כתובות נוספו לרשימת התפוצה'), 'הודעה כמה נוספו');
  check(await page.locator('[data-m-save]').isHidden(), 'אחרי השמירה הרשימה נטענת מהשרת, ואין עוד מה לשמור');
}

/* ---------- מנהל שאינו מנהל ---------- */
admin = false;
await page.goto(`${BASE}/mail.html`);
await page.waitForSelector('#mail-gate:not([hidden])');
check((await page.locator('#mail-gate-text').innerText()).includes('אינו מוגדר כמנהל'), 'חשבון שאינו מנהל: הדף נעול');
admin = true;

/* ---------- באזור הניהול: כפתור בתוכנית, וטיוטה אוטומטית אחרי פרסום של תוכנית חדשה ---------- */
await page.evaluate(() => localStorage.setItem('rosh:admin:guided', '1'));
await page.goto(`${BASE}/admin.html?standalone=1&ep=${encodeURIComponent(EP.id)}`);
await page.waitForSelector('#editor [data-op="mail"]', { timeout: 15000 });
await page.click('#editor [data-op="mail"]');
await page.waitForSelector('#dlg-mail[open] .mail-composer');
check((await page.locator('#dlg-mail [data-m="ep"]').inputValue()) === EP.id, 'בניהול: "✉ מייל למאזינים" פותח את העורך על התוכנית');
check(await page.evaluate(() => { const d = document.querySelector('#dlg-mail'); const h = document.getElementById(d.getAttribute('aria-labelledby')); return !!h && d.contains(h); }), 'לחלון יש כותרת נגישה');
await page.click('#dlg-mail [data-close]');
await page.click('[data-op="new"]');
await page.fill('[data-f="title"]', 'תוכנית חדשה למייל');
await page.fill('[data-f="audio"]', 'https://media.example/new.mp3');
await settle(300);
await page.click('[data-tab="publish"]');
await page.waitForSelector('#pub-mail');
check(await page.locator('#pub-mail').isChecked(), 'בפרסום של תוכנית חדשה: "להכין טיוטת מייל" מסומן');
await page.click('.pub-card [data-op="publish"]');
await page.waitForSelector('#dlg-mail[open] .mail-composer', { timeout: 15000 });
await settle(600); await shot('admin-dialog');
const newId = await page.locator('#dlg-mail [data-m="ep"]').inputValue();
check(published?.episodes.some((e) => e.id === newId && e.title === 'תוכנית חדשה למייל'), 'אחרי הפרסום נפתחה טיוטת המייל של התוכנית החדשה');
check(!(await page.locator('#dlg-mail [data-m-warn]').innerText()).includes('עוד לא'), 'התוכנית כבר באתר — בלי אזהרה');
// בחלון בניהול: עריכת התיאור למייל לא נוגעת בתוכנית עצמה
await page.fill('#dlg-mail [data-m="description"]', 'רק למייל');
await settle();
check(published.episodes.find((e) => e.id === newId).description !== 'רק למייל' && (await page.locator('#dlg-mail [data-m-frame]').evaluate((f) => f.srcdoc.includes('רק למייל'))), 'התיאור במייל נערך — והתוכנית באתר לא השתנתה');

// "פרסום של התוכנית הזו" לתוכנית חדשה — גם אז נפתחת טיוטת המייל
await page.click('#dlg-mail [data-close]');
await page.click('[data-tab="programs"]');
await page.click('[data-op="new"]');
await page.fill('[data-f="title"]', 'תוכנית שפורסמה לבד');
await settle(300);
await page.click('#editor [data-op="publish-one"]');
await page.waitForSelector('#dlg-mail[open] .mail-composer', { timeout: 15000 });
{
  const id = await page.locator('#dlg-mail [data-m="ep"]').inputValue();
  check(published?.episodes.some((e) => e.id === id && e.title === 'תוכנית שפורסמה לבד'), '"פרסום של התוכנית הזו" לתוכנית חדשה: נפתחת טיוטת המייל שלה');
}

const real = errors.filter((e) => !/favicon|manifest|sw\.js|serviceWorker|net::ERR_|accounts\.google|gsi|status of 40[1349]/i.test(e));
check(real.length === 0, `אין שגיאות JavaScript${real.length ? `: ${real.join(' | ')}` : ''}`);
await browser.close();
if (fails.length) { console.error(`\n${fails.length} בדיקות נכשלו`); process.exit(1); }
console.log('\nכל הבדיקות עברו');
