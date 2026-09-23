/* ניווט בלי טעינה מחדש: לחיצה על קישור פנימי מחליפה רק את תוכן הדף, והנגן
   (שיושב מחוץ לתוכן) ממשיך לנגן בלי הפסקה. הכתובת, כפתור "אחורה", הכותרת
   והשיתוף עובדים כרגיל. דפים שנטענים תמיד במלואם: הניהול, ומה שנפתח בחלון
   חדש, בהורדה או עם מקש Ctrl/Cmd/Shift.

   כל דף רושם את המאזינים שלו על document/window עם RoshApp.signal, וכך
   במעבר לדף אחר הם מוסרים (אחרת כל מעבר היה מכפיל אותם).

   דפי התוכניות הסטטיים (episodes/<slug>.html, נבנים בפריסה) יושבים בתת־תיקייה
   ומתחילים ב־<base href="../">, ולכן כל הכתובות היחסיות נפתרות מול document.baseURI
   (שורש האתר), ובמעבר בין דפים גם תגית ה־<base> מתעדכנת.

   לחיצה על התראה (sw.js) שולחת לחלון הפתוח { type: 'rosh-navigate', url } —
   ועוברים לדף בלי טעינה, כך שהנגן ממשיך לנגן. */
(function () {
  'use strict';

  // הנתיב יחסית לשורש האתר: "", index.html, archive.html… או episodes/<slug>.html
  const PAGES = /^(?:(?:index|archive|episode|me|updates|negishut)\.html)?$|^episodes\/[^/]+\.html$/;
  const PAGE_SCRIPT = /assets\/js\/(home|archive|episode|me|updates|negishut)\.js(?:\?|$)/;
  let controller = new AbortController();
  let navigating = 0;

  const App = {
    get signal() { return controller.signal; },
    navigate,
  };
  window.RoshApp = App;

  /** שורש האתר (עם / בסוף). מחושב פעם אחת בטעינה: document.baseURI — גם בדף
      עם <base href="../"> זה השורש, ולא התיקייה episodes/. */
  const root = new URL('./', document.baseURI);

  function sameSite(url) {
    return url.origin === root.origin && url.pathname.startsWith(root.pathname) && PAGES.test(url.pathname.slice(root.pathname.length));
  }

  function internalLink(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    const a = e.target.closest?.('a[href]');
    if (!a || a.target && a.target !== '_self' || a.hasAttribute('download') || a.dataset.reload != null) return null;
    let url; try { url = new URL(a.getAttribute('href'), document.baseURI); } catch { return null; }
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

  /* לחיצה על התראה: sw.js מבקש לעבור לדף בלי לטעון מחדש */
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'rosh-navigate' || typeof d.url !== 'string') return;
    let url; try { url = new URL(d.url, document.baseURI); } catch { return; }
    if (url.origin !== location.origin) return;
    if (sameSite(url)) navigate(url.href); else location.href = url.href;
  });

  /** תגית ה־<base> של הדף החדש, בכתובת מלאה (או הסרה כשאין לו) */
  function syncBase(doc, url) {
    const next = doc.querySelector('base[href]');
    let cur = document.querySelector('base');
    if (!next) { cur?.remove(); return; }
    const href = new URL(next.getAttribute('href'), url).href;
    if (!cur) { cur = document.createElement('base'); document.head.prepend(cur); }
    if (cur.href !== href) cur.setAttribute('href', href);
  }

  /** קישור ה־canonical והנתונים המובנים (JSON-LD) של הדף החדש */
  function syncHeadLinks(doc, url) {
    const next = doc.querySelector('link[rel="canonical"]'), cur = document.querySelector('link[rel="canonical"]');
    if (next) {
      const href = new URL(next.getAttribute('href'), url).href;
      if (cur) cur.setAttribute('href', href);
      else { const l = document.createElement('link'); l.rel = 'canonical'; l.href = href; document.head.appendChild(l); }
    } else cur?.remove();
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => s.remove());
    doc.querySelectorAll('head script[type="application/ld+json"]').forEach((s) => {
      const c = document.createElement('script'); c.type = 'application/ld+json'; c.textContent = s.textContent; document.head.appendChild(c);
    });
  }

  async function navigate(href, { push = true } = {}) {
    const url = new URL(href, document.baseURI);
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
      syncBase(doc, url);
      syncHeadLinks(doc, url);
      for (const k of ['page', 'ep']) {
        if (doc.body.dataset[k]) document.body.dataset[k] = doc.body.dataset[k]; else delete document.body.dataset[k];
      }
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
