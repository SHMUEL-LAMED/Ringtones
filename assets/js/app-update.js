/* ראש בראש — רישום ה־Service Worker, ופס "האתר עודכן" כשגרסה חדשה נכנסת לתוקף.

   נטען מכל דף (<script src="assets/js/app-update.js" defer>). כך אין בדפים סקריפט
   בתוך ה־HTML, ומדיניות האבטחה (CSP) יכולה לאסור סקריפטים כאלה.
   - רושם את sw.js (רק ב־https; data-sw="off" על תגית הסקריפט מדלג — אזור הניהול).
   - כשגרסה חדשה של sw.js משתלטת על דף שכבר היה בשליטת גרסה קודמת
     (controllerchange), מוצג פס קטן: "האתר עודכן — לחצו לרענון".
     בזמן ניגון (body.is-playing) הפס מחכה עד להשהיה, כדי לא להפריע להאזנה.
   - הניווט באתר לא טוען דפים מחדש, ולכן בודקים עדכון גם כשחוזרים ללשונית
     (לכל היותר פעם בחצי שעה). */
(function () {
  'use strict';
  var sw = navigator.serviceWorker;
  var me = document.currentScript;
  if (!sw) return;

  var hadController = !!sw.controller;   // בטעינה הראשונה אין — אז החלפה אינה "עדכון"
  var registration = null;
  if (location.protocol === 'https:' && !(me && me.getAttribute('data-sw') === 'off')) {
    sw.register(new URL('sw.js', document.baseURI).href).then(function (reg) { registration = reg; }).catch(function () {});
  }

  var lastCheck = Date.now();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !registration) return;
    if (Date.now() - lastCheck < 30 * 60 * 1000) return;
    lastCheck = Date.now();
    registration.update().catch(function () {});
  });

  var shown = false, waiting = null;
  sw.addEventListener('controllerchange', function () {
    if (!hadController) { hadController = true; return; }
    if (shown || waiting) return;
    whenIdle();
  });

  function playing() { return !!document.body && document.body.classList.contains('is-playing'); }
  function whenIdle() {
    if (!playing()) { show(); return; }
    waiting = setInterval(function () {
      if (playing()) return;
      clearInterval(waiting); waiting = null;
      show();
    }, 5000);
  }

  var CSS = '' +
    '.app-update{position:fixed;left:50%;bottom:calc(var(--dock-height,0px) + 16px);transform:translateX(-50%);z-index:95;' +
    'display:flex;align-items:center;gap:10px;max-width:calc(100% - 32px);padding:8px;padding-inline-start:16px;' +
    'background:var(--panel-solid,#121729);color:var(--text,#f4f1e8);border:1px solid var(--border,rgba(255,255,255,.09));' +
    'border-radius:999px;box-shadow:0 12px 32px rgba(0,0,0,.35);font-size:14px;font-weight:600;line-height:1.3;font-family:inherit}' +
    '.app-update span{min-width:0}' +
    '.app-update button{font:inherit;cursor:pointer;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,.09));background:transparent;color:inherit;padding:6px 12px;min-height:34px}' +
    '.app-update .app-update-go{background:var(--gold,#f0c65a);border-color:var(--gold,#f0c65a);color:#16120a;font-weight:800}' +
    '.app-update .app-update-x{padding:6px 10px;opacity:.8}' +
    '.app-update button:hover{filter:brightness(1.08)}' +
    '.app-update button:focus-visible{outline:2px solid var(--gold,#f0c65a);outline-offset:2px}';

  function show() {
    if (shown || !document.body) return;
    shown = true;
    if (!document.getElementById('app-update-css')) {
      var st = document.createElement('style');
      st.id = 'app-update-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    var bar = document.createElement('div');
    bar.className = 'app-update';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    var text = document.createElement('span');
    text.textContent = 'האתר עודכן — לחצו לרענון';
    var go = document.createElement('button');
    go.type = 'button'; go.className = 'app-update-go'; go.textContent = 'רענון';
    go.addEventListener('click', function () { location.reload(); });
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'app-update-x'; x.textContent = '✕';
    x.setAttribute('aria-label', 'סגירה');
    x.addEventListener('click', function () { bar.remove(); });
    bar.appendChild(text); bar.appendChild(go); bar.appendChild(x);
    document.body.appendChild(bar);
  }

  // לבדיקות: RoshAppUpdate.show() מציג את הפס מיד
  window.RoshAppUpdate = { show: show };
})();
