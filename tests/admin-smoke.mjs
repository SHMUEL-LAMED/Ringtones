/* בדיקת דפדפן לאזור הניהול מול Worker מדומה (בלי רשת ובלי חשבון מנהל אמיתי).
   הרצה:  npx http-server -p 4180 .   (בחלון אחד)
          node tests/admin-smoke.mjs  (בחלון שני; דורש Playwright כמו browser-smoke)
   הבדיקה עוברת על ארבעת חלקי הניהול, על הפרסום, ועל מה שהאתר הציבורי מציג אחריו. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const API = 'https://rosh-berosh.smwlyqswkwt232.workers.dev';
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✕'} ${msg}`); if (!ok) fails.push(msg); };
const catalog = JSON.parse(readFileSync(new URL('../data/episodes.json', import.meta.url), 'utf8'));
let published = null; let draftPuts = 0; let events = []; let messagesSent = [];
let settings = { banner: { enabled: false, text: '', link: '', linkLabel: '', until: '', sites: { program: true, survey: false } }, updates: [], survey: { id: 'main', name: 'מצעד האלבומים', open: true, url: 'https://rosh-berosh.smwlyqswkwt232.workers.dev/' } };
let handoffs = 0; let logouts = 0; let ssoBounces = 0; let ssoSignedIn = false;

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1280, height: 900 } });
const errors = [];
await ctx.route(`${API}/**`, async (route) => {
  const req = route.request(); const url = new URL(req.url()); const p = url.pathname; const m = req.method();
  const auth = req.headers()['authorization'];
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,range', 'access-control-allow-methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS' }, body: JSON.stringify(body) });
  if (m === 'OPTIONS') return json({});
  if (p === '/api/program/me') return auth ? json({ user: { email: 'admin@example.com', name: 'בדיקה', isAdmin: true } }) : json({ user: null }, 401);
  if (p === '/api/program/catalog' && m === 'GET') return json({ ...(published || catalog), settings });
  if (p === '/api/program/catalog' && m === 'POST') { const b = req.postDataJSON(); published = { seasons: b.seasons, episodes: b.episodes }; if (b.settings) settings = { ...settings, ...b.settings }; return json({ ok: true, episodes: b.episodes.length }); }
  if (p === '/api/program/draft' && m === 'GET') return json({ draft: null });
  if (p === '/api/program/draft' && m === 'PUT') { draftPuts++; return json({ ok: true, updatedAt: new Date().toISOString(), by: 'admin@example.com' }); }
  if (p === '/api/program/draft' && m === 'DELETE') return json({ ok: true });
  if (p === '/api/program/stats') return json({ days: [{ day: '2026-09-20', plays: 12, listeners: 9, seconds: 4000 }, { day: '2026-09-21', plays: 20, listeners: 15, seconds: 9000 }], episodes: [{ id: catalog.episodes[0].id, plays: 30, listeners: 20, seconds: 5000 }], recent: [{ id: catalog.episodes[1].id, plays: 8, listeners: 6, seconds: 500 }], totals: { plays: 32, listeners: 24, seconds: 13000 }, week: { plays: 32, listeners: 24 }, devices: { phone: 20, desktop: 12 } });
  if (p === '/api/program/messages' && m === 'GET') return json({ messages: [{ id: 'm1', name: 'דוד', email: 'd@x.com', text: 'תוכנית מצוינת!', episodeId: catalog.episodes[0].id, readAt: null, createdAt: 1758500000 }], unread: 1 });
  if (p === '/api/program/messages' && m === 'POST') { messagesSent.push(req.postDataJSON()); return json({ ok: true, id: 'm2' }); }
  if (p === '/api/program/messages/read') return json({ ok: true });
  if (p === '/api/program/subscribers/count') return json({ total: 100, active: 90, fromProgram: 5 });
  if (p === '/api/program/subscribe' && m === 'GET') return json({ subscribed: false, email: 'admin@example.com' });
  if (p === '/api/program/subscribe' && m === 'POST') return json({ ok: true, subscribed: true });
  if (p === '/api/program/versions') return json({ versions: [{ id: 'v1', by: 'admin@example.com', episodes: 86, createdAt: 1758400000 }] });
  if (p === '/api/program/versions/v1') return json({ data: catalog, by: 'admin@example.com', createdAt: 1758400000 });
  if (p === '/api/program/preview' && m === 'POST') return json({ ok: true, preview: { token: 'tok123' } });
  if (p === '/api/program/preview/tok123') return json({ data: { ...catalog, episodes: [{ ...catalog.episodes[0], title: 'טיוטה לבדיקה' }] }, updatedAt: 'x' });
  if (p === '/api/program/admins' && m === 'GET') return json({ admins: [{ email: 'admin@example.com', fixed: true, you: true }, { email: 'b@example.com', fixed: false, you: false }] });
  if (p === '/api/program/events') { events.push(req.postDataJSON()); return json({ ok: true }); }
  if (p === '/api/program/surveys') return json({ surveys: [{ id: 'main', name: 'מצעד האלבומים', active: true, open: true }, { id: 'old', name: 'מצעד 2025', active: false, open: false }] });
  if (p === '/api/program/handoff' && m === 'POST') { handoffs++; return json({ code: 'c0ffee', toSurvey: `${API}/api/program/handoff/c0ffee` }); }
  if (p === '/api/program/auth/handoff') { const b = req.postDataJSON(); return b.code === 'c0ffee' ? json({ token: 'handed', user: { email: 'admin@example.com', name: 'בדיקה', isAdmin: true } }) : json({ error: 'קוד המעבר פג' }, 401); }
  if (p === '/api/program/logout') { logouts++; return json({ ok: true }); }
  if (p === '/api/program/sso') { const back = new URL(url.searchParams.get('return')); back.searchParams.set('sso', ssoSignedIn ? 'c0ffee' : 'none'); ssoBounces++; return route.fulfill({ status: 302, headers: { location: back.toString() } }); }
  if (p === '/api/program/banner') return json({ banner: null });
  if (p === '/api/program/handoff/c0ffee') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ניהול משותף</title>' });
  if (p.startsWith('/api/program/stream/')) return route.fulfill({ status: 206, headers: { 'access-control-allow-origin': '*', 'content-range': 'bytes 0-1/100', 'content-type': 'audio/mpeg' }, body: Buffer.from([0, 0]) });
  return json({ error: 'לא נמצא' }, 404);
});
await ctx.route('https://accounts.google.com/**', (route) => route.abort());
await ctx.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());

/* ---------- השער בלי סשן ---------- */
await page.goto(`${BASE}/admin.html?standalone=1`);
await page.waitForSelector('#admin-gate');
await page.waitForTimeout(800);
check(await page.evaluate(() => document.body.classList.contains('admin-locked')), 'הניהול נעול בלי מנהל מחובר');
check((await page.locator('#gate-google').count()) === 1, 'השער מציע כניסה ישירה עם Google');
check((await page.locator('#gate-login:visible').count()) === 1 || (await page.locator('#gate-fallback:visible').count()) === 1, 'כשכפתור Google לא נטען יש דרך חלופית להיכנס');

