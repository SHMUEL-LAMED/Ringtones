/* דף הצהרת הנגישות: התוכן כתוב בדף עצמו; כאן רק הכותרת והפוטר של האתר. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore;
  try { await S.ready; } catch { /* גם בלי נתונים — הכותרת והפוטר בברירת המחדל */ }
  const site = S.site || {};
  document.getElementById('site-header').innerHTML = U.header('negishut', site);
  document.getElementById('site-footer').innerHTML = U.footer(site);
  U.reveal();
})();
