/* ניווט בלי טעינה מחדש: לחיצה על קישור פנימי מחליפה רק את תוכן הדף, והנגן
   (שיושב מחוץ לתוכן) ממשיך לנגן בלי הפסקה. הכתובת, כפתור "אחורה", הכותרת
   והשיתוף עובדים כרגיל. דפים שנטענים תמיד במלואם: הניהול, ומה שנפתח בחלון
   חדש, בהורדה או עם מקש Ctrl/Cmd/Shift.

   כל דף רושם את המאזינים שלו על document/window עם RoshApp.signal, וכך
   במעבר לדף אחר הם מוסרים (אחרת כל מעבר היה מכפיל אותם). */
(function () {
  'use strict';

  const PAGES = /(?:^|\/)(?:index|archive|episode|me|updates|negishut)\.html$|\/$/;
  const PAGE_SCRIPT = /assets\/js\/(home|archive|episode|me|updates|negishut)\.js(?:\?|$)/;
  let controller = new AbortController();
  let navigating = 0;

  const App = {
    get signal() { return controller.signal; },
    navigate,
  };
  window.RoshApp = App;

  function sameSite(url) {
    const here = new URL(document.baseURI);
    const base = here.pathname.replace(/[^/]*$/, '');
    return url.origin === here.origin && url.pathname.startsWith(base) && PAGES.test(url.pathname);
  }

  function internalLink(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    const a = e.target.closest?.('a[href]');
    if (!a || a.target && a.target !== '_self' || a.hasAttribute('download') || a.dataset.reload != null) return null;
    let url; try { url = new URL(a.getAttribute('href'), location.href); } catch { return null; }
    if (!sameSite(url)) return null;
    // קישור לעוגן באותו דף — הדפדפן מטפל בזה
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
    return url;
  }

  document.addEventListener('click', (e) => {
    const url = internalLink(e);
    if (!url) return;
    e.preventDefault();
    navigate(url.href);
  });
  let current = location.pathname + location.search;
  window.addEventListener('popstate', () => {
    if (location.pathname + location.search === current) return;   // רק העוגן השתנה
    navigate(location.href, { push: false });
  });

  async function navigate(href, { push = true } = {}) {
    const url = new URL(href, location.href);
    const ticket = ++navigating;
    let html;
    try {
      const r = await fetch(url.pathname + url.search, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(String(r.status));
      html = await r.text();
    } catch { location.href = url.href; return; }   // בלי רשת או דף שלא נמצא — טעינה רגילה
    if (ticket !== navigating) return;               // לחצו בינתיים על קישור אחר
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const shell = doc.querySelector('.shell');
    const script = [...doc.querySelectorAll('script[src]')].find((s) => PAGE_SCRIPT.test(s.getAttribute('src')));
    if (!shell || !script) { location.href = url.href; return; }

    const swap = () => {
      controller.abort();
      controller = new AbortController();
      if (push) history.pushState({ rosh: 1 }, '', url.href);
      current = url.pathname + url.search;
      document.title = doc.title;
      for (const name of ['description', 'robots']) {
        const next = doc.querySelector(`meta[name="${name}"]`), cur = document.querySelector(`meta[name="${name}"]`);
        if (next && cur) cur.setAttribute('content', next.getAttribute('content'));
        else if (next) document.head.appendChild(next.cloneNode());
        else cur?.remove();
      }
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => s.remove());
      if (doc.body.dataset.page) document.body.dataset.page = doc.body.dataset.page; else delete document.body.dataset.page;
      document.querySelector('.shell').replaceWith(document.importNode(shell, true));
      const s = document.createElement('script');
      s.src = script.getAttribute('src');
      s.onload = () => { s.remove(); afterRender(url); };
      s.onerror = () => { location.href = url.href; };
      document.body.appendChild(s);
    };
    const vt = document.startViewTransition && !window.RoshUI?.reduceMotion?.();
    if (vt) document.startViewTransition(swap); else swap();
  }

  /** אחרי שהדף החדש צויר: גלילה לראש הדף או לעוגן, ופוקוס לתוכן לקוראי מסך */
  function afterRender(url) {
    const main = document.getElementById('main');
    if (url.hash) {
      const id = decodeURIComponent(url.hash.slice(1));
      let tries = 0;
      const seek = () => {
        const el = document.getElementById(id);
        if (el && el.innerHTML.trim()) el.scrollIntoView({ block: 'start' });
        else if (tries++ < 20) setTimeout(seek, 60);
      };
      seek();
    } else window.scrollTo(0, 0);
    if (main) { main.setAttribute('tabindex', '-1'); main.focus({ preventScroll: true }); }
  }
})();