/* ---------- מנהל מחובר ---------- */
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('rosh:cf:session', JSON.stringify({ token: 'test', user: { email: 'admin@example.com', name: 'בדיקה', isAdmin: true } })); });
await page.goto(`${BASE}/admin.html?standalone=1`);
await page.waitForSelector('#panel .workspace', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#dlg-guide')?.close());
check(!(await page.evaluate(() => document.body.classList.contains('admin-locked'))), 'מנהל מחובר רואה את הניהול');
check((await page.locator('#admin-tabs a').count()) === 4, 'ארבעה חלקים בדיוק');
check((await page.locator('#ep-list .ep-item').count()) === 86, 'רשימת התוכניות מלאה');
check(!/JSON|slug|API/.test(await page.locator('#main').innerText()), 'בלי JSON, slug או API על המסך');
check(!/רשימת השירים|זמר\/ת|הדבקת רשימה/.test(await page.locator('#main').innerText()), 'בלי רשימת שירים וזמרים בניהול');
await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('הכול מפורסם'), null, { timeout: 10000 }).catch(() => {});
await page.waitForLoadState('networkidle');
check((await page.locator('#status-text').innerText()).includes('הכול מפורסם'), 'המצב: הכול מפורסם');

// תוכנית חדשה
await page.click('[data-op="new"]');
await page.waitForSelector('[data-f="title"]');
await page.fill('[data-f="title"]', 'תוכנית בדיקה חדשה');
await page.fill('[data-f="description"]', 'תיאור קצר לבדיקה. משפט שני.');
await page.waitForTimeout(700);
check((await page.locator('#status-text').innerText()).includes('לא פורסמו'), 'אחרי שינוי: יש שינויים שלא פורסמו');
check(await page.evaluate(() => !!localStorage.getItem('rosh:override')), 'הטיוטה נשמרת אוטומטית במכשיר');
await page.waitForTimeout(2000);
check(draftPuts >= 1, 'הטיוטה נשמרת גם בשרת (טיוטה משותפת)');
check((await page.locator('#ep-list .ep-item').first().innerText()).includes('תוכנית בדיקה חדשה'), 'התוכנית החדשה מופיעה ברשימה');
// תזמון
await page.fill('[data-f="publishAt"]', '2031-01-01T20:00');
await page.dispatchEvent('[data-f="publishAt"]', 'change');
await page.waitForTimeout(300);
check((await page.locator('#editor .st.scheduled').count()) >= 1, 'תזמון פרסום מסומן');
// קישור למצעד
check((await page.locator('[data-f="surveyId"] option').count()) === 3, 'בחירת מצעד לתוכנית מציעה את הסקרים');
await page.selectOption('[data-f="surveyId"]', 'main');
await page.waitForTimeout(300);
// תמונה אוטומטית — יוצרת קנבס ומעלה; ההעלאה מדומה
await ctx.route(`${API}/api/program/upload**`, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }) }));
await page.click('[data-op="cover-auto"]');
await page.waitForFunction(() => document.querySelector('img.cover-preview'), null, { timeout: 15000 }).catch(() => {});
check((await page.locator('img.cover-preview').count()) === 1, 'תמונה אוטומטית נוצרה והועלתה');
// בחירה מרובה
await page.click('[data-op="bulk"]');
await page.click('#ep-list .ep-item >> nth=1');
await page.click('#ep-list .ep-item >> nth=2');
await page.click('[data-op="bulk-hide"]');
await page.waitForTimeout(300);
check((await page.locator('#ep-list .ep-item.hidden-ep').count()) === 2, 'פעולה על כמה תוכניות יחד: הסתרה');
await page.click('[data-op="bulk"]');

