/* עזרי ממשק משותפים: כותרת, פוטר, הודעות, עיצוב זמנים ותאריכים,
   מקור ההשמעה של כל תוכנית, עטיפות צבעוניות, אנימציות גילוי ואור עוקב. */
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const pad = (n) => String(n).padStart(2, '0');

  /** 3725 → "1:02:05", 125 → "2:05" */
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  /** "1:02:05" / "2:05" / "125" → seconds */
  function parseTime(str) {
    if (typeof str === 'number') return str;
    const t = String(str || '').trim();
    if (!t) return 0;
    if (/^\d+(\.\d+)?$/.test(t)) return Math.floor(Number(t));
    const parts = t.split(':').map(Number);
    if (parts.some(isNaN)) return NaN;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }

  /** מספר שניות → "58 דקות" / "שעה ו־3 דקות" */
  function fmtDuration(sec) {
    sec = Number(sec) || 0;
    if (!sec) return '';
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (!h) return `${m} דקות`;
    const hw = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`;
    return m ? `${hw} ו־${m} דקות` : hw;
  }

  const heDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  const heDateShort = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
  const heWeekday = new Intl.DateTimeFormat('he-IL', { weekday: 'long' });

  function toDate(iso) {
    if (!iso) return null;
    const d = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(d) ? null : d;
  }
  function fmtDate(iso, short) {
    const d = toDate(iso);
    return d ? (short ? heDateShort : heDate).format(d) : '';
  }
  function fmtWeekday(iso) {
    const d = toDate(iso);
    return d ? heWeekday.format(d) : '';
  }

  function slugify(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'episode';
  }

  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  /* ---------- מקור ההשמעה ----------
     ההקלטות שמורות בקבצים משותפים (Google Drive). האתר לא מציג שום דבר
     מהממשק של Drive: הוא מחלץ את מזהה הקובץ ומזרים אותו ישירות לנגן שלו.
     driveId(ep): מזהה הקובץ אם ההקלטה שמורה בדרייב, אחרת null. */

  function isDriveUrl(value) {
    try { const u = new URL(String(value || '')); return u.protocol === 'https:' && (u.hostname === 'drive.google.com' || u.hostname === 'docs.google.com' || u.hostname === 'drive.usercontent.google.com'); }
    catch { return false; }
  }

  function driveId(ep) {
    if (ep?.audio) {
      try { if (new URL(ep.audio, location.href).hostname !== 'drive.google.com') return null; } catch { return null; }
    }
    for (const value of [ep?.audio, ...(ep?.links || []).map(l => l.url)]) {
      try {
        const u = new URL(value);
        if (u.protocol === 'https:' && u.hostname === 'drive.google.com') {
          const id = u.pathname.match(/^\/file\/d\/([\w-]+)(?:\/|$)/)?.[1] || u.searchParams.get('id');
          if (id && /^[\w-]+$/.test(id)) return id;
        }
      } catch { /* not a Drive URL */ }
    }
    return null;
  }

  /** הורדה ישירה של קובץ הדרייב (עובדת כניווט/הורדה; לא כמדיה בתוך דף). */
  const driveDirect = (id) => `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;

  /** ה־Worker של אתר הסקר (data/site.json → storage.cloudflare.apiBase), אם מוגדר. */
  function apiBase() {
    const base = window.RoshStore?.site?.storage?.cloudflare?.apiBase;
    return base ? String(base).replace(/\/$/, '') : '';
  }

  /** כתובות ההזרמה לנגן, לפי סדר עדיפות. גוגל חוסם טעינת מדיה חוצת־אתרים
      (Sec-Fetch-Site: cross-site → 403), ולכן ההזרמה עוברת דרך ה־Worker
      (/api/program/stream/<id>, מעביר Range). הכתובת הישירה נשארת כגיבוי
      לדפדפנים שלא שולחים את הכותרת הזו. */
  function streamCandidates(ep) {
    const id = driveId(ep);
    if (id) {
      const base = apiBase();
      return base ? [`${base}/api/program/stream/${encodeURIComponent(id)}`, driveDirect(id)] : [driveDirect(id)];
    }
    if (ep?.audio && !isDriveUrl(ep.audio)) {
      try { const u = new URL(ep.audio, location.href); if (u.protocol === 'https:' || u.protocol === 'http:') return [ep.audio]; } catch { /* כתובת לא תקינה */ }
    }
    return [];
  }

  /** הכתובת שהנגן מנגן: קובץ ישיר אם יש, אחרת הזרמה של קובץ הדרייב, אחרת ''. */
  function streamUrl(ep) { return streamCandidates(ep)[0] || ''; }

  /** כתובת להורדת ההקלטה (ניווט רגיל — לא נחסם). */
  function downloadUrl(ep) {
    const id = driveId(ep);
    if (id) return driveDirect(id);
    return streamUrl(ep);
  }

  /** קישורים שמותר להציג לציבור — בלי קישורי דרייב (ההקלטה מנוגנת באתר). */
  function publicLinks(ep) {
    return (ep?.links || []).filter((l) => !isDriveUrl(l.url));
  }

  /* ---------- עטיפה צבעונית לכל תוכנית ----------
     אין תמונות לרוב התוכניות, אז כל אחת מקבלת גוון משלה: בסיס לפי העונה
     וסטייה קטנה לפי המזהה, כדי שהרשת תיראה כמו מדף תקליטים. */
  const seasonHue = { slater: 268, levi: 202, trio: 328, legacy: 26, sets: 158 };
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function hue(ep) {
    const base = seasonHue[ep?.season] ?? (hash(ep?.season || 'x') % 360);
    return (base + (hash(ep?.id || ep?.slug || '') % 46) - 23 + 360) % 360;
  }
  const coverVars = (ep) => `--h:${hue(ep)}`;

  /* ---------- כותרת ופוטר ---------- */

  function header(active, site) {
    const user = window.RoshStore?.sb?.user || null;
    const nav = [
      ['index.html', 'בית', 'home'],
      ['archive.html', 'הארכיון', 'archive'],
      ['index.html#sets', 'סטים', 'sets'],
      ['index.html#follow', 'הקהילה', 'community'],
    ].map(([href, label, key]) =>
      `<a href="${href}" ${active === key ? 'aria-current="page"' : ''}>${label}</a>`
    ).join('');
    const first = user ? String(user.name || user.email || '').split(/[\s@]/)[0] : '';
    const me = user
      ? `<a href="me.html" class="me-link signed" ${active === 'me' ? 'aria-current="page"' : ''}>${user.picture ? `<img class="avatar" src="${esc(user.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar" aria-hidden="true">${esc(first.slice(0, 1) || '☺')}</span>`}<span>${esc(first || 'האזור האישי')}</span></a>`
      : `<a href="me.html" class="me-link" ${active === 'me' ? 'aria-current="page"' : ''}><span class="avatar" aria-hidden="true">☺</span><span>האזור האישי</span></a>`;
    // כפתור הניהול מוצג רק למי שמחובר בחשבון מנהל
    const admin = user?.isAdmin ? `<a href="admin.html" class="admin-link" ${active === 'admin' ? 'aria-current="page"' : ''}>ניהול</a>` : '';
    return `
<header class="site-header" id="site-header-bar">
  <a class="brand" href="index.html">
    <span class="logo-ring" aria-hidden="true"></span>
    <img class="logo-mark" src="assets/img/medallion.svg" alt="" width="46" height="46">
    <div><strong>${esc(site?.name || 'ראש בראש')}</strong><small>${esc(site?.tagline || 'מוזיקה ואקטואליה')}</small></div>
  </a>
  <nav class="site-nav" aria-label="ניווט ראשי">
    ${nav}
    ${admin}
    ${me}
  </nav>
</header>`;
  }

  function footer(site) {
    const links = (site?.links || []).filter((l) => !isDriveUrl(l.url)).map((l) =>
      `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`
    ).join('');
    return `
<footer class="site-footer">
  <div class="footer-mark" aria-hidden="true">${esc(site?.name || 'ראש בראש')}</div>
  <div class="footer-row">
    <span>${esc(site?.name || 'ראש בראש')} · ${esc(site?.tagline || 'מוזיקה ואקטואליה')}</span>
    <nav aria-label="קישורים">${links}<a href="archive.html">הארכיון</a><button type="button" class="chip" data-kbd-help>קיצורי מקלדת</button></nav>
  </div>
</footer>`;
  }

  /* ---------- הודעה צפה אחת ---------- */

  let noticeTimer = null;
  function host() {
    let h = document.querySelector('.notice-host');
    if (!h) {
      h = document.createElement('div');
      h.className = 'notice-host';
      document.body.appendChild(h);
    }
    return h;
  }
  function inferTone(text) {
    if (/נכשל|שגיאה|לא הצלח|לא נמצא/.test(text)) return 'error';
    if (/נשמר|בהצלחה|הועתק|נמחק|פורסם/.test(text)) return 'success';
    if (/…$/.test(text)) return 'progress';
    return 'info';
  }
  function notify(text, tone, opts = {}) {
    tone = tone || inferTone(text);
    const h = host();
    h.innerHTML = '';
    clearTimeout(noticeTimer);
    const icon = tone === 'progress'
      ? '<span class="notice-spinner" aria-hidden="true"></span>'
      : `<span class="notice-icon" aria-hidden="true">${{ info: 'i', success: '✓', error: '!' }[tone]}</span>`;
    const el = document.createElement('div');
    el.className = `notice notice-${tone}`;
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    el.innerHTML = `${icon}<p class="notice-text">${esc(text)}</p>${opts.action ? `<button type="button" class="btn small gold" data-action>${esc(opts.action)}</button>` : ''}<button type="button" class="notice-close" aria-label="סגירת ההודעה">×</button>`;
    h.appendChild(el);
    const close = () => { el.remove(); clearTimeout(noticeTimer); };
    el.querySelector('.notice-close').addEventListener('click', close);
    if (opts.action && opts.onAction) el.querySelector('[data-action]').addEventListener('click', () => { opts.onAction(); close(); });
    const ttl = opts.ttl ?? (tone === 'progress' ? 0 : tone === 'error' ? 8000 : 4200);
    const arm = () => { if (ttl) noticeTimer = setTimeout(close, ttl); };
    el.addEventListener('mouseenter', () => clearTimeout(noticeTimer));
    el.addEventListener('mouseleave', arm);
    arm();
    return close;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelector('.notice-host .notice-close')?.click();
  });

  /* ---------- דיאלוג קיצורי מקלדת ---------- */

  function kbdHelp() {
    let d = document.getElementById('kbd-help');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'kbd-help';
      d.className = 'sheet';
      d.innerHTML = `
<div class="section-title"><div><p class="kicker">עזרה</p><h2>קיצורי מקלדת</h2></div><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div>
<div class="card-body"><div class="kbd-list">
  <kbd>רווח</kbd><span>ניגון / השהיה</span>
  <kbd>→</kbd><span>קדימה 15 שניות</span>
  <kbd>←</kbd><span>אחורה 15 שניות</span>
  <kbd>Shift + →</kbd><span>לשיר הבא</span>
  <kbd>Shift + ←</kbd><span>לשיר הקודם</span>
  <kbd>0–9</kbd><span>קפיצה לאחוז מהתוכנית</span>
  <kbd>M</kbd><span>השתקה</span>
  <kbd>+ / −</kbd><span>מהירות</span>
  <kbd>R</kbd><span>תוכנית אקראית</span>
  <kbd>/</kbd><span>חיפוש (בארכיון)</span>
  <kbd>?</kbd><span>החלון הזה</span>
</div></div>`;
      document.body.appendChild(d);
      d.querySelector('[data-close]').addEventListener('click', () => d.close());
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    }
    d.showModal();
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-kbd-help]')) kbdHelp();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !isTyping(e)) { e.preventDefault(); kbdHelp(); }
  });

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { return false; }
  }

  /* ---------- תנועה: גילוי בגלילה, מספרים רצים, אור עוקב, כותרת דחוסה ---------- */

  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let revealObs = null;
  function reveal(root = document) {
    if (typeof root?.querySelectorAll !== 'function') return;
    const els = [...root.querySelectorAll('[data-reveal]:not(.in)')];
    if (!els.length) return;
    if (reduceMotion() || typeof IntersectionObserver !== 'function') { els.forEach((el) => el.classList.add('in')); return; }
    revealObs ||= new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); revealObs.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    els.forEach((el, i) => { el.style.setProperty('--i', String(i % 8)); revealObs.observe(el); });
  }

  function countUp(el, to, ms = 1400) {
    to = Number(to) || 0;
    if (reduceMotion() || !to) { el.textContent = String(to); return; }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(to * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** פסי אקולייזר מונפשים: n פסים עם עיכוב וגובה אקראיים אך יציבים. */
  function eqBars(n = 40, seed = 7) {
    let out = '';
    for (let i = 0; i < n; i++) {
      const r = hash(`${seed}:${i}`);
      out += `<i style="--d:${((r % 900) / 1000).toFixed(2)}s;--p:${(.8 + (r % 700) / 1000).toFixed(2)}s;--hh:${18 + (r >> 8) % 78}%"></i>`;
    }
    return out;
  }

  function boot() {
    if (typeof document.querySelectorAll !== 'function' || !document.body) return; // סביבת בדיקה בלי DOM
    // שכבות הרקע: זוהר צפוני נע וגרעיניות עדינה
    if (!document.querySelector('.aurora')) {
      const a = document.createElement('div');
      a.className = 'aurora';
      a.setAttribute('aria-hidden', 'true');
      a.innerHTML = '<i></i><i></i><i></i><i></i>';
      document.body.prepend(a);
      const g = document.createElement('div');
      g.className = 'grain';
      g.setAttribute('aria-hidden', 'true');
      document.body.prepend(g);
    }
    // אור עוקב אחרי הסמן (רק עם עכבר)
    if (typeof matchMedia === 'function' && matchMedia('(hover:hover) and (pointer:fine)').matches && !reduceMotion()) {
      const spot = document.createElement('div');
      spot.className = 'spot';
      spot.setAttribute('aria-hidden', 'true');
      document.body.appendChild(spot);
      let raf = 0, x = 0, y = 0;
      window.addEventListener('pointermove', (e) => {
        x = e.clientX; y = e.clientY;
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; spot.style.setProperty('--mx', `${x}px`); spot.style.setProperty('--my', `${y}px`); });
      }, { passive: true });
    }
    // כותרת נדחסת בגלילה
    const onScroll = () => document.body.classList.toggle('scrolled', window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    reveal();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else if (document.readyState) boot();

  /* ---------- כרטיס תוכנית משותף (בית, ארכיון, אזור אישי, תצוגה מקדימה) ---------- */
  function seasonVars(seasonId) { return `--h:${seasonHue[seasonId] ?? (hash(seasonId || 'x') % 360)}`; }
  function epCard(e, { badge = '', titleHtml = null, href = null } = {}) {
    const S = window.RoshStore, Pl = window.RoshPlayer;
    const pos = S?.positions?.get(e.id);
    const pct = pos && e.duration ? Math.min(100, (pos.t / e.duration) * 100) : 0;
    const playable = !!(e.stream || streamUrl(e));
    return `
<a class="ep-card${Pl?.isCurrent?.(e.id) ? ' current' : ''}" href="${href || `episode.html?ep=${encodeURIComponent(e.slug)}`}" data-ep="${esc(e.id)}" style="${coverVars(e)}">
  ${e.cover ? `<img class="ep-cover" src="${esc(e.cover)}" alt="" loading="lazy">` : `<span class="cover-fallback num" aria-hidden="true">${e.number ?? '♫'}</span>`}
  ${e.number != null ? `<span class="ep-num">תוכנית ${e.number}</span>` : (e.season === 'sets' ? '<span class="ep-num">סט</span>' : '')}
  ${badge ? `<i class="ep-badge gold" aria-hidden="true">${badge}</i>` : (playable ? '<i class="ep-badge" aria-hidden="true">▶</i>' : '')}
  <b>${titleHtml ?? esc(e.title)}</b>
  <small>${esc(fmtDate(e.date, true))}${e.duration ? ` · ${esc(fmtDuration(e.duration))}` : ''}</small>
  ${e.tracks?.length ? `<span class="ep-meta">♫ ${e.tracks.length} שירים</span>` : ''}
  ${pct ? `<span class="resume" aria-hidden="true"><i style="width:${pct}%"></i></span>` : ''}
</a>`;
  }

  window.RoshUI = { esc, fmtTime, parseTime, fmtDuration, fmtDate, fmtWeekday, slugify, qs, header, footer, notify, kbdHelp, isTyping, copy, driveId, isDriveUrl, streamUrl, streamCandidates, downloadUrl, publicLinks, coverVars, hue, seasonVars, epCard, reveal, countUp, eqBars, reduceMotion };
})();
