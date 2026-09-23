/* ראש בראש — תמה (בהיר / כהה / לפי המערכת), הפחתת אנימציות ומצב "קל" לטלפונים חלשים.
   נטען בראש <head>, לפני גיליונות הסגנון, כדי שהדף ייצבע נכון כבר מהפריים הראשון.

   הבחירה עצמה נשמרת בהעדפות של חשבון Google (ע"י קוד האתר), לא כאן: הקובץ הזה לא נוגע
   ב־localStorage. בתוך אותה לשונית נשמר עותק ב־sessionStorage רק כדי שמעבר בין דפים לא יהבהב.

   window.RoshTheme:
     get()                'light' | 'dark' | 'system'   הבחירה הנוכחית
     resolved()           'light' | 'dark'              מה שמוצג בפועל
     set(mode)            בחירה (נשמרת ללשונית, מודיעה ל־onChange)
     apply(mode)          הצגה בלבד — לא נשמר ולא מודיע (לתצוגה מקדימה)
     toggle()             מעבר בהיר <-> כהה לפי מה שמוצג עכשיו; מחזיר את הבחירה החדשה
     getMotion()          'full' | 'reduced' | 'system'
     setMotion(mode)      בחירה (נשמרת ללשונית, מודיעה ל־onChange)
     reducedMotion()      true כשהאנימציות מופחתות (בחירה או הגדרת המערכת)
     isLite()             true כשהופעל המצב הקל (טלפון חלש)
     setLite('auto'|'on'|'off')
     onChange(fn)         fn({ kind: 'theme'|'motion'|'system'|'lite', theme, resolved, motion, lite }); מחזיר ביטול
   בנוסף נשלח אירוע 'rosh:themechange' על document עם אותו detail. */
(function () {
  'use strict';
  var root = document.documentElement;
  var TKEY = 'rosh:theme', MKEY = 'rosh:motion', LKEY = 'rosh:lite';
  var COLORS = { dark: '#06080f', light: '#f5f0e6' };
  var listeners = [];

  function ss(key, val) {
    try {
      if (val === undefined) return window.sessionStorage.getItem(key);
      if (val === null) window.sessionStorage.removeItem(key); else window.sessionStorage.setItem(key, val);
    } catch (e) { /* פרטי / חסום — בסדר */ }
    return null;
  }
  function mq(q) { try { return window.matchMedia ? window.matchMedia(q) : null; } catch (e) { return null; } }
  var lightMq = mq('(prefers-color-scheme: light)');
  var motionMq = mq('(prefers-reduced-motion: reduce)');

  function normTheme(m) { return m === 'light' || m === 'dark' ? m : 'system'; }
  function normMotion(m) { return m === 'full' || m === 'reduced' ? m : 'system'; }

  var theme = normTheme(ss(TKEY));
  var motion = normMotion(ss(MKEY));
  var liteChoice = ss(LKEY) === 'on' || ss(LKEY) === 'off' ? ss(LKEY) : 'auto';

  function systemTheme() {
    // בלי העדפה מוצהרת: כהה (זו התמה המקורית של האתר)
    if (lightMq && lightMq.matches) return 'light';
    return 'dark';
  }
  function resolved() { return theme === 'system' ? systemTheme() : theme; }
  function reducedMotion() { return motion === 'reduced' || (motion === 'system' && !!(motionMq && motionMq.matches)); }

  function paintMeta() {
    // מה שמוצג בפועל (גם אחרי apply לתצוגה מקדימה)
    var color = COLORS[root.getAttribute('data-theme') || systemTheme()] || COLORS.dark;
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    if (!metas.length && document.head) {
      var m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); metas = [m];
    }
    for (var i = 0; i < metas.length; i++) { metas[i].setAttribute('content', color); metas[i].removeAttribute('media'); }
  }

  function paintTheme(mode) {
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    paintMeta();
  }
  function paintMotion() {
    if (motion === 'reduced') root.setAttribute('data-motion', 'reduced');
    else if (motion === 'full') root.setAttribute('data-motion', 'full');
    else root.removeAttribute('data-motion');
  }

  /* ---------- מצב קל: רק לטלפון (מצביע גס) חלש ---------- */
  function weakPhone() {
    var coarse = mq('(pointer: coarse)');
    if (!coarse || !coarse.matches) return false;
    var nav = window.navigator || {};
    var conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (conn && conn.saveData) return true;
    if (typeof nav.deviceMemory === 'number') return nav.deviceMemory <= 3;
    if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0) return nav.hardwareConcurrency <= 4;
    return false;
  }
  var autoLite = weakPhone();
  function lite() { return liteChoice === 'on' || (liteChoice === 'auto' && autoLite); }
  function paintLite() { if (lite()) root.setAttribute('data-lite', '1'); else root.removeAttribute('data-lite'); }

  function emit(kind) {
    var detail = { kind: kind, theme: theme, resolved: resolved(), motion: motion, reduced: reducedMotion(), lite: lite() };
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](detail); } catch (e) { setTimeout(function (err) { return function () { throw err; }; }(e)); } }
    try { document.dispatchEvent(new CustomEvent('rosh:themechange', { detail: detail })); } catch (e) { /* ישן מאוד */ }
  }

  function set(mode) {
    mode = normTheme(mode);
    var changed = mode !== theme;
    theme = mode;
    ss(TKEY, mode === 'system' ? null : mode);
    paintTheme(mode);
    if (changed) emit('theme');
    return mode;
  }
  function apply(mode) { paintTheme(normTheme(mode)); return normTheme(mode); }
  function toggle() { return set(resolved() === 'dark' ? 'light' : 'dark'); }

  function setMotion(mode) {
    mode = normMotion(mode);
    var changed = mode !== motion;
    motion = mode;
    ss(MKEY, mode === 'system' ? null : mode);
    paintMotion();
    if (changed) emit('motion');
    return mode;
  }
  function setLite(mode) {
    liteChoice = mode === 'on' || mode === 'off' ? mode : 'auto';
    ss(LKEY, liteChoice === 'auto' ? null : liteChoice);
    paintLite();
    emit('lite');
    return liteChoice;
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  function watch(m, fn) {
    if (!m) return;
    if (m.addEventListener) m.addEventListener('change', fn); else if (m.addListener) m.addListener(fn);
  }
  watch(lightMq, function () { if (theme === 'system') { paintMeta(); emit('system'); } });
  watch(motionMq, function () { if (motion === 'system') emit('system'); });

  paintTheme(theme);
  paintMotion();
  paintLite();
  // אם תגית ה־meta מופיעה אחרי הסקריפט
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintMeta);

  window.RoshTheme = {
    get: function () { return theme; },
    resolved: resolved,
    set: set,
    apply: apply,
    toggle: toggle,
    getMotion: function () { return motion; },
    setMotion: setMotion,
    reducedMotion: reducedMotion,
    isLite: lite,
    getLite: function () { return liteChoice; },
    setLite: setLite,
    onChange: onChange,
  };
})();