/* ---------- האתר ---------- */
await page.click('[data-tab="site"]');
await page.waitForSelector('[data-sf="text"]');
await page.fill('[data-sf="text"]', 'התוכנית הבאה ביום חמישי');
await page.click('[data-op="banner-toggle"]');
await page.waitForSelector('.banner-preview');
check((await page.locator('.banner-preview .site-banner').innerText()).includes('חמישי'), 'הודעה בדף הבית: תצוגה מקדימה');
await page.check('[data-bs="survey"]');
await page.waitForTimeout(300);
await page.click('[data-op="update-add"]');
await page.fill('#update-rows input[data-uf="title"] >> nth=0', 'עדכון ראשון');
await page.fill('#update-rows textarea >> nth=0', 'תוכן העדכון');
await page.click('[data-op="season-add"]');
check((await page.locator('#season-rows .season-row').count()) === 6, 'עונה חדשה נוספה');

/* ---------- מאזינים ---------- */
await page.click('[data-tab="listeners"]');
await page.waitForSelector('.admin-stats', { timeout: 10000 });
check((await page.locator('.admin-stats .stat').count()) === 4, 'סטטיסטיקות מוצגות');
check((await page.locator('.bars .bar').count()) === 2, 'גרף ימים');
check((await page.locator('.msg.unread').count()) === 1, 'הודעה מהמאזינים מוצגת');
check((await page.locator('#tab-unread').innerText()) === '1', 'תג הודעות שלא נקראו');

