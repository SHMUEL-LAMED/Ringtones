/* בדיקת דפדפן אמיתי לאתר ראש בראש.
   הרצה:  npx http-server -p 4180 .   (בחלון אחד)
          node tests/browser-smoke.mjs (בחלון שני)
   דורש Playwright (npm i -g playwright) — אינו תלות של האתר. */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✕'} ${msg}`); if (!ok) failures.push(msg); };

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

/* ---------- דף הבית ---------- */
await page.goto(`${BASE}/index.html`);
await page.waitForSelector('#featured .card');
check((await page.getAttribute('html', 'dir')) === 'rtl', 'הדף בעברית מימין לשמאל');
check(await page.locator('.site-header .brand strong').innerText() === 'ראש בראש', 'הכותרת מציגה את שם התוכנית');
check((await page.locator('#recent .ep-card').count()) >= 3, 'רשת התוכניות האחרונות מלאה');
check((await page.locator('#stats .stat').count()) === 4, 'לוח המספרים מוצג');

// ניגון התוכנית המומלצת מדף הבית פותח את הנגן הקבוע
await page.click('#featured [data-play]');
await page.waitForSelector('.dock.open');
check(await page.locator('.dock.open').count() === 1, 'הנגן הקבוע נפתח');
await page.waitForFunction(() => window.RoshPlayer && !window.RoshPlayer.paused, null, { timeout: 5000 }).catch(() => {});
check(!(await page.evaluate(() => window.RoshPlayer.paused)), 'ההקלטה מתנגנת');
await page.waitForFunction(() => window.RoshPlayer.duration > 30);
check((await page.locator('.dock .scrub .seg').count()) >= 4, 'פס ההתקדמות מחולק לשירים');

// קפיצה לשיר מרשימת השירים
await page.click('#featured [data-track="2"] .row-main');
await page.waitForFunction(() => window.RoshPlayer.time >= 17.5);
check((await page.evaluate(() => window.RoshPlayer.trackIndex)) === 2, 'לחיצה על שיר קופצת אליו בהקלטה');
check((await page.locator('.dock [data-now]').innerText()).includes('ראש בראש'), 'הנגן מציג את השיר המתנגן');

// המיקום נשמר והנגן ממשיך גם בדף אחר
await page.evaluate(() => window.RoshPlayer.pause());
await page.click('.site-nav a[href="archive.html"]');
await page.waitForSelector('#results .ep-card');
check(await page.locator('.dock.open').count() === 1, 'הנגן נשאר פתוח במעבר לארכיון');
check((await page.evaluate(() => window.RoshPlayer.time)) >= 17, 'המיקום בהקלטה נשמר בין דפים');

/* ---------- ארכיון ---------- */
const total = await page.locator('#results .ep-card').count();
check(total >= 6, `הארכיון מציג את כל התוכניות (${total})`);
await page.click('[data-season="2025"]');
await page.waitForFunction(() => document.querySelectorAll('#results .ep-card').length === 2);
check(true, 'סינון לפי עונה עובד');
await page.click('[data-season=""]');
await page.fill('#q', 'להיט');
await page.waitForSelector('#song-hits .song-hit');
check((await page.locator('#song-hits .song-hit').count()) >= 1, 'חיפוש שיר מוצא את הרגע בתוכנית');
const hitHref = await page.locator('#song-hits .song-hit').first().getAttribute('href');
check(/episode\.html\?ep=.+&t=\d+/.test(hitHref), 'תוצאת השיר מקשרת לרגע בהקלטה');
await page.fill('#q', 'אין-כזה-דבר-בכלל');
await page.waitForSelector('#results .state');
check(true, 'מצב ריק בחיפוש בלי תוצאות');
await page.click('[data-view="seasons"]');
await page.fill('#q', '');
await page.waitForSelector('.season-block');
check((await page.locator('.season-block').count()) === 2, 'תצוגה לפי עונות');

/* ---------- דף תוכנית עם קישור עמוק ---------- */
await page.goto(`${BASE}/episode.html?ep=2026-09-12&t=31`);
await page.waitForSelector('#episode .ep-hero');
check((await page.locator('#episode h1').innerText()).includes('מצעד הקיץ'), 'דף התוכנית נטען לפי הכתובת');
await page.waitForFunction(() => window.RoshPlayer.episode && window.RoshPlayer.episode.slug === '2026-09-12');
check((await page.evaluate(() => Math.round(window.RoshPlayer.time))) >= 30, 'קישור עמוק פותח את ההקלטה ברגע הנכון');
check((await page.locator('#prevnext a').count()) === 2, 'קישורי קודמת/הבאה');
await page.goto(`${BASE}/episode.html?ep=לא-קיים`);
await page.waitForSelector('#episode .state.error');
check(true, 'תוכנית שלא קיימת מציגה הודעה ברורה');

/* ---------- ניהול: יצירה, שמירה כטיוטה, והצגה באתר ---------- */
await page.goto(`${BASE}/admin.html`);
await page.waitForSelector('#ep-list .ep-item');
await page.click('#btn-new');
await page.fill('[data-f="title"]', 'תוכנית בדיקה אוטומטית');
await page.fill('[data-f="audio"]', 'assets/audio/demo.wav');
await page.press('[data-f="audio"]', 'Tab');
await page.waitForSelector('#preview-audio');
await page.click('[data-op="track-paste"]');
await page.fill('#paste-area', '0:05 שיר בדיקה — זמר בדיקה\n0:20 שיר שני / להקה\nשיר בלי זמן');
await page.click('#paste-apply');
await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 3);
check((await page.inputValue('.track-row[data-i="1"] input.t')) === '0:20', 'הדבקת רשימה מזהה זמנים ושמות');
check((await page.inputValue('.track-row[data-i="1"] input.a')) === 'להקה', 'הדבקת רשימה מזהה את הזמר');
await page.click('[data-op="visible"]');
check((await page.locator('[data-op="visible"]').innerText()) === 'מוסתר', 'כפתור הסתרה משנה מילה');
await page.click('[data-op="visible"]');
await page.keyboard.press('Control+S');
await page.waitForSelector('.notice-success');
check((await page.evaluate(() => !!localStorage.getItem('rosh:override'))), 'שמירה כותבת טיוטה מקומית');

await page.goto(`${BASE}/archive.html?q=${encodeURIComponent('בדיקה אוטומטית')}`);
await page.waitForSelector('#results .ep-card');
check((await page.locator('#results .ep-card b').first().innerText()).includes('בדיקה אוטומטית'), 'הטיוטה מופיעה בארכיון במכשיר הזה');
await page.evaluate(() => localStorage.removeItem('rosh:override'));

/* ---------- סיכום ---------- */
const realErrors = errors.filter((e) => !/favicon|manifest|sw\.js|serviceWorker|net::ERR_(FAILED|TUNNEL_CONNECTION_FAILED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_REFUSED)/i.test(e));
check(realErrors.length === 0, `אין שגיאות JavaScript${realErrors.length ? `: ${realErrors.join(' | ')}` : ''}`);
await browser.close();
if (failures.length) { console.error(`\n${failures.length} בדיקות נכשלו`); process.exit(1); }
console.log('\nכל הבדיקות עברו');
