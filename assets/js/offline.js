/* offline.html: "ניסיון חוזר" וטעינה מחדש כשהחיבור חוזר (קובץ נפרד בגלל מדיניות האבטחה — בלי סקריפט בתוך הדף). */
(function () {
  'use strict';
  var status = document.getElementById('offline-status');
  function retry() { if (status) status.textContent = 'מנסים שוב…'; location.reload(); }
  var btn = document.getElementById('retry');
  if (btn) btn.addEventListener('click', retry);
  window.addEventListener('online', retry);
})();
