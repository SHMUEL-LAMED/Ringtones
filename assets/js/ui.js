/* עזרי ממשק משותפים: כותרת, פוטר, הודעות, עיצוב זמנים ותאריכים. */
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

  /* ---------- כותרת ופוטר ---------- */

  function header(active, site) {
    const nav = [
      ['index.html', 'בית', 'home'],
      ['archive.html', 'ארכיון התוכניות', 'archive'],
    ].map(([href, label, key]) =>
      `<a href="${href}" ${active === key ? 'aria-current="page"' : ''}>${label}</a>`
    ).join('');
    return `
<header class="site-header">
  <a class="brand" href="index.html">
    <img class="logo-mark" src="assets/img/medallion.svg" alt="" width="48" height="48">
    <div><strong>${esc(site?.name || 'ראש בראש')}</strong><small>${esc(site?.tagline || 'מצעד המוזיקה הגדול')}</small></div>
  </a>
  <nav class="site-nav" aria-label="ניווט ראשי">
    ${nav}
    <a href="admin.html" class="admin-link" ${active === 'admin' ? 'aria-current="page"' : ''}>ניהול</a>
  </nav>
</header>`;
  }

  function footer(site) {
    const links = (site?.links || []).map((l) =>
      `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`
    ).join('');
    return `
<footer class="site-footer">
  <span>${esc(site?.name || 'ראש בראש')} · ${esc(site?.tagline || 'מצעד המוזיקה הגדול')}</span>
  <nav aria-label="קישורים">${links}<button type="button" class="chip" data-kbd-help>קיצורי מקלדת</button></nav>
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

  window.RoshUI = { esc, fmtTime, parseTime, fmtDuration, fmtDate, fmtWeekday, slugify, qs, header, footer, notify, kbdHelp, isTyping, copy };
})();