/* ---------- פרסום ---------- */
await page.click('[data-tab="publish"]');
await page.waitForSelector('.pub-card');
check((await page.locator('.change-list li').count()) >= 3, 'רשימת השינויים: תוכנית חדשה, עודכנו, הודעה');
check((await page.locator('.pub-card [data-op="publish"]').isEnabled()), 'כפתור הפרסום פעיל');
await page.click('[data-op="check-audio"]');
await page.waitForFunction(() => /נבדקו|בעיות/.test(document.querySelector('.tool-list').innerText), null, { timeout: 60000 });
check(/הכול תקין/.test(await page.locator('.tool-list').first().innerText()), 'בדיקת ההקלטות עוברת (השרת המדומה עונה)');
await page.click('[data-op="versions"]');
await page.waitForSelector('.version');
check((await page.locator('.version').count()) === 1, 'גרסאות קודמות מוצגות');
await page.click('summary');
await page.click('[data-op="preview-link"]');
await page.waitForSelector('.preview-url input');
check((await page.locator('.preview-url input').inputValue()).includes('preview=tok123'), 'קישור לתצוגה מקדימה נוצר');
await page.click('[data-op="admins"]');
await page.waitForSelector('.admin-list');
check((await page.locator('.admin-list li').count()) === 2, 'רשימת המנהלים מוצגת');
await page.click('.pub-card [data-op="publish"]');
await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('הכול מפורסם'), null, { timeout: 10000 });
check(!!published && published.episodes.length === 87, 'הפרסום שלח 87 תוכניות לשרת');
check(published.episodes.some((e) => e.title === 'תוכנית בדיקה חדשה' && e.publishAt === '2031-01-01T20:00'), 'התוכנית החדשה עם התזמון נשלחה');
check(settings.banner.enabled && settings.banner.text.includes('חמישי') && settings.updates.length === 1, 'ההודעה והעדכונים פורסמו');
check(settings.banner.sites?.survey === true && settings.banner.sites?.program === true, 'ההודעה מסומנת לשני האתרים');
check(published.episodes.some((e) => e.title === 'תוכנית בדיקה חדשה' && e.surveyId === 'main'), 'הקישור למצעד נשמר בתוכנית');
// דף ניהול אחד: הכתובת של ניהול התוכניות עוברת לדף הניהול המשותף, לאותו חלק, בלי כניסה נוספת
await page.goto(`${BASE}/admin.html#site`);
await page.waitForURL(/\/api\/program\/handoff\/c0ffee#prog-site$/, { timeout: 15000 }).catch(() => {});
check(/\/api\/program\/handoff\/c0ffee#prog-site$/.test(page.url()) && handoffs === 1, 'ניהול התוכניות נפתח בתוך דף הניהול המשותף');
await page.goto(`${BASE}/index.html`);
check(!(await page.evaluate(() => localStorage.getItem('rosh:override'))), 'אחרי פרסום הטיוטה המקומית נמחקה');

/* ---------- האתר הציבורי אחרי הפרסום ---------- */
await page.evaluate(() => localStorage.removeItem('rosh:cf:session'));
await page.goto(`${BASE}/index.html`);
await page.waitForSelector('#featured .card');
check((await page.locator('.site-banner:not(.vote)').count()) === 1 && (await page.locator('.site-banner:not(.vote)').innerText()).includes('חמישי'), 'ההודעה מופיעה בראש דף הבית');
check((await page.locator('.site-banner.vote').count()) === 1, '"הצביעו עכשיו" כשההצבעה במצעד פתוחה');
check((await page.locator('.site-nav a[href="updates.html"]').count()) === 1, 'קישור לעדכונים בתפריט');
const visible = await page.evaluate(() => window.RoshStore.episodes().length);
check(visible === 84, `תוכנית מתוזמנת ושתי מוסתרות לא מוצגות לציבור (${visible})`);
check((await page.locator('[data-subscribe-host]').count()) === 1, 'כרטיס התפוצה מציע כניסה עם Google');
check((await page.locator('[data-message-form]').count()) === 1, 'טופס "כתבו לנו" בדף הבית');
await page.fill('[data-message-form] textarea', 'שלום למגישים');
await page.click('[data-message-form] button[type="submit"]');
await page.waitForSelector('.subscribe-state');
check(messagesSent.length === 1 && messagesSent[0].text === 'שלום למגישים', 'הודעה מהמאזין נשלחה לשרת');
await page.click('#featured [data-play]');
await page.waitForTimeout(800);
check(events.some((e) => e.kind === 'play'), 'אירוע האזנה נשלח לסטטיסטיקה');
await page.goto(`${BASE}/updates.html`);
await page.waitForSelector('.update');
check((await page.locator('.update h2').innerText()) === 'עדכון ראשון', 'דף העדכונים מציג את העדכון');
await page.goto(`${BASE}/index.html?preview=tok123`);
await page.waitForSelector('#featured .card');
check((await page.locator('.site-banner.preview').count()) === 1, 'מצב תצוגה מקדימה מסומן');
check((await page.locator('#main').innerText()).includes('טיוטה לבדיקה'), 'התצוגה המקדימה מציגה את הטיוטה');
await page.goto(`${BASE}/me.html`);
await page.waitForSelector('#me-profile .profile-hero');
check((await page.locator('#me-profile [data-google]').count()) === 1, 'האזור האישי: כפתור Google ישיר');

/* ---------- כניסה אחת: מי שמחובר באתר הסקר מחובר גם כאן, בלי ללחוץ כלום ---------- */
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('rosh:sso-test', '1'); });
await page.goto(`${BASE}/index.html`);
await page.waitForSelector('#featured .card');
check(ssoBounces === 1 && !(await page.locator('.site-nav .me-link.signed').count()), 'לא מחוברים באתר הסקר: בדיקה אחת, ונשארים אורחים');
await page.goto(`${BASE}/archive.html`);
await page.waitForSelector('#results .ep-card');
check(ssoBounces === 1, 'לא בודקים שוב בכל דף');
ssoSignedIn = true;
await page.evaluate(() => localStorage.removeItem('rosh:sso-checked'));
await page.goto(`${BASE}/index.html`);
await page.waitForSelector('#featured .card');
check(ssoBounces === 2 && (await page.locator('.site-nav .me-link.signed').count()) === 1, 'מחוברים באתר הסקר: מחוברים גם כאן אוטומטית');
check(!page.url().includes('sso='), 'הקוד נמחק מהכתובת');
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

/* ---------- הגעה מניהול הסקר: קוד מעבר במקום כניסה, במצב מוטמע ---------- */
await page.evaluate(() => { localStorage.removeItem('rosh:cf:session'); sessionStorage.clear(); });
await page.goto(`${BASE}/admin.html?handoff=c0ffee&embed=1`);
await page.waitForSelector('#panel .workspace', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#dlg-guide')?.close());
check(!(await page.evaluate(() => document.body.classList.contains('admin-locked'))), 'קוד המעבר מחבר לניהול בלי כניסה נוספת');
check(await page.evaluate(() => document.body.classList.contains('embed') && !location.search.includes('handoff')), 'מצב מוטמע, והקוד נמחק מהכתובת');
check(!(await page.locator('#site-header .site-header').count()), 'במצב מוטמע אין כותרת אתר');
check(!(await page.locator('#admin-tabs').isVisible()), 'בדף המשותף אין תפריט לשוניות כפול');
check(await page.evaluate(() => JSON.parse(localStorage.getItem('rosh:cf:session') || 'null')?.token === 'handed'), 'הסשן מהמעבר נשמר');
await page.evaluate(() => { location.hash = 'publish'; });
await page.waitForSelector('.pub-card');
await page.click('summary');
await page.click('[data-op="logout"]');
await page.waitForTimeout(500);
check(logouts === 1, 'התנתקות מנתקת גם בשרת (מכל המקומות)');
await page.goto(`${BASE}/admin.html?handoff=bad000&standalone=1`);
await page.waitForSelector('#admin-gate');
await page.waitForTimeout(800);
check(await page.evaluate(() => document.body.classList.contains('admin-locked')), 'קוד מעבר שפג משאיר את הניהול נעול');

// תשובות 401/404 מהשרת המדומה הן חלק מהתרחישים (קוד מעבר שפג, נתיב שלא קיים בשרת ישן)
const real = errors.filter((e) => !/favicon|manifest|sw\.js|serviceWorker|net::ERR_|accounts\.google|gsi|status of 40[14]/i.test(e));
check(real.length === 0, `אין שגיאות JavaScript${real.length ? `: ${real.join(' | ')}` : ''}`);
await browser.close();
if (fails.length) { console.error(`\n${fails.length} בדיקות נכשלו`); process.exit(1); }
console.log('\nכל הבדיקות עברו');
