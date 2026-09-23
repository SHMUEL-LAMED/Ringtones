/* אזור הניהול של ראש בראש — ארבעה חלקים: תוכניות, האתר, מאזינים, פרסום.
   כל שינוי נשמר מיד במכשיר הזה (טיוטה) וגם בטיוטה המשותפת בשרת, כך שאפשר
   להתחיל במחשב ולהמשיך בטלפון. "פרסום לאתר" מעביר את הטיוטה לכולם.
   בלי קודים, בלי מזהים, בלי JSON. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore;
  const { esc, fmtDate, fmtDuration, slugify } = U;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  await S.ready;
  const site = S.site || {};
  const EMBED = !!S.state.embed;
  if (EMBED) document.body.classList.add('embed');

  /* דף ניהול אחד: הניהול של אתר התוכניות הוא חלק מדף הניהול של אתר הסקר.
     הכתובת הזו מעבירה לשם (עם אותו חשבון, בלי כניסה נוספת), ל"אתר התוכניות"
     בתפריט הצד. ?standalone=1 משאיר את הדף כאן — לבדיקות ולמקרה חירום. */
  if (S.state.source === 'cloudflare' && !EMBED && !new URLSearchParams(location.search).has('standalone')) {
    const part = `#prog-${['programs', 'site', 'listeners', 'publish'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'programs'}`;
    const shared = `${new URL(S.sb.cfg.apiBase).origin}/admin`;
    $('#admin-gate-text').textContent = 'עוברים לדף הניהול…';
    let target = `${shared}${part}`;
    if (S.sb.session?.token) { try { target = `${await S.sb.handoff.toSurvey()}${part}`; } catch { /* ייכנסו שם עם Google */ } }
    location.replace(target);
    return;
  }
  const paintHeader = () => { $('#site-header').innerHTML = EMBED ? '' : U.header('admin', site); };
  paintHeader();
  $('#site-footer').innerHTML = EMBED ? '' : U.footer(site);

  const TABS = ['programs', 'site', 'listeners', 'publish'];
  const CLOUD = S.state.source === 'cloudflare';
  const A = {
    data: clone(S.data),   // הטיוטה שעובדים עליה
    origin: null,          // מה שמפורסם באתר כרגע (להשוואה)
    originError: false,
    selected: null,        // התוכנית שנבחרה
    tab: 'programs',
    q: '',
    filter: 'all',
    bulk: false,           // מצב בחירה מרובה
    picked: new Set(),
    saveTimer: null, syncTimer: null, previewTimer: null,
    syncState: '',         // '', 'saving', 'saved', 'error'
    checks: { audio: null, media: null },  // תוצאות הבדיקות
    versions: null,        // רשימת הגרסאות מהשרת
    versionCache: new Map(),
    stats: null, messages: null, admins: null, subs: null,
    surveys: null,         // הסקרים באתר הסקר, לקישור תוכנית
    base: null,            // הגרסה שבאתר כשהתחילו לערוך את הטיוטה — להגנה מדריסה בין מנהלים
    notify: true,          // לשלוח התראה למאזינים על תוכניות חדשות בפרסום
    pushCount: null, epStats: new Map(), statsEp: '',
    ai: new Map(),         // מצב התמלול והסיכום לכל תוכנית
  };
  const BASE_KEY = 'rosh:override-base';
  const readBase = () => { try { return JSON.parse(localStorage.getItem(BASE_KEY) || 'null'); } catch { return null; } };
  const writeBase = (v) => { try { v == null ? localStorage.removeItem(BASE_KEY) : localStorage.setItem(BASE_KEY, JSON.stringify(v)); } catch { /* */ } };
  if (!A.data.settings) A.data.settings = S.admin.normSettings({});

  /* ---------- שמירה אוטומטית: במכשיר ובטיוטה המשותפת ---------- */

  function touch() {
    clearTimeout(A.saveTimer);
    A.saveTimer = setTimeout(persist, 400);
    paintStatus();
  }
  function persist() {
    clearTimeout(A.saveTimer); A.saveTimer = null;
    S.admin.saveOverride(A.data); writeBase(A.base);
    if (CLOUD && S.sb.user?.isAdmin) { clearTimeout(A.syncTimer); A.syncTimer = setTimeout(sync, 1500); }
    paintStatus();
  }
  async function sync() {
    A.syncState = 'saving'; paintStatus();
    try { const r = await S.sb.draft.put({ ...A.data, baseVersion: A.base }); S.admin.saveOverride(A.data, r.updatedAt); A.syncState = 'saved'; }
    catch { A.syncState = 'error'; }
    paintStatus();
  }
  window.addEventListener('beforeunload', () => { if (A.saveTimer) persist(); });

  /** מה השתנה לעומת מה שמפורסם */
  function changes() {
    if (!A.origin) return null;
    const key = (e) => JSON.stringify(e);
    const om = new Map(A.origin.episodes.map((e) => [e.id, key(e)]));
    let added = 0, changed = 0;
    for (const e of A.data.episodes) {
      if (!om.has(e.id)) added++;
      else if (om.get(e.id) !== key(S.admin.normEpisode(e, 0))) changed++;
    }
    const removed = A.origin.episodes.filter((e) => !A.data.episodes.some((x) => x.id === e.id));
    const seasons = key(S.admin.normalize({ seasons: A.origin.seasons }).seasons) !== key(S.admin.normalize({ seasons: A.data.seasons }).seasons);
    const settings = key(S.admin.normSettings(A.origin.settings)) !== key(S.admin.normSettings(A.data.settings));
    return { added, changed, removed, seasons, settings, any: !!(added || changed || removed.length || seasons || settings) };
  }

  /* ---------- בדיקת תקינות (בשפה פשוטה) ---------- */

  /** תיאור כללי שאינו מספר מה היה בתוכנית (כמו בתוכניות שיובאו מהארכיון) */
  const GENERIC_DESC = /^(מתוך ארכיון תוכנית ראש בראש\.?|הקלטה משוחזרת מתקופת קו המכלול[^]*)$/;
  /** קבוצות בבדיקת התקינות: שם, והכלי שמתקן את כולן בלחיצה אחת */
  const HEALTH_GROUPS = {
    noaudio: { title: 'בלי הקלטה' },
    noduration: { title: 'בלי אורך', fix: 'fill-durations', fixLabel: 'מילוי האורך לכולן' },
    nocover: { title: 'בלי תמונה', fix: 'covers-all', fixLabel: 'יצירת תמונה לכולן' },
    nodesc: { title: 'בלי תיאור אמיתי', fix: 'ai-all', fixLabel: 'תיאור אוטומטי מהתמלול', cloud: true },
    nodate: { title: 'בלי תאריך' },
    schedhidden: { title: 'מתוזמנות אבל מוסתרות' },
  };
  function health() {
    const must = [], should = [], dup = [];
    const byNumber = new Map(), byTitle = new Map(), byDrive = new Map();
    for (const e of A.data.episodes) {
      const name = label(e);
      if (!e.title.trim()) must.push({ id: e.id, text: `תוכנית בלי שם${e.number != null ? ` (תוכנית ${e.number})` : ''}${e.date ? ` מתאריך ${fmtDate(e.date, true)}` : ''}` });
      if (!U.streamUrl(e)) should.push({ kind: 'noaudio', id: e.id, text: `"${name}" בלי הקלטה` });
      else if (!e.duration) should.push({ kind: 'noduration', id: e.id, text: `"${name}" בלי אורך` });
      if (!e.cover) should.push({ kind: 'nocover', id: e.id, text: `"${name}" בלי תמונה` });
      if (!e.date) should.push({ kind: 'nodate', id: e.id, text: `"${name}" בלי תאריך` });
      if (!e.description.trim() || GENERIC_DESC.test(e.description.trim())) should.push({ kind: 'nodesc', id: e.id, text: `"${name}" בלי תיאור אמיתי` });
      if (e.publishAt && !S.scheduled(e) && !e.visible) should.push({ kind: 'schedhidden', id: e.id, text: `"${name}" תוזמנה לפרסום אבל מוסתרת` });
      if (e.number != null) { (byNumber.get(e.number) || byNumber.set(e.number, []).get(e.number)).push(e); }
      const t = e.title.trim().toLowerCase(); if (t) (byTitle.get(t) || byTitle.set(t, []).get(t)).push(e);
      const d = U.driveId(e); if (d) (byDrive.get(d) || byDrive.set(d, []).get(d)).push(e);
    }
    for (const [n, list] of byNumber) if (list.length > 1) dup.push({ ids: list.map((e) => e.id), text: `${list.length} תוכניות עם המספר ${n}` });
    for (const [, list] of byTitle) if (list.length > 1) dup.push({ ids: list.map((e) => e.id), text: `${list.length} תוכניות בשם "${label(list[0])}"` });
    for (const [, list] of byDrive) if (list.length > 1) dup.push({ ids: list.map((e) => e.id), text: `${list.length} תוכניות עם אותה הקלטה (${list.map(label).join(', ')})` });
    return { must, should, dup };
  }

  function paintStatus() {
    const dot = $('#status-dot'), txt = $('#status-text');
    const ch = changes();
    const syncNote = A.syncState === 'saving' ? ' · שומרים בטיוטה המשותפת…' : A.syncState === 'error' ? ' · הטיוטה המשותפת לא נשמרה' : '';
    if (!A.origin && A.originError) { dot.className = 'dot err'; txt.textContent = 'האתר לא זמין כרגע · השינויים נשמרים במכשיר הזה'; }
    else if (!A.origin) { dot.className = 'dot'; txt.textContent = 'בודקים מה מפורסם באתר…'; }
    else if (ch.any) { dot.className = 'dot draft'; txt.textContent = `יש שינויים שעדיין לא פורסמו${syncNote || ' · נשמרו'}`; }
    else { dot.className = 'dot on'; txt.textContent = 'הכול מפורסם'; }
    $('#btn-publish-top').classList.toggle('pulse', !!ch?.any);
  }

  async function loadOrigin() {
    try {
      const o = await S.admin.pullOrigin();
      A.origin = o; A.originError = false;
      const emptyRemote = CLOUD && o.episodes.length === 0 && A.data.episodes.length > 0;
      if (S.state.loadedFrom !== 'override' && !emptyRemote) { A.data = clone(o); A.base = o.versionId; }
      else A.base = readBase() ?? o.versionId;
    } catch { A.originError = true; }
    // הטיוטה המשותפת: אם במכשיר אחר עבדו אחרי השמירה האחרונה כאן — לוקחים אותה
    if (CLOUD && S.sb.user?.isAdmin) {
      try {
        const { draft } = await S.sb.draft.get();
        if (draft?.data && (!S.admin.hasOverride || String(draft.updatedAt) > String(S.admin.overrideAt || ''))) {
          A.data = S.admin.normalize(draft.data);
          A.base = draft.data.baseVersion !== undefined ? draft.data.baseVersion : A.base;
          S.admin.saveOverride(A.data, draft.updatedAt); writeBase(A.base);
          if (draft.by && draft.by !== S.sb.user.email) U.notify(`נטענה הטיוטה המשותפת (נשמרה על ידי ${draft.by}).`, 'info');
          else if (S.state.loadedFrom !== 'override') U.notify('נטענה הטיוטה שלכם ממכשיר אחר.', 'info');
        }
      } catch { /* אין טיוטה משותפת או השרת הישן */ }
    }
    if (!A.data.settings) A.data.settings = S.admin.normSettings({});
    if (CLOUD && S.sb.user?.isAdmin && !A.surveys) { try { A.surveys = (await S.sb.surveys()).surveys; } catch { A.surveys = []; } }
    paintStatus(); render();
  }

  async function checkAccess() {
    let allowed = false;
    try { allowed = await S.sb.isAdmin(); } catch { /* מציגים את השער */ }
    document.body.classList.toggle('admin-locked', !allowed);
    $('#admin-gate').hidden = allowed;
    const u = S.sb.user;
    $('#admin-gate-text').textContent = u
      ? `החשבון ${u.email || ''} מחובר, אבל אינו מוגדר כמנהל. האזור האישי פתוח לכם.`
      : 'הניהול פתוח למנהלי התוכנית בלבד. היכנסו עם חשבון Google.';
    $('#gate-login').hidden = true;
    $('#gate-google').hidden = !!u;
    $('#gate-fallback').hidden = !!u || !CLOUD;
    if (!u && !allowed && CLOUD) mountGate();
    paintHeader();
    return allowed;
  }
  async function afterLogin() {
    const ok = await checkAccess();
    U.notify(ok ? 'ברוכים הבאים לניהול.' : 'התחברתם, אבל החשבון הזה אינו מוגדר כמנהל.', ok ? 'success' : 'info');
    if (ok) { await loadOrigin(); maybeGuide(); loadListeners(); }
  }
  let gateMounted = false;
  async function mountGate() {
    if (gateMounted) return; gateMounted = true;
    try { await S.sb.google($('#gate-google'), { onDone: afterLogin, onError: (err) => U.notify(`ההתחברות לא הצליחה: ${err.message}`, 'error') }); }
    catch (err) { gateMounted = false; $('#gate-google').innerHTML = `<span class="cue-hint">${esc(err.message)}</span>`; $('#gate-login').hidden = false; }
  }
  const viaSite = async (e) => { e?.preventDefault(); try { await S.sb.signIn(); await afterLogin(); } catch (err) { U.notify(`ההתחברות לא הצליחה: ${err.message}`, 'error'); } };
  $('#gate-login').addEventListener('click', viaSite);
  $('#gate-login-site').addEventListener('click', viaSite);

  /* ---------- לשוניות ---------- */

  function setTab(tab, { push = true } = {}) {
    if (!TABS.includes(tab)) tab = 'programs';
    A.tab = tab;
    $$('#admin-tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
    if (push && location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
    // בדף המשותף: מעבר פנימי (למשל "פתיחה" מבדיקת התקינות) מסמן גם את תפריט הצד
    if (EMBED && push && CLOUD) { try { window.parent.postMessage({ type: 'rosh-admin-tab-changed', tab }, new URL(S.sb.cfg.apiBase).origin); } catch { /* */ } }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.addEventListener('hashchange', () => setTab(location.hash.slice(1) || 'programs', { push: false }));
  $('#admin-tabs').addEventListener('click', (e) => { const a = e.target.closest('[data-tab]'); if (!a) return; e.preventDefault(); setTab(a.dataset.tab); });

  function render() {
    ({ programs: renderPrograms, site: renderSite, listeners: renderListeners, publish: renderPublish })[A.tab]();
  }

  /* ---------- עזרים משותפים ---------- */

  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || 0) - (a.number || 0);
  const cur = () => A.data.episodes.find((e) => e.id === A.selected) || null;
  const label = (e) => (e.title || '').trim() || 'תוכנית בלי שם';
  const splitList = (v) => String(v).split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  const when = (unix) => new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(typeof unix === 'number' ? unix * 1000 : unix));
  const n2 = (n) => Number(n || 0).toLocaleString('he-IL');

  function uniqueSlug(base, selfId) {
    const root = slugify(base) || 'episode';
    let s = root, n = 2;
    while (A.data.episodes.some((x) => x.slug === s && x.id !== selfId)) s = `${root}-${n++}`;
    return s;
  }
  function uniqueSeasonId(base) {
    const root = slugify(base) || 'season';
    let s = root, n = 2;
    while (A.data.seasons.some((x) => x.id === s)) s = `${root}-${n++}`;
    return s;
  }
  function seasonOptions(val, withNew = true) {
    return `<option value="">בלי עונה</option>${A.data.seasons.map((s) => `<option value="${esc(s.id)}" ${s.id === val ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}${withNew ? '<option value="__new">+ עונה חדשה…</option>' : ''}`;
  }
  function select(id, { tab } = {}) {
    A.selected = id;
    if (tab && tab !== A.tab) { setTab(tab); return; }
    if (A.tab === 'programs') { renderList(); renderEditor(); $('#editor')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else render();
  }
  function stateOf(e) {
    if (!e.visible) return { cls: 'hidden', text: 'מוסתרת' };
    if (S.scheduled(e)) return { cls: 'scheduled', text: `תעלה ב־${when(e.publishAt)}` };
    return { cls: 'live', text: 'מוצגת' };
  }

  /* ======================================================
     1. תוכניות
     ====================================================== */

  function renderPrograms() {
    $('#panel').innerHTML = `
<div class="workspace">
  <aside class="side" aria-label="רשימת התוכניות">
    <div class="card">
      <div class="side-head">
        <button type="button" class="btn primary" data-op="new" style="width:100%">+ תוכנית חדשה</button>
        <div class="search-box" role="search">
          <span class="search-glyph" aria-hidden="true">♫</span>
          <label for="ep-q" class="visually-hidden">חיפוש תוכנית</label>
          <input id="ep-q" type="search" placeholder="חיפוש תוכנית…" autocomplete="off" value="${esc(A.q)}">
        </div>
        <div class="filters" style="margin:10px 0 0">
          <label class="visually-hidden" for="ep-filter">סינון</label>
          <select id="ep-filter" class="input small-select">
            <option value="all">כל התוכניות</option>
            <option value="visible">מוצגות באתר</option>
            <option value="hidden">מוסתרות</option>
            <option value="scheduled">מתוזמנות</option>
            <option value="noaudio">בלי הקלטה</option>
            <option value="nocover">בלי תמונה</option>
          </select>
          <span class="count" id="ep-count"></span>
          <button type="button" class="chip" data-op="bulk" aria-pressed="${A.bulk}">${A.bulk ? '✕ סיום בחירה' : 'בחירה מרובה'}</button>
        </div>
        <div class="bulk-bar" id="bulk-bar" ${A.bulk ? '' : 'hidden'}></div>
      </div>
      <div class="ep-list" id="ep-list" role="listbox" aria-label="תוכניות"></div>
    </div>
  </aside>
  <section class="editor" id="editor"></section>
</div>`;
    $('#ep-filter').value = A.filter;
    renderList(); renderEditor();
  }

  function listFiltered() {
    let l = A.data.episodes.slice().sort(byDate);
    if (A.filter === 'visible') l = l.filter((e) => e.visible && !S.scheduled(e));
    if (A.filter === 'hidden') l = l.filter((e) => !e.visible);
    if (A.filter === 'scheduled') l = l.filter((e) => S.scheduled(e));
    if (A.filter === 'noaudio') l = l.filter((e) => !U.streamUrl(e));
    if (A.filter === 'nocover') l = l.filter((e) => !e.cover);
    if (A.q) l = S.searchEpisodes(A.q, l);
    return l;
  }
  function renderList() {
    const box = $('#ep-list'); if (!box) return;
    const l = listFiltered();
    $('#ep-count').textContent = l.length === A.data.episodes.length ? `${l.length} תוכניות` : `${l.length} מתוך ${A.data.episodes.length}`;
    box.innerHTML = l.length ? l.map((e) => {
      const st = stateOf(e);
      return `
<button type="button" class="ep-item${e.visible ? '' : ' hidden-ep'}${A.picked.has(e.id) ? ' picked' : ''}" role="option" data-id="${esc(e.id)}" aria-current="${A.selected === e.id}" aria-selected="${A.bulk ? A.picked.has(e.id) : A.selected === e.id}">
  ${A.bulk ? `<span class="pick-box" aria-hidden="true">${A.picked.has(e.id) ? '✓' : ''}</span>` : `<span class="num">${e.number ?? '♫'}</span>`}
  <span class="txt"><b>${esc(label(e))}</b><small>${esc(fmtDate(e.date, true) || 'בלי תאריך')} · <i class="st ${st.cls}">${esc(st.text)}</i></small></span>
  <span class="flags">${e.featured ? '<span class="flag featured" title="מומלצת בדף הבית"></span>' : ''}${U.streamUrl(e) ? '<span class="flag audio" title="יש הקלטה"></span>' : '<span class="flag none" title="בלי הקלטה"></span>'}</span>
</button>`; }).join('') : '<div class="state" style="padding:24px"><p>אין תוכניות שמתאימות לחיפוש.</p></div>';
    renderBulkBar();
  }
  function renderBulkBar() {
    const bar = $('#bulk-bar'); if (!bar) return;
    bar.hidden = !A.bulk;
    if (!A.bulk) return;
    const n = A.picked.size;
    bar.innerHTML = `
<span class="cue-hint">${n ? (n === 1 ? 'נבחרה תוכנית אחת' : `נבחרו ${n} תוכניות`) : 'לחצו על תוכניות כדי לבחור'}</span>
<button type="button" class="btn small" data-op="pick-all">${n === listFiltered().length && n ? 'ניקוי הבחירה' : 'בחירת כל המוצגות'}</button>
<div class="bulk-actions" ${n ? '' : 'hidden'}>
  <button type="button" class="btn small" data-op="bulk-show">הצגה באתר</button>
  <button type="button" class="btn small" data-op="bulk-hide">הסתרה</button>
  <select class="input small-select" data-op="bulk-season" aria-label="שיוך לעונה"><option value="">שיוך לעונה…</option>${A.data.seasons.map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')}<option value="__none">בלי עונה</option></select>
  <button type="button" class="btn small danger" data-op="bulk-del">מחיקה</button>
</div>`;
  }

  function renderEditor() {
    const E = $('#editor'); if (!E) return;
    const e = cur();
    if (!e) {
      E.innerHTML = `<div class="card"><div class="state empty-editor"><span class="mark">♫</span><h3>בחרו תוכנית מהרשימה</h3><p>או לחצו "+ תוכנית חדשה". כל שינוי נשמר מיד; כשמסיימים, לוחצים "פרסום לאתר".</p></div></div>`;
      return;
    }
    const stream = U.streamUrl(e);
    const st = stateOf(e);
    E.innerHTML = `
<div class="card">
  <div class="section-title">
    <div><p class="kicker">${e.number != null ? `תוכנית ${e.number}` : 'תוכנית'} · <i class="st ${st.cls}">${esc(st.text)}</i></p><h2 id="ed-title-echo">${esc(label(e))}</h2></div>
    <div class="inline-toggles">
      <a class="btn small" href="episode.html?ep=${encodeURIComponent(e.slug)}" target="_blank" rel="noopener">צפייה באתר</a>
      <button type="button" class="btn small" data-op="share">טקסט לוואטסאפ</button>
      <button type="button" class="btn small" data-op="dup">שכפול</button>
      <button type="button" class="btn small" data-op="history" ${CLOUD ? '' : 'disabled'}>גרסאות קודמות</button>
      <button type="button" class="btn small danger" data-op="del">מחיקה</button>
    </div>
  </div>
  <div class="card-body">
    <div class="form-grid">
      <label class="field span2"><span>שם התוכנית</span><input data-f="title" value="${esc(e.title)}" placeholder="למשל: שירי הסתיו" autocomplete="off"><small>כך התוכנית תופיע באתר.</small></label>
      <label class="field"><span>תאריך השידור</span><input data-f="date" type="date" value="${esc(e.date)}"></label>
      <label class="field"><span>מספר התוכנית</span><input data-f="number" type="number" inputmode="numeric" value="${e.number ?? ''}" placeholder="90"></label>
      <label class="field"><span>עונה</span><select data-f="season">${seasonOptions(e.season)}</select></label>
      <label class="field"><span>אורחים</span><input data-f="guests" value="${esc(e.guests.join(', '))}" placeholder="שמות, מופרדים בפסיק"></label>
      ${CLOUD ? `<label class="field"><span>מקושרת למצעד (לא חובה)</span><select data-f="surveyId"><option value="">בלי מצעד</option>${(A.surveys || []).map((s) => `<option value="${esc(s.id)}" ${s.id === e.surveyId ? 'selected' : ''}>${esc(s.name)}${s.active ? ' · הפעיל' : ''}${s.open ? ' · ההצבעה פתוחה' : ''}</option>`).join('')}${e.surveyId && !(A.surveys || []).some((s) => s.id === e.surveyId) ? `<option value="${esc(e.surveyId)}" selected>מצעד שנמחק</option>` : ''}</select><small>דף התוכנית יציג קישור להצבעה כשהמצעד פתוח.</small></label>` : ''}
      <label class="field span2"><span>על התוכנית</span><textarea data-f="description" placeholder="כמה משפטים על מה שהיה בתוכנית. שורה ריקה פותחת פסקה חדשה.">${esc(e.description)}</textarea></label>
    </div>
    <div class="switches">
      <button type="button" class="toggle${e.visible ? ' on' : ''}" data-op="visible" aria-pressed="${e.visible}">${e.visible ? '✓ מוצגת באתר' : 'מוסתרת מהאתר'}</button>
      <button type="button" class="toggle${e.featured ? ' on' : ''}" data-op="featured" aria-pressed="${e.featured}">${e.featured ? '★ התוכנית המומלצת בדף הבית' : 'להציג כמומלצת בדף הבית'}</button>
    </div>
    <div class="schedule">
      <label class="field"><span>פרסום מתוזמן (לא חובה)</span><input data-f="publishAt" type="datetime-local" value="${esc(e.publishAt)}"><small>${e.publishAt ? (S.scheduled(e) ? `התוכנית תופיע באתר ב־${when(e.publishAt)}. עד אז המאזינים לא רואים אותה, גם אחרי פרסום.` : 'המועד עבר — התוכנית מוצגת כרגיל.') : 'ריק = מופיעה מיד אחרי הפרסום.'}</small></label>
      ${e.publishAt ? '<button type="button" class="btn small" data-op="unschedule">ביטול התזמון</button>' : ''}
    </div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">ההקלטה</p><h2>מה שומעים</h2></div>${e.duration ? `<strong>${esc(fmtDuration(e.duration))}</strong>` : ''}</div>
  <div class="card-body">
    <div class="media-state${stream ? ' ok' : ''}">${stream ? '✓ יש הקלטה לתוכנית הזו. המאזינים שומעים אותה בנגן של האתר.' : 'עדיין אין הקלטה. העלו קובץ או הדביקו קישור.'}</div>
    ${stream ? `<audio class="audio-preview" id="preview-audio" controls preload="metadata" src="${esc(stream)}"></audio>` : ''}
    <div class="form-grid">
      <label class="field"><span>${stream ? 'החלפת ההקלטה — העלאת קובץ' : 'העלאת קובץ ההקלטה'}</span><input type="file" data-upload="audio" accept=".mp3,.m4a,.wav,.ogg,.flac,.aac"><small>קובץ שמע (MP3 וכו') בכל גודל עד 1GB — גם תוכנית של שעתיים. קובץ גדול עולה בחלקים.</small><span class="upload-status" role="status" data-upload-status="audio"></span></label>
      <label class="field"><span>או קישור להקלטה</span><input data-f="audio" value="${esc(e.audio)}" placeholder="https://…" spellcheck="false" class="ltr"><small>קישור שיתוף לקובץ בדרייב מספיק.</small></label>
    </div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">התמונה</p><h2>מה רואים</h2></div></div>
  <div class="card-body">
    <div class="cover-grid">
      ${e.cover ? `<img class="cover-preview" src="${esc(e.cover)}" alt="">` : '<div class="cover-preview empty"><span>♫</span><small>בלי תמונה האתר מציג עטיפה צבעונית משלו</small></div>'}
      <div class="cover-fields">
        <div class="field"><span>יצירת תמונה אוטומטית</span><div class="actions" style="margin:0"><button type="button" class="btn gold" data-op="cover-auto">${e.cover ? 'יצירת תמונה חדשה' : 'ליצור תמונה עכשיו'}</button></div><small>עטיפה בסגנון האתר עם שם התוכנית, המספר ומשפט מהתיאור. אפשר ללחוץ שוב לגרסה אחרת.</small><span class="upload-status" role="status" data-upload-status="auto"></span></div>
        <label class="field"><span>העלאת תמונה משלכם</span><input type="file" data-upload="cover" accept=".jpg,.jpeg,.png,.webp"><span class="upload-status" role="status" data-upload-status="cover"></span></label>
        <label class="field"><span>או קישור לתמונה</span><input data-f="cover" value="${esc(e.cover)}" placeholder="https://…" spellcheck="false" class="ltr"></label>
        ${e.cover ? '<button type="button" class="btn small" data-op="cover-clear">הסרת התמונה</button>' : ''}
      </div>
    </div>
  </div>
</div>

<details class="card more-details">
  <summary>עוד פרטים (לא חובה)</summary>
  <div class="card-body">
    <label class="field"><span>מילות חיפוש</span><input data-f="tags" value="${esc(e.tags.join(', '))}" placeholder="למשל: מצעד, ראיון, חנוכה"><small>עוזרות למאזינים למצוא את התוכנית בחיפוש. מופרדות בפסיק.</small></label>
    <div class="field" style="margin-top:16px">
      <span>קישורים שיופיעו בדף התוכנית</span>
      <div class="link-rows" id="link-rows">${renderLinks(e)}</div>
      <div><button type="button" class="btn small" data-op="link-add">+ קישור</button></div>
    </div>
  </div>
</details>

${aiCard(e)}

<div class="card">
  <div class="section-title"><div><p class="kicker">כך זה ייראה</p><h2>באתר</h2></div></div>
  <div class="card-body"><div class="preview-wrap"><div id="preview-card"></div><p class="help">זה הכרטיס של התוכנית בדף הבית ובארכיון.</p></div></div>
</div>`;
    renderPreview(); paintAi();
  }

  function renderLinks(e) {
    return e.links.map((l, i) => `
<div class="link-row" data-i="${i}">
  <input data-lf="label" data-i="${i}" value="${esc(l.label)}" placeholder="מה זה? (למשל: הפלייליסט)" aria-label="שם הקישור">
  <input class="u" data-lf="url" data-i="${i}" value="${esc(l.url)}" placeholder="https://…" aria-label="כתובת" spellcheck="false">
  <button type="button" class="icon-btn del" data-op="link-del" data-i="${i}" aria-label="מחיקת הקישור">✕</button>
</div>`).join('') || '<p class="cue-hint" style="margin:0 0 8px">אין קישורים.</p>';
  }
  function renderPreview() {
    const e = cur(); const box = $('#preview-card'); if (!e || !box) return;
    box.innerHTML = U.epCard(S.admin.normEpisode(e, 0), { href: '#' });
    $('#ed-title-echo').textContent = label(e);
  }
  const schedulePreview = () => { clearTimeout(A.previewTimer); A.previewTimer = setTimeout(() => { renderPreview(); renderList(); }, 200); };

  function newEpisode() {
    const today = new Date().toISOString().slice(0, 10);
    const maxNum = A.data.episodes.reduce((m, e) => Math.max(m, e.number || 0), 0);
    const latestSeason = A.data.seasons.slice().sort((a, b) => (b.year || 0) - (a.year || 0))[0];
    const e = { id: `ep-${Date.now().toString(36)}`, slug: '', number: maxNum + 1, season: latestSeason?.id || '', title: '', date: today, description: '', cover: '', audio: '', duration: 0, tags: [], guests: [], links: [], featured: false, visible: true, tracks: [], publishAt: '' };
    e.slug = uniqueSlug(today, e.id);
    A.data.episodes.unshift(e);
    A.q = ''; A.filter = 'all'; A.bulk = false; A.picked.clear();
    touch();
    A.selected = e.id;
    if (A.tab !== 'programs') setTab('programs'); else renderPrograms();
    $('[data-f="title"]')?.focus();
  }
  function duplicate(e) {
    const c = clone(e);
    c.id = `ep-${Date.now().toString(36)}`; c.slug = uniqueSlug(`${e.slug}-2`, c.id); c.number = e.number != null ? e.number + 1 : null; c.featured = false; c.title = `${e.title} (עותק)`;
    A.data.episodes.unshift(c); touch(); select(c.id); U.notify('התוכנית שוכפלה. זה העותק — ערכו אותו.', 'success');
  }
  function removeMany(ids) {
    const gone = [];
    ids.forEach((id) => { const i = A.data.episodes.findIndex((x) => x.id === id); if (i >= 0) gone.push({ i, e: A.data.episodes.splice(i, 1)[0] }); });
    if (gone.some((g) => g.e.id === A.selected)) A.selected = null;
    A.picked.clear(); touch(); renderList(); renderEditor();
    U.notify(gone.length === 1 ? `"${label(gone[0].e)}" נמחקה.` : `${gone.length} תוכניות נמחקו.`, 'success', { action: 'ביטול', ttl: 9000, onAction: () => { gone.sort((a, b) => a.i - b.i).forEach((g) => A.data.episodes.splice(g.i, 0, g.e)); touch(); renderList(); renderEditor(); } });
  }
  function newSeasonInline(sel) {
    const title = prompt('איך לקרוא לעונה החדשה? (למשל: עונת 2027)');
    if (!title) { sel.value = cur()?.season || ''; return; }
    const year = (title.match(/\d{4}/) || [])[0];
    const s = { id: uniqueSeasonId(year || title), title: title.trim(), year: year ? Number(year) : null, note: '' };
    A.data.seasons.push(s);
    const e = cur(); if (e) e.season = s.id;
    touch(); renderEditor();
  }
  function shareText(e) {
    const url = new URL(`episode.html?ep=${encodeURIComponent(e.slug)}`, site.url || location.href).href;
    const first = (e.description || '').split(/\n+/)[0].trim().slice(0, 200);
    return [`🎙️ ${site.name || 'ראש בראש'}${e.number != null ? ` · תוכנית ${e.number}` : ''}`, `*${label(e)}*`, e.date ? fmtDate(e.date) : '', first, `להאזנה: ${url}`].filter(Boolean).join('\n');
  }

  /* ---------- תמונה אוטומטית: עטיפה בסגנון האתר על קנבס ---------- */

  /* העטיפה ריבועית (1400×1400) — כך היא מופיעה במלואה בדף התוכנית, במסך הנעילה
     ובתצוגה המקדימה בוואטסאפ. בכרטיסים (יחס 1.45) נחתכים רק הקצוות העליון
     והתחתון, ולכן כל הטקסט יושב ברצועה האמצעית שנשארת גלויה תמיד. */
  const COVER = 1400, SAFE_TOP = 250, SAFE_BOTTOM = 1150;
  async function drawCover(e) {
    try { await document.fonts.load('700 120px Karantina'); await document.fonts.load('800 30px Heebo'); } catch { /* גופן ברירת מחדל */ }
    const W = COVER, H = COVER, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const words = (e.description || '').split(/\s+/).filter((w) => w.length > 3);
    const seed = (e.id + e.title + words.slice(0, 6).join('')).split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7 + (A.coverTry || 0));
    const h1 = U.hue(e), h2 = (h1 + 40 + (seed % 80)) % 360, h3 = (h1 + 200 + (seed % 60)) % 360;
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, `hsl(${h1} 60% 14%)`); g.addColorStop(.55, `hsl(${h2} 55% 22%)`); g.addColorStop(1, `hsl(${h3} 60% 12%)`);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) { const px = W * ((seed >> (i * 3)) % 100) / 100, py = H * ((seed >> (i * 5)) % 100) / 100; const r = x.createRadialGradient(px, py, 0, px, py, 620); r.addColorStop(0, `hsl(${[h1, h2, h3][i]} 90% 65% / .35)`); r.addColorStop(1, 'transparent'); x.fillStyle = r; x.fillRect(0, 0, W, H); }
    // תקליט בצד שמאל, במרכז הרצועה
    const cx = 330 + (seed % 50), cy = (SAFE_TOP + SAFE_BOTTOM) / 2 + 30;
    for (let r = 290; r > 40; r -= 6) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.strokeStyle = r % 12 ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.08)'; x.lineWidth = 3; x.stroke(); }
    x.beginPath(); x.arc(cx, cy, 78, 0, Math.PI * 2); x.fillStyle = `hsl(${h1} 85% 62%)`; x.fill();
    x.beginPath(); x.arc(cx, cy, 8, 0, Math.PI * 2); x.fillStyle = '#0b0d14'; x.fill();
    // אקולייזר בתחתית
    for (let i = 0; i < 52; i++) { const bh = 30 + ((seed * (i + 3)) % 160); x.fillStyle = `hsl(${(h1 + i * 4) % 360} 90% 65% / .5)`; x.fillRect(W - 70 - i * 25, H - 40 - bh, 13, bh); }
    x.fillStyle = 'rgba(255,255,255,.035)'; for (let i = 0; i < 3500; i++) x.fillRect((seed * (i + 1) * 7919) % W, (seed * (i + 7) * 104729) % H, 2, 2);
    // טקסט (מימין לשמאל), כולו בתוך הרצועה הבטוחה
    const right = W - 80, textW = W - 80 - 700;
    x.direction = 'rtl'; x.textAlign = 'right'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#f0c65a'; x.font = '800 36px Heebo, Arial'; x.fillText(`${site.name || 'ראש בראש'}${e.number != null ? `  ·  תוכנית ${e.number}` : ''}`, right, SAFE_TOP + 60);
    x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 24;
    const title = label(e);
    let size = 150; x.font = `700 ${size}px Karantina, Impact, Arial`;
    while (size > 80 && wrap(x, title, textW).length > 3) { size -= 10; x.font = `700 ${size}px Karantina, Impact, Arial`; }
    const lines = wrap(x, title, textW).slice(0, 3);
    lines.forEach((ln, i) => x.fillText(ln, right, SAFE_TOP + 110 + size * .85 + i * (size * .92)));
    x.shadowBlur = 0;
    const sub = (e.description || '').split(/[.\n!?]/)[0].trim().slice(0, 90);
    x.fillStyle = 'rgba(255,255,255,.85)'; x.font = '700 34px Heebo, Arial';
    wrap(x, sub, textW).slice(0, 2).forEach((ln, i) => x.fillText(ln, right, SAFE_BOTTOM - 120 + i * 46));
    x.fillStyle = '#f0c65a'; x.font = '800 30px Heebo, Arial'; x.fillText(e.date ? fmtDate(e.date) : (site.tagline || ''), right, SAFE_BOTTOM - 20);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', .88));
  }
  async function autoCover(e, status) {
    status.textContent = 'מציירים…';
    const blob = await drawCover(e);
    const file = new File([blob], `cover-${e.slug || e.id}.jpg`, { type: 'image/jpeg' });
    if (CLOUD) {
      status.textContent = 'מעלים…';
      e.cover = await window.RoshUpload(file, e.id, 'cover', (pct) => { status.textContent = `מעלים — ${pct}%`; });
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      U.notify('התמונה ירדה למחשב. העלו אותה לאתר והדביקו את הקישור.', 'info');
    }
    A.coverTry = (A.coverTry || 0) + 1;
    touch(); renderEditor(); renderList();
  }
  function wrap(x, text, max) {
    const out = []; let line = '';
    for (const w of String(text).split(/\s+/).filter(Boolean)) { const t = line ? `${line} ${w}` : w; if (x.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line);
    return out;
  }

  /* ---------- עבודות על הרבה תוכניות בבת אחת: אורך, תמונות, תיאורים ----------
     רצות ברקע (אפשר להמשיך לעבוד), מתקדמות אחת־אחת, ואפשר לעצור באמצע.
     כל תוצאה נכנסת לטיוטה — ולאתר רק בלחיצה על "פרסום". */
  A.jobs = {};
  async function runJob(name, items, work, { concurrency = 1, label: what = 'תוכניות' } = {}) {
    if (A.jobs[name]?.running) return;
    const job = A.jobs[name] = { running: true, stop: false, done: 0, failed: 0, total: items.length, text: `0/${items.length}` };
    const paint = () => { job.text = `${job.done}/${job.total}${job.failed ? ` · ${job.failed} נכשלו` : ''}`; if (A.tab === 'publish') renderPublish(); };
    paint();
    let i = 0;
    const worker = async () => {
      while (i < items.length && !job.stop) {
        const it = items[i++];
        try { await work(it); } catch { job.failed++; }
        job.done++; paint(); touch();
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) || 1 }, worker));
    job.running = false; paint();
    renderList(); if (A.tab === 'programs') renderEditor();
    U.notify(job.stop ? `נעצר: ${job.done - job.failed} ${what} עודכנו.` : `הסתיים: ${job.done - job.failed} ${what} עודכנו${job.failed ? `, ${job.failed} נכשלו` : ''}. לחצו "פרסום" כדי שזה יופיע באתר.`, job.failed ? 'info' : 'success');
  }
  /** האורך של הקלטה, מתוך הקובץ עצמו (נקרא רק ראש הקובץ) */
  function measureDuration(url) {
    return new Promise((resolve, reject) => {
      const a = new Audio(); a.preload = 'metadata';
      const t = setTimeout(() => { a.src = ''; reject(new Error('timeout')); }, 30000);
      a.onloadedmetadata = () => { clearTimeout(t); const d = a.duration; a.src = ''; isFinite(d) && d > 0 ? resolve(Math.round(d)) : reject(new Error('no duration')); };
      a.onerror = () => { clearTimeout(t); reject(new Error('load error')); };
      a.src = url;
    });
  }
  const fillDurations = () => runJob('fill-durations', A.data.episodes.filter((e) => U.streamUrl(e) && !e.duration), async (e) => { e.duration = await measureDuration(U.streamUrl(e)); }, { concurrency: 3, label: 'אורכים' });
  const coversAll = () => runJob('covers-all', A.data.episodes.filter((e) => !e.cover), async (e) => {
    const blob = await drawCover(e);
    e.cover = await window.RoshUpload(new File([blob], `cover-${e.slug || e.id}.jpg`, { type: 'image/jpeg' }), e.id, 'cover', () => {});
  }, { concurrency: 2, label: 'תמונות' });

  /* ---------- AI: תמלול (רק למנהלים) ותיאור + סיכום שנוצרים ממנו ---------- */
  async function transcribe(e, onStep) {
    let part = 0, total = 1;
    while (part < total) {
      const r = await S.sb.call('/api/program/ai/transcribe', { method: 'POST', body: { episodeId: e.id, part } });
      total = Number(r.partsTotal) || 1; part++;
      onStep?.(part, total);
    }
  }
  async function summarize(e) {
    const r = await S.sb.call('/api/program/ai/summarize', { method: 'POST', body: { episodeId: e.id } });
    return r && typeof r.summary === 'object' && r.summary ? r.summary : r;
  }
  const uniq = (list) => [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
  function applySummary(e, sum) {
    e.description = [sum.description, sum.summary].map((x) => String(x || '').trim()).filter(Boolean).join('\n\n');
    e.tags = uniq([...e.tags, ...(sum.tags || [])]).slice(0, 12);
    e.guests = uniq([...e.guests, ...(sum.guests || [])]).slice(0, 12);
  }
  async function aiRun(e, { apply = false } = {}) {
    const st = A.ai.get(e.id) || {}; A.ai.set(e.id, st);
    const paint = () => { if (A.selected === e.id) paintAi(); };
    st.running = true; st.error = ''; st.text = 'מתמללים את ההקלטה…'; paint();
    try {
      let have = null;
      try { have = await S.sb.call(`/api/program/ai/transcript/${encodeURIComponent(e.id)}`); } catch { /* עוד אין */ }
      if (!have || !have.partsTotal || have.partsDone < have.partsTotal) await transcribe(e, (p, t) => { st.text = `מתמללים… ${Math.round(p / t * 100)}%`; paint(); });
      st.text = 'כותבים תיאור וסיכום…'; paint();
      st.summary = await summarize(e);
      st.text = '';
      if (apply) applySummary(e, st.summary);
    } catch (err) { st.error = err.message; st.text = ''; throw err; }
    finally { st.running = false; paint(); }
  }
  const aiAll = () => runJob('ai-all', A.data.episodes.filter((e) => U.streamUrl(e) && (!e.description.trim() || GENERIC_DESC.test(e.description.trim()))), (e) => aiRun(e, { apply: true }), { label: 'תיאורים' });

  function aiCard(e) {
    if (!CLOUD || !U.streamUrl(e)) return '';
    return `
<div class="card" id="ai-card">
  <div class="section-title"><div><p class="kicker">AI</p><h2>תיאור וסיכום מההקלטה</h2></div></div>
  <div class="card-body">
    <p class="help">המערכת מתמללת את ההקלטה, ומהתמלול כותבת תיאור, סיכום של מה שהיה בתוכנית, מילות חיפוש ושמות האורחים. התמלול עצמו גלוי רק למנהלים ולא מופיע באתר. תוכנית של שעה לוקחת כמה דקות.</p>
    <div id="ai-box"></div>
  </div>
</div>`;
  }
  function paintAi() {
    const box = $('#ai-box'); const e = cur(); if (!box || !e) return;
    const st = A.ai.get(e.id) || {};
    const sum = st.summary;
    box.innerHTML = `
<div class="actions" style="margin:0">
  <button type="button" class="btn gold" data-op="ai-run" ${st.running ? 'disabled' : ''}>${sum ? 'יצירה מחדש' : 'תמלול ויצירת תיאור'}</button>
  <button type="button" class="btn small" data-op="ai-transcript">הצגת התמלול</button>
</div>
${st.text ? `<p class="upload-status" role="status"><span class="notice-spinner" aria-hidden="true"></span> ${esc(st.text)}</p>` : ''}
${st.error ? `<p class="problems">${esc(st.error)}</p>` : ''}
${sum ? `<div class="ai-result">
  <p class="kicker">ההצעה</p>
  ${sum.description ? `<p><b>תיאור:</b> ${esc(sum.description)}</p>` : ''}
  ${sum.summary ? `<p style="white-space:pre-line"><b>סיכום:</b>\n${esc(sum.summary)}</p>` : ''}
  ${(sum.tags || []).length ? `<p><b>מילות חיפוש:</b> ${esc(sum.tags.join(', '))}</p>` : ''}
  ${(sum.guests || []).length ? `<p><b>אורחים:</b> ${esc(sum.guests.join(', '))}</p>` : ''}
  <div class="actions"><button type="button" class="btn primary" data-op="ai-apply">הכנסה לתוכנית <span>←</span></button><span class="cue-hint">התיאור והסיכום נכנסים לשדה "על התוכנית"; אפשר לערוך אחר כך.</span></div>
</div>` : ''}
${st.transcript != null ? `<details class="ai-transcript" open><summary>התמלול (למנהלים בלבד)</summary><div class="transcript-text">${esc(st.transcript) || 'עדיין אין תמלול.'}</div></details>` : ''}`;
  }

  /* ---------- גרסאות קודמות של תוכנית ---------- */

  async function versionData(id) {
    if (!A.versionCache.has(id)) A.versionCache.set(id, (await S.sb.versions.get(id)));
    return A.versionCache.get(id);
  }
  async function openHistory(e) {
    const dlg = $('#dlg-history'); $('#history-title').textContent = label(e); $('#history-body').innerHTML = '<p class="help">טוענים את הגרסאות…</p>'; dlg.showModal();
    try {
      if (!A.versions) A.versions = (await S.sb.versions.list()).versions;
      const rows = [];
      let prevKey = null;
      for (const v of A.versions) {
        const data = (await versionData(v.id)).data;
        const found = (data.episodes || []).find((x) => x.id === e.id);
        const k = found ? JSON.stringify(S.admin.normEpisode(found, 0)) : null;
        if (k !== prevKey) rows.push({ v, found });
        prevKey = k;
      }
      $('#history-body').innerHTML = rows.length ? `<p class="help">כל פרסום שבו התוכנית הזו השתנתה. "שחזור" מחזיר את התוכנית לטיוטה כפי שהייתה אז — ואז לוחצים פרסום.</p><div class="version-list">${rows.map(({ v, found }) => `
<div class="version"><div><b>${esc(when(v.createdAt))}</b><small>${found ? `${esc(found.title || 'בלי שם')}${found.date ? ` · ${esc(fmtDate(found.date, true))}` : ''}${found.cover ? ' · עם תמונה' : ''}` : 'התוכנית לא הייתה קיימת בגרסה הזו'}${v.by ? ` · פורסם על ידי ${esc(v.by)}` : ''}</small></div>${found ? `<button type="button" class="btn small" data-restore-ep="${esc(v.id)}">שחזור</button>` : ''}</div>`).join('')}</div>` : '<p class="help">עדיין אין גרסאות קודמות — הן נשמרות מעכשיו בכל פרסום.</p>';
    } catch (err) { $('#history-body').innerHTML = `<p class="problems">${esc(err.message)}</p>`; }
  }
  $('#history-body').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-restore-ep]'); if (!b) return;
    const e = cur(); if (!e) return;
    const found = ((await versionData(b.dataset.restoreEp)).data.episodes || []).find((x) => x.id === e.id);
    if (!found) return;
    Object.assign(e, S.admin.normEpisode(found, 0));
    touch(); renderEditor(); renderList(); $('#dlg-history').close(); U.notify('התוכנית שוחזרה לטיוטה. לחצו פרסום כדי להעלות לאתר.', 'success');
  });

  /* ======================================================
     2. האתר — הודעה, עדכונים, עונות
     ====================================================== */

  function renderSite() {
    const b = A.data.settings.banner || {};
    const ups = A.data.settings.updates || [];
    $('#panel').innerHTML = `
<div class="card">
  <div class="section-title"><div><p class="kicker">הודעה</p><h2>הודעה בראש האתר</h2></div><span class="toggle${b.enabled ? ' on' : ''}" aria-hidden="true">${b.enabled ? 'מוצגת' : 'כבויה'}</span></div>
  <div class="card-body">
    <p class="help">פס הודעה שמופיע בראש כל הדפים — למשל "התוכנית הבאה ביום חמישי" או ברכה לחג. נעלם לבד בתאריך שתבחרו.</p>
    <div class="form-grid">
      <label class="field span2"><span>ההודעה</span><input data-sf="text" value="${esc(b.text || '')}" maxlength="300" placeholder="למשל: התוכנית הבאה — יום חמישי ב־20:00"></label>
      <label class="field"><span>קישור (לא חובה)</span><input data-sf="link" value="${esc(b.link || '')}" placeholder="https://… או episode.html?ep=…" class="ltr"></label>
      <label class="field"><span>טקסט הכפתור</span><input data-sf="linkLabel" value="${esc(b.linkLabel || '')}" placeholder="לפרטים"></label>
      <label class="field"><span>להציג עד (לא חובה)</span><input data-sf="until" type="date" value="${esc(b.until || '')}"></label>
    </div>
    <div class="switches"><button type="button" class="toggle${b.enabled ? ' on' : ''}" data-op="banner-toggle" aria-pressed="${!!b.enabled}">${b.enabled ? '✓ ההודעה מוצגת' : 'להציג את ההודעה'}</button></div>
    <div class="banner-sites"><span class="cue-hint">איפה להציג:</span><label class="check"><input type="checkbox" data-bs="program" ${b.sites?.program !== false ? 'checked' : ''}> באתר התוכניות</label><label class="check"><input type="checkbox" data-bs="survey" ${b.sites?.survey ? 'checked' : ''}> באתר הסקר</label></div>
    ${b.enabled && b.text ? `<div class="banner-preview"><span class="kicker">כך זה נראה</span><div class="site-banner"><span class="site-banner-mark">✦</span><p>${esc(b.text)}</p>${b.link ? `<span class="btn small">${esc(b.linkLabel || 'לפרטים')} <span>←</span></span>` : ''}</div></div>` : ''}
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">דף העדכונים</p><h2>מה חדש</h2></div><strong>${ups.length}</strong></div>
  <div class="card-body">
    <p class="help">הודעות קצרות למאזינים בדף "עדכונים" באתר (הקישור מופיע בתפריט כשיש עדכונים). החדש ביותר למעלה; אפשר לנעוץ עדכון חשוב.</p>
    <div class="update-rows" id="update-rows">${renderUpdates(ups)}</div>
    <div class="track-tools"><button type="button" class="btn gold" data-op="update-add">+ עדכון חדש</button></div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">עונות</p><h2>סידור הארכיון</h2></div><strong>${A.data.seasons.length}</strong></div>
  <div class="card-body">
    <p class="help">עונה היא קבוצה של תוכניות — לפי שנה, לפי תקופה או לפי המגישים. בארכיון אפשר לסנן לפי עונה, ולכל תוכנית בוחרים עונה בטופס שלה.</p>
    <div class="season-rows" id="season-rows">${renderSeasonRows()}</div>
    <div class="track-tools">
      <button type="button" class="btn gold" data-op="season-add">+ עונה חדשה</button>
      <span class="cue-hint">מחיקת עונה לא מוחקת תוכניות — הן פשוט יישארו בלי עונה.</span>
    </div>
  </div>
</div>`;
  }
  function renderUpdates(ups) {
    if (!ups.length) return '<div class="state" style="padding:20px"><p>עדיין אין עדכונים.</p></div>';
    return ups.map((u, i) => `
<div class="update-row${u.pinned ? ' pinned' : ''}" data-i="${i}">
  <div class="update-head"><input data-uf="date" data-i="${i}" type="date" value="${esc(u.date)}" aria-label="תאריך" class="ltr"><input data-uf="title" data-i="${i}" value="${esc(u.title)}" placeholder="כותרת" aria-label="כותרת"><button type="button" class="chip" data-op="update-pin" data-i="${i}" aria-pressed="${!!u.pinned}">${u.pinned ? '📌 נעוץ' : 'נעיצה'}</button><button type="button" class="icon-btn del" data-op="update-del" data-i="${i}" aria-label="מחיקת העדכון">✕</button></div>
  <textarea data-uf="text" data-i="${i}" placeholder="תוכן העדכון" aria-label="תוכן">${esc(u.text)}</textarea>
  <input data-uf="link" data-i="${i}" value="${esc(u.link || '')}" placeholder="קישור (לא חובה)" aria-label="קישור" class="ltr">
</div>`).join('');
  }
  function renderSeasonRows() {
    const counts = {}; A.data.episodes.forEach((e) => { counts[e.season] = (counts[e.season] || 0) + 1; });
    if (!A.data.seasons.length) return '<div class="state" style="padding:24px"><p>עדיין אין עונות. הוסיפו אחת.</p></div>';
    return `<div class="season-head"><span>שם העונה</span><span>שנה</span><span>הערה</span><span>תוכניות</span><span></span></div>` + A.data.seasons.map((s, i) => `
<div class="season-row" data-i="${i}">
  <input data-zf="title" data-i="${i}" value="${esc(s.title)}" aria-label="שם העונה" placeholder="למשל: עונת 2026">
  <input data-zf="year" data-i="${i}" type="number" value="${s.year ?? ''}" aria-label="שנה" placeholder="2026" class="ltr center">
  <input data-zf="note" data-i="${i}" value="${esc(s.note)}" aria-label="הערה" placeholder="הערה (לא חובה)">
  <span class="pill">${counts[s.id] || 0}</span>
  <button type="button" class="icon-btn del" data-op="season-del" data-i="${i}" aria-label="מחיקת העונה">✕</button>
</div>`).join('');
  }

  /* ======================================================
     3. מאזינים — מספרים והודעות
     ====================================================== */

  async function loadListeners() {
    if (!CLOUD || !S.sb.user?.isAdmin) return;
    const [stats, messages, subs, push] = await Promise.allSettled([S.sb.stats(), S.sb.messages.list(), S.sb.subscribe.count(), S.sb.call('/api/program/push/count')]);
    A.pushCount = push.status === 'fulfilled' ? Number(push.value.total) || 0 : null;
    A.stats = stats.status === 'fulfilled' ? stats.value : { error: stats.reason?.message };
    A.messages = messages.status === 'fulfilled' ? messages.value : { error: messages.reason?.message };
    A.subs = subs.status === 'fulfilled' ? subs.value : null;
    const badge = $('#tab-unread'); const unread = A.messages?.unread || 0;
    badge.hidden = !unread; badge.textContent = unread;
    if (A.tab === 'listeners') renderListeners();
  }
  /* ---------- סטטיסטיקה מעמיקה: מאיפה מגיעים, מתי מאזינים, מה אוהבים, ועד איפה שומעים ---------- */
  const SOURCE_NAMES = { whatsapp: 'וואטסאפ', google: 'גוגל', facebook: 'פייסבוק', direct: 'ישיר (קישור או כתובת)', internal: 'מתוך האתר', other: 'אחר' };
  function hbars(rows) {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return `<div class="hbars">${rows.map((r) => `<div class="hbar"><span>${esc(r.label)}</span><i style="--w:${Math.round(r.n / max * 100)}%"></i><b>${n2(r.n)}</b></div>`).join('')}</div>`;
  }
  function deepStats(st) {
    const sources = (st.sources || []).filter((r) => Number(r.plays)).sort((a, b) => b.plays - a.plays);
    const hours = st.hours || [];
    const hmax = Math.max(1, ...hours.map((h) => Number(h.plays) || 0));
    const likes = (st.likes || []).filter((r) => Number(r.likes));
    const epName = (id) => { const e = A.data.episodes.find((x) => x.id === id); return e ? label(e) : 'תוכנית שנמחקה'; };
    const withAudio = A.data.episodes.filter((e) => U.streamUrl(e)).slice().sort(byDate);
    const ret = A.statsEp ? A.epStats.get(A.statsEp) : null;
    const rmax = Math.max(1, ...(ret?.retention || []).map((r) => Number(r.listeners) || 0));
    return `
<div class="two-col" style="margin-top:22px">
  <div><p class="kicker">מאיפה הגיעו המאזינים (30 יום)</p>${sources.length ? hbars(sources.map((r) => ({ label: SOURCE_NAMES[r.ref] || r.ref || 'אחר', n: Number(r.plays) || 0 }))) : '<p class="help">עוד אין נתונים — הם מתחילים להיאסף מעכשיו.</p>'}</div>
  <div><p class="kicker">באיזו שעה מאזינים (30 יום)</p>${hours.some((h) => Number(h.plays)) ? `<div class="bars hours" role="img" aria-label="האזנות לפי שעה ביום">${hours.map((h) => `<div class="bar" title="${String(h.hour).padStart(2, '0')}:00 — ${n2(h.plays)} האזנות"><i style="height:${Math.round((Number(h.plays) || 0) / hmax * 100)}%"></i><small>${Number(h.hour) % 3 ? '' : String(h.hour).padStart(2, '0')}</small></div>`).join('')}</div>` : '<p class="help">עוד אין נתונים.</p>'}</div>
</div>
<div class="two-col" style="margin-top:22px">
  <div><p class="kicker">הכי אהובות (♥)</p>${likes.length ? `<ol class="top-list">${likes.slice(0, 10).map((r) => `<li><span>${esc(epName(r.id))}</span><b>♥ ${n2(r.likes)}</b></li>`).join('')}</ol>` : '<p class="help">עוד אף אחד לא סימן "אהבתי".</p>'}</div>
  <div><p class="kicker">עד איפה מאזינים</p>
    <label class="visually-hidden" for="stats-ep">תוכנית</label>
    <select id="stats-ep" class="input small-select" style="width:100%"><option value="">בחרו תוכנית…</option>${withAudio.map((e) => `<option value="${esc(e.id)}" ${A.statsEp === e.id ? 'selected' : ''}>${esc(label(e))}</option>`).join('')}</select>
    ${A.statsEp ? (!ret ? '<p class="help">טוענים…</p>' : ret.error ? `<p class="problems">${esc(ret.error)}</p>` : (ret.retention || []).some((r) => Number(r.listeners)) ? `<div class="bars retention" role="img" aria-label="כמה מאזינים הגיעו לכל נקודה בתוכנית">${ret.retention.map((r) => `<div class="bar" title="${r.pct}% מהתוכנית: ${n2(r.listeners)} מאזינים"><i style="height:${Math.round((Number(r.listeners) || 0) / rmax * 100)}%"></i><small>${r.pct % 25 ? '' : `${r.pct}%`}</small></div>`).join('')}</div><p class="cue-hint">${n2(ret.listeners)} מאזינים · ${n2(ret.plays)} האזנות. כל עמודה: כמה מאזינים הגיעו לנקודה הזו בתוכנית. ירידה חדה = שם עוזבים.</p>` : '<p class="help">עוד אין מספיק נתונים לתוכנית הזו.</p>') : '<p class="help">בחרו תוכנית כדי לראות באיזה רגע מאזינים מפסיקים לשמוע.</p>'}
  </div>
</div>`;
  }
  async function loadEpStats(id) {
    A.statsEp = id; if (!id) { renderListeners(); return; }
    if (!A.epStats.has(id)) { renderListeners(); try { A.epStats.set(id, await S.sb.call(`/api/program/stats/episode/${encodeURIComponent(id)}`)); } catch (err) { A.epStats.set(id, { error: err.message }); } }
    if (A.tab === 'listeners') renderListeners();
  }
  function pushCard() {
    return `
<div class="card">
  <div class="section-title"><div><p class="kicker">התראות לטלפון</p><h2>הודעה לכל המאזינים</h2></div>${A.pushCount != null ? `<strong>${n2(A.pushCount)}</strong>` : ''}</div>
  <div class="card-body">
    <p class="help">${A.pushCount != null ? `${n2(A.pushCount)} מכשירים ביקשו לקבל התראות.` : 'מאזינים מפעילים התראות באזור האישי.'} בפרסום של תוכנית חדשה נשלחת התראה אוטומטית (אפשר לכבות את זה בכפתור הפרסום). כאן אפשר לשלוח הודעה משלכם.</p>
    <form class="push-form" data-push-send>
      <div class="form-grid">
        <label class="field span2"><span>כותרת</span><input name="title" maxlength="80" required placeholder="למשל: התוכנית החדשה עלתה!"></label>
        <label class="field span2"><span>הטקסט</span><input name="body" maxlength="180" placeholder="משפט קצר"></label>
        <label class="field span2"><span>לאן ההתראה פותחת</span><select name="url"><option value="">דף הבית</option>${A.data.episodes.filter((e) => e.visible && !S.scheduled(e)).slice().sort(byDate).slice(0, 40).map((e) => `<option value="episode.html?ep=${esc(encodeURIComponent(e.slug))}">${esc(label(e))}</option>`).join('')}</select></label>
      </div>
      <div class="actions"><button type="submit" class="btn primary">שליחה לכולם <span>←</span></button></div>
    </form>
  </div>
</div>`;
  }
  function renderListeners() {
    if (!CLOUD) { $('#panel').innerHTML = '<div class="card"><div class="state"><span class="mark">☺</span><h3>המאזינים</h3><p>הסטטיסטיקות וההודעות עובדות רק כשהאתר מחובר לשרת.</p></div></div>'; return; }
    const st = A.stats, ms = A.messages;
    const notReady = (o) => o?.error && /404|לא נמצא/.test(o.error);
    const epName = (id) => { const e = A.data.episodes.find((x) => x.id === id); return e ? label(e) : 'תוכנית שנמחקה'; };
    const days = st?.days || [];
    const max = Math.max(1, ...days.map((d) => Number(d.plays) || 0));
    const dayName = (iso) => new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00`));
    const statsHtml = !st ? '<p class="help">טוענים…</p>' : notReady(st) ? '<p class="problems">השרת עדיין לא עודכן לגרסה שאוספת סטטיסטיקות. אחרי העדכון המספרים יתחילו להצטבר כאן.</p>' : st.error ? `<p class="problems">${esc(st.error)}</p>` : `
<div class="stats admin-stats">
  <div class="stat"><b>${n2(st.week?.plays)}</b><small>האזנות בשבוע האחרון</small></div>
  <div class="stat"><b>${n2(st.week?.listeners)}</b><small>מאזינים בשבוע האחרון</small></div>
  <div class="stat"><b>${n2(st.totals?.plays)}</b><small>האזנות מאז ההתחלה</small></div>
  <div class="stat"><b>${n2(Math.round((Number(st.totals?.seconds) || 0) / 3600))}</b><small>שעות האזנה בסך הכול</small></div>
</div>
<p class="kicker" style="margin-top:20px">30 הימים האחרונים</p>
${days.length ? `<div class="bars" role="img" aria-label="האזנות לפי יום">${days.map((d) => `<div class="bar" title="${esc(dayName(d.day))}: ${n2(d.plays)} האזנות, ${n2(d.listeners)} מאזינים"><i style="height:${Math.round((Number(d.plays) || 0) / max * 100)}%"></i><small>${esc(dayName(d.day).slice(0, 5))}</small></div>`).join('')}</div>` : '<p class="help">עדיין אין האזנות שנרשמו. המספרים מתחילים להצטבר מהאזנה הראשונה באתר.</p>'}
<div class="two-col">
  <div><p class="kicker">הכי נשמעות ב־30 הימים האחרונים</p>${(st.recent || []).length ? `<ol class="top-list">${st.recent.slice(0, 10).map((r) => `<li><span>${esc(epName(r.id))}</span><b>${n2(r.plays)}</b></li>`).join('')}</ol>` : '<p class="help">אין עדיין נתונים.</p>'}</div>
  <div><p class="kicker">הכי נשמעות מאז ומעולם</p>${(st.episodes || []).length ? `<ol class="top-list">${st.episodes.slice(0, 10).map((r) => `<li><span>${esc(epName(r.id))}</span><b>${n2(r.plays)}</b></li>`).join('')}</ol>` : '<p class="help">אין עדיין נתונים.</p>'}</div>
</div>
<p class="cue-hint" style="margin-top:12px">מכשירים ב־30 הימים האחרונים: טלפון ${n2(st.devices?.phone)} · מחשב ${n2(st.devices?.desktop)}. הספירה אנונימית — בלי שמות ובלי כתובות.</p>
${deepStats(st)}`;
    const msgsHtml = !ms ? '<p class="help">טוענים…</p>' : notReady(ms) ? '<p class="problems">השרת עדיין לא עודכן לגרסה שמקבלת הודעות מהמאזינים.</p>' : ms.error ? `<p class="problems">${esc(ms.error)}</p>` : (ms.messages || []).length ? `<div class="msg-list">${ms.messages.map((m) => `
<div class="msg${m.readAt ? '' : ' unread'}" data-id="${esc(m.id)}">
  <div class="msg-head"><b>${esc(m.name || 'מאזין/ה')}</b>${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ''}<small>${esc(when(m.createdAt))}${m.episodeId ? ` · על "${esc(epName(m.episodeId))}"` : ''}</small></div>
  <p>${esc(m.text)}</p>
  <div class="msg-ops"><button type="button" class="btn small" data-op="msg-read" data-id="${esc(m.id)}" data-read="${m.readAt ? '0' : '1'}">${m.readAt ? 'סימון כלא נקרא' : '✓ נקרא'}</button>${m.email ? `<a class="btn small" href="mailto:${esc(m.email)}?subject=${encodeURIComponent('תשובה מראש בראש')}">תשובה במייל</a>` : ''}<button type="button" class="btn small danger" data-op="msg-del" data-id="${esc(m.id)}">מחיקה</button></div>
</div>`).join('')}</div>` : '<div class="state" style="padding:20px"><p>עדיין לא הגיעו הודעות. המאזינים כותבים דרך "כתבו לנו" בדף הבית ובדפי התוכניות.</p></div>';
    $('#panel').innerHTML = `
<div class="card">
  <div class="section-title"><div><p class="kicker">מספרים</p><h2>מי מאזין</h2></div><button type="button" class="btn small" data-op="reload-listeners">רענון</button></div>
  <div class="card-body">${statsHtml}</div>
</div>
<div class="card">
  <div class="section-title"><div><p class="kicker">הודעות</p><h2>מה המאזינים כותבים</h2></div>${ms?.unread ? `<strong>${ms.unread}</strong>` : ''}</div>
  <div class="card-body">${msgsHtml}</div>
</div>
${pushCard()}
<div class="card">
  <div class="section-title"><div><p class="kicker">רשימת התפוצה</p><h2>נשארים בראש</h2></div>${A.subs ? `<strong>${n2(A.subs.active)}</strong>` : ''}</div>
  <div class="card-body"><p class="help">${A.subs ? `${n2(A.subs.active)} נרשמים פעילים, מהם ${n2(A.subs.fromProgram)} שנרשמו דרך אתר התוכניות. זו אותה רשימה של אתר הסקר — ניהול הרשימה והורדה לאקסל נעשים שם, בלשונית "רשימת תפוצה".` : 'המאזינים מצטרפים בלחיצה אחת עם חשבון Google בדף הבית ובאזור האישי. הרשימה משותפת עם אתר הסקר.'}</p>${site.storage?.cloudflare?.apiBase ? `<a class="btn small" href="${esc(new URL(site.storage.cloudflare.apiBase).origin)}/admin" target="_blank" rel="noopener">לניהול הרשימה באתר הסקר</a>` : ''}</div>
</div>`;
  }

  /* ======================================================
     4. פרסום — בדיקה, העברה לאתר, גרסאות, כלים מתקדמים
     ====================================================== */

  function renderPublish() {
    const ch = changes(), hc = health();
    const u = S.sb.user;
    const list = [];
    if (ch) {
      if (ch.added) list.push(ch.added === 1 ? 'תוכנית אחת חדשה' : `${ch.added} תוכניות חדשות`);
      if (ch.changed) list.push(ch.changed === 1 ? 'תוכנית אחת עודכנה' : `${ch.changed} תוכניות עודכנו`);
      if (ch.removed.length) list.push(ch.removed.length === 1 ? `תוכנית אחת תימחק מהאתר (${esc(label(ch.removed[0]))})` : `${ch.removed.length} תוכניות יימחקו מהאתר`);
      if (ch.seasons) list.push('העונות השתנו');
      if (ch.settings) list.push('ההודעה או העדכונים השתנו');
    }
    let title, text;
    if (!A.origin && A.originError) { title = 'האתר לא זמין כרגע'; text = 'לא הצלחנו לקרוא מה מפורסם באתר. השינויים שלכם שמורים — נסו שוב בעוד רגע.'; }
    else if (!A.origin) { title = 'רגע…'; text = 'בודקים מה מפורסם באתר.'; }
    else if (!ch.any) { title = 'הכול מפורסם'; text = 'האתר מציג בדיוק את מה שיש כאן. אין מה לפרסם.'; }
    else { title = 'יש שינויים שמחכים לפרסום'; text = 'עד הפרסום, השינויים נראים רק לכם (ולמי שקיבל קישור תצוגה מקדימה).'; }
    const canPublish = !!ch?.any && !hc.must.length && (CLOUD ? !!u : true);
    const checkRow = (kind, titleText, hint) => {
      const r = A.checks[kind];
      return `<div class="tool"><div><b>${titleText}</b><small>${r ? (r.running ? `בודקים… ${r.done}/${r.total}` : r.problems.length ? `${r.problems.length} בעיות נמצאו:` : `✓ הכול תקין (${r.total} נבדקו)`) : hint}</small>${r && !r.running && r.problems.length ? `<ul class="check-list">${r.problems.map((p) => `<li><button type="button" class="link-btn" data-op="open" data-id="${esc(p.id)}">${esc(p.text)}</button></li>`).join('')}</ul>` : ''}</div><button type="button" class="btn small" data-op="check-${kind}" ${r?.running ? 'disabled' : ''}>${r ? 'בדיקה חוזרת' : 'בדיקה'}</button></div>`;
    };
    $('#panel').innerHTML = `
<div class="card pub-card${ch?.any ? ' pending' : ''}">
  <div class="card-body">
    <p class="kicker">פרסום</p>
    <h2 class="display">${title}</h2>
    <p class="help">${text}</p>
    ${list.length ? `<ul class="change-list">${list.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
    ${hc.must.length ? `<div class="problems"><b>לפני שמפרסמים, צריך לתקן:</b><ul>${hc.must.map((p) => `<li><button type="button" class="link-btn" data-op="open" data-id="${esc(p.id)}">${esc(p.text)}</button></li>`).join('')}</ul></div>` : ''}
    ${CLOUD && !u ? '<p class="problems">כדי לפרסם צריך להיות מחוברים. רעננו את הדף והיכנסו שוב.</p>' : ''}
    <div class="actions">
      <button type="button" class="btn xl primary" data-op="publish" ${canPublish ? '' : 'disabled'}>${CLOUD ? 'פרסום לאתר' : 'הורדת הקובץ לפרסום'} <span>←</span></button>
      ${CLOUD && ch?.added ? `<label class="check notify-check"><input type="checkbox" id="pub-notify" ${A.notify ? 'checked' : ''}> לשלוח התראה לטלפון של המאזינים על התוכניות החדשות</label>` : ''}
      ${ch?.any ? '<button type="button" class="btn" data-op="discard">ביטול כל השינויים</button>' : ''}
      ${!A.origin ? '<button type="button" class="btn" data-op="reload">בדיקה חוזרת</button>' : ''}
    </div>
    ${CLOUD ? '' : '<p class="cue-hint" style="margin-top:14px">האתר הזה לא מחובר לשרת. הפרסום מוריד קובץ אחד — מוסרים אותו למי שמתחזק את האתר.</p>'}
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">בדיקת תקינות</p><h2>מה כדאי להשלים</h2></div><strong>${hc.should.length + hc.dup.length}</strong></div>
  <div class="card-body">
    ${hc.should.length || hc.dup.length ? `
    ${hc.dup.length ? `<div class="problems soft"><b>כפילויות:</b><ul>${hc.dup.map((d) => `<li>${esc(d.text)} — ${d.ids.map((id, i) => `<button type="button" class="link-btn" data-op="open" data-id="${esc(id)}">פתיחה ${i + 1}</button>`).join(' · ')}</li>`).join('')}</ul></div>` : ''}
    <div class="health-groups">${Object.entries(HEALTH_GROUPS).map(([kind, g]) => {
      const items = hc.should.filter((p) => p.kind === kind);
      if (!items.length) return '';
      const job = A.jobs?.[g.fix];
      return `<div class="health-group"><div class="hg-head"><b>${items.length}</b><span>${g.title}</span>${g.fix && (!g.cloud || CLOUD) ? (job?.running ? `<span class="cue-hint"><span class="notice-spinner" aria-hidden="true"></span> ${esc(job.text)}</span><button type="button" class="btn small" data-op="job-stop" data-job="${g.fix}">עצירה</button>` : `<button type="button" class="btn small gold" data-op="${g.fix}">${g.fixLabel}</button>`) : ''}</div>
        <details><summary>הצגת הרשימה</summary><ul class="check-list">${items.slice(0, 120).map((p) => `<li><button type="button" class="link-btn" data-op="open" data-id="${esc(p.id)}">${esc(label(A.data.episodes.find((x) => x.id === p.id) || { title: p.text }))}</button></li>`).join('')}${items.length > 120 ? `<li>ועוד ${items.length - 120}…</li>` : ''}</ul></details></div>`;
    }).join('')}</div>
    <p class="cue-hint">אלה לא חוסמים פרסום — רק הצעות. תוכניות בלי הקלטה ובלי תמונה עדיין מופיעות באתר.</p>` : '<p class="help">✓ לכל התוכניות יש שם, תאריך, תיאור, הקלטה, אורך ותמונה, ואין כפילויות.</p>'}
    <div class="tool-list" style="margin-top:14px">
      ${checkRow('audio', 'בדיקת ההקלטות', 'עובר על כל ההקלטות ומוודא שהן נטענות בנגן.')}
      ${checkRow('media', 'בדיקת תמונות וקישורים', 'מוודא שכל התמונות נטענות ושהקישורים בדפי התוכניות עונים.')}
    </div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">גיבוי אוטומטי</p><h2>גרסאות קודמות</h2></div><button type="button" class="btn small" data-op="versions" ${CLOUD ? '' : 'disabled'}>${A.versions ? 'רענון' : 'הצגת הגרסאות'}</button></div>
  <div class="card-body">
    <p class="help">כל פרסום נשמר אוטומטית כגרסה. אם משהו השתבש, בוחרים גרסה, לוחצים "שחזור" — והכול חוזר לטיוטה כפי שהיה. אחר כך לוחצים פרסום.${CLOUD ? ' הגיבוי המלא של שני האתרים יחד (הסקר והתוכניות) נמצא בניהול הסקר, בלשונית "ארכיון וגיבויים".' : ''}</p>
    ${!CLOUD ? '<p class="cue-hint">עובד רק כשהאתר מחובר לשרת.</p>' : A.versions === null ? '' : A.versions.length ? `<div class="version-list">${A.versions.map((v, i) => `<div class="version"><div><b>${esc(when(v.createdAt))}${i === 0 ? ' <span class="pill gold">הגרסה שבאתר</span>' : ''}</b><small>${n2(v.episodes)} תוכניות${v.by ? ` · פורסם על ידי ${esc(v.by)}` : ''}</small></div><button type="button" class="btn small" data-op="restore-version" data-id="${esc(v.id)}">שחזור</button></div>`).join('')}</div>` : '<p class="help">עדיין אין גרסאות שמורות — הראשונה תישמר בפרסום הבא.</p>'}
  </div>
</div>

<details class="card more-details">
  <summary>כלים מתקדמים</summary>
  <div class="card-body tool-list">
    ${CLOUD ? `<div class="tool"><div><b>קישור לתצוגה מקדימה</b><small>שולחים למישהו קישור, והוא רואה את האתר עם הטיוטה — לפני שמפרסמים. הקישור עובד עד הפרסום הבא.</small><div id="preview-link"></div></div><button type="button" class="btn small" data-op="preview-link">יצירת קישור</button></div>` : ''}
    <div class="tool"><div><b>קובץ גיבוי</b><small>קובץ אחד עם כל התוכניות, העונות וההגדרות. כדאי לשמור עותק במחשב מדי פעם.</small></div><button type="button" class="btn small" data-op="backup">הורדת גיבוי</button></div>
    <div class="tool"><div><b>שחזור מקובץ גיבוי</b><small>מחליף את כל מה שכאן בתוכן של קובץ גיבוי ששמרתם בעבר. אחר כך לוחצים פרסום.</small></div><button type="button" class="btn small" data-op="restore">בחירת קובץ…</button></div>
    ${CLOUD ? '<div class="tool"><div><b>העברת ההקלטות לאתר</b><small>מעתיק את ההקלטות מהדרייב לאחסון של האתר, כדי שינוגנו מהר יותר ולא יהיו תלויות בדרייב. אפשר לעצור ולהמשיך אחר כך.</small></div><button type="button" class="btn small" data-op="migrate">פתיחה</button></div>' : ''}
    ${CLOUD ? `<div class="tool"><div><b>מי מנהל</b><small>מי שמופיע כאן יכול להיכנס לניהול — גם באתר הסקר. זו אותה רשימה.</small><div id="admins-box">${renderAdmins()}</div></div><button type="button" class="btn small" data-op="admins">${A.admins ? 'רענון' : 'הצגה'}</button></div>` : ''}
    <div class="tool"><div><b>החשבון</b><small>${u ? `מחוברים כ־${esc(u.email || u.name || '')}` : 'לא מחוברים'}</small></div>${u ? '<button type="button" class="btn small" data-op="logout">התנתקות</button>' : ''}</div>
  </div>
</details>`;
  }
  function renderAdmins() {
    if (!A.admins) return '';
    if (A.admins.error) return `<p class="problems" style="margin-top:8px">${esc(A.admins.error)}</p>`;
    return `<p class="cue-hint" style="margin:8px 0 0">אותה רשימה כמו בלשונית "הרשאות" באתר הסקר. התנתקות במקום אחד מנתקת משניהם.</p><ul class="admin-list">${A.admins.map((a) => `<li><span>${esc(a.email)}${a.you ? ' <span class="pill gold">אתם</span>' : ''}${a.fixed ? ' <span class="pill">קבוע</span>' : ''}${a.lastSeen ? `<small class="seen">נכנס לאחרונה: ${esc(when(a.lastSeen))}</small>` : ''}</span>${a.you || a.fixed ? '' : `<button type="button" class="icon-btn del" data-op="admin-del" data-email="${esc(a.email)}" aria-label="הסרה">✕</button>`}</li>`).join('')}</ul><form class="admin-add" data-admin-add><input type="email" required placeholder="כתובת Gmail של מנהל חדש" class="ltr"><button type="submit" class="btn small">הוספה</button></form>`;
  }

  /* ---------- בדיקות: הקלטות, תמונות וקישורים ---------- */

  async function runCheck(kind) {
    const items = kind === 'audio'
      ? A.data.episodes.filter((e) => U.streamUrl(e)).map((e) => ({ e, url: U.streamUrl(e), what: 'ההקלטה' }))
      : A.data.episodes.flatMap((e) => [...(e.cover ? [{ e, url: e.cover, what: 'התמונה', img: true }] : []), ...U.publicLinks(e).map((l) => ({ e, url: l.url, what: `הקישור "${l.label}"`, masc: true }))]);
    const r = A.checks[kind] = { running: true, total: items.length, done: 0, problems: [] };
    renderPublish();
    const probe = async (it) => {
      if (it.img) return new Promise((res) => { const im = new Image(); const t = setTimeout(() => res(false), 15000); im.onload = () => { clearTimeout(t); res(true); }; im.onerror = () => { clearTimeout(t); res(false); }; im.src = it.url; });
      try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(it.url, { method: kind === 'audio' ? 'GET' : 'HEAD', headers: kind === 'audio' ? { Range: 'bytes=0-1' } : {}, mode: kind === 'audio' ? 'cors' : 'no-cors', signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (res.type === 'opaque') return true;   // אתר אחר שלא מאפשר לבדוק — ענה, וזה מספיק
        return res.ok || res.status === 206;
      } catch { return false; }
    };
    let i = 0;
    const worker = async () => { while (i < items.length) { const it = items[i++]; const ok = await probe(it); if (!ok) r.problems.push({ id: it.e.id, text: `${it.what} של "${label(it.e)}" לא ${it.masc ? 'נטען' : 'נטענת'}` }); r.done++; if (A.tab === 'publish' && r.done % 5 === 0) renderPublish(); } };
    await Promise.all([worker(), worker(), worker()]);
    r.running = false; if (A.tab === 'publish') renderPublish();
    U.notify(r.problems.length ? `הבדיקה הסתיימה: ${r.problems.length} בעיות.` : 'הבדיקה הסתיימה: הכול תקין.', r.problems.length ? 'info' : 'success');
  }

  /* ---------- גיבוי, שחזור, פרסום ---------- */

  function backupFile() {
    const text = S.admin.export(A.data);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = CLOUD ? `rosh-berosh-backup-${new Date().toISOString().slice(0, 10)}.json` : 'episodes.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('#file-restore').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    let raw; try { raw = JSON.parse(await f.text()); } catch { U.notify('זה לא קובץ גיבוי של האתר.', 'error'); return; }
    const errs = S.admin.validate(raw);
    if (errs.length) { U.notify(`הקובץ לא תקין: ${errs[0]}`, 'error'); return; }
    if (!confirm(`לשחזר ${raw.episodes.length} תוכניות מהקובץ? כל מה שיש כאן עכשיו יוחלף (עד הפרסום זה נראה רק לכם).`)) return;
    applyData(raw); U.notify('הגיבוי שוחזר. בדקו את האתר ואז לחצו פרסום.', 'success');
  });
  function applyData(raw) {
    A.data = S.admin.normalize(raw);
    if (!raw.settings && A.origin) A.data.settings = clone(A.origin.settings || S.admin.normSettings({}));
    A.selected = A.data.episodes.some((e) => e.id === A.selected) ? A.selected : null;
    A.picked.clear(); touch(); render();
  }

  async function publish(btn) {
    const hc = health();
    if (hc.must.length) { U.notify(hc.must[0].text, 'error'); setTab('publish'); return; }
    const errs = S.admin.validate(A.data);
    if (errs.length) { U.notify(errs[0], 'error'); return; }
    persist();
    if (!CLOUD) { backupFile(); U.notify('הקובץ ירד. מסרו אותו למי שמתחזק את האתר.', 'success'); return; }
    if (btn) btn.disabled = true;
    const stop = U.notify('מפרסמים…', 'progress');
    const removedIds = A.origin ? A.origin.episodes.filter((o) => !A.data.episodes.some((e) => e.id === o.id)).map((o) => o.id) : [];
    const go = async (force) => {
      const r = await S.sb.push(A.data, { removedIds, baseVersion: A.base ?? null, force, notify: A.notify });
      clearTimeout(A.syncTimer); A.syncState = '';
      S.admin.clearOverride(); writeBase(null);
      A.origin = S.admin.normalize(clone(A.data)); A.origin.versionId = r.versionId ?? null; A.base = A.origin.versionId;
      A.originError = false; A.versions = null; A.versionCache.clear();
      stop(); U.notify('פורסם! האתר מציג עכשיו את הגרסה החדשה.', 'success');
      paintStatus(); if (A.tab === 'publish') render();
      if (A.notify && r.notified) drainPush().then((n) => n && U.notify(n === 1 ? 'נשלחה התראה למכשיר אחד.' : `נשלחה התראה ל־${n} מכשירים.`, 'success'));
    };
    try { await go(false); }
    catch (err) {
      stop();
      if (err.conflict) {
        // מנהל אחר פרסם אחרי שהתחלתם לערוך — לא דורסים בלי לשאול
        const who = err.latest?.by ? ` (${err.latest.by}${err.latest.createdAt ? `, ${when(err.latest.createdAt)}` : ''})` : '';
        showConflict(who, async () => { const s2 = U.notify('מפרסמים…', 'progress'); try { await go(true); } catch (e2) { s2(); U.notify(`הפרסום לא הצליח: ${e2.message}`, 'error'); } });
      } else U.notify(`הפרסום לא הצליח: ${err.message}`, 'error');
    }
    finally { if (btn) btn.disabled = false; }
  }
  /** ההתראות נשלחות במנות קטנות (מגבלת השרת); הדף ממשיך לשלוח עד שכולן יצאו */
  async function drainPush(sent = 0) {
    for (let i = 0; i < 500; i++) {
      let r; try { r = await S.sb.call('/api/program/push/drain', { method: 'POST' }); } catch { break; }
      sent += Number(r.sent) || 0;
      if (!Number(r.remaining)) break;
    }
    return sent;
  }
  /** מנהל אחר פרסם בינתיים: מציגים מה קרה ושתי דרכים — לראות את הגרסה החדשה, או לפרסם בכל זאת */
  function showConflict(who, force) {
    let d = $('#dlg-conflict');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'dlg-conflict'; d.className = 'sheet';
      document.body.appendChild(d);
      d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    }
    d.innerHTML = `<div class="section-title"><div><p class="kicker">רגע לפני הפרסום</p><h2>מנהל אחר פרסם בינתיים</h2></div><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div>
<div class="card-body"><p class="help">מאז שהתחלתם לערוך, מישהו אחר פרסם גרסה חדשה לאתר${esc(who)}. אם תפרסמו עכשיו, השינויים שלו יימחקו ויוחלפו בטיוטה שלכם.</p>
<p class="help">מומלץ: לפתוח את "גרסאות קודמות" בחלק "פרסום", לראות מה השתנה, ולהעתיק לטיוטה רק את מה שצריך.</p></div>
<div class="card-foot"><button type="button" class="btn" data-close>ביטול — לא לפרסם</button><button type="button" class="btn danger" data-force>לפרסם בכל זאת ולדרוס</button></div>`;
    d.querySelector('[data-force]').addEventListener('click', () => { d.close(); force(); });
    d.showModal();
  }
  async function discard() {
    if (!confirm('לבטל את כל השינויים שלא פורסמו ולחזור למה שמפורסם באתר?')) return;
    S.admin.clearOverride();
    if (CLOUD) { try { await S.sb.draft.clear(); } catch { /* */ } }
    location.reload();
  }
  async function restoreVersion(id) {
    const v = A.versions?.find((x) => x.id === id);
    if (!confirm(`לשחזר את הגרסה מ־${v ? when(v.createdAt) : 'התאריך הזה'}? כל מה שבטיוטה יוחלף. אחר כך לוחצים פרסום.`)) return;
    const stop = U.notify('משחזרים…', 'progress');
    try { const { data } = await versionData(id); applyData(data); stop(); U.notify('הגרסה שוחזרה לטיוטה. בדקו ולחצו פרסום.', 'success'); }
    catch (err) { stop(); U.notify(err.message, 'error'); }
  }
  async function previewLink() {
    const box = $('#preview-link'); box.innerHTML = '<span class="cue-hint">מכינים…</span>';
    try {
      persist(); await sync();
      const { preview } = await S.sb.preview.create();
      const url = new URL(`index.html?preview=${preview.token}`, site.url || location.href).href;
      box.innerHTML = `<div class="preview-url"><input readonly value="${esc(url)}" class="ltr" aria-label="קישור"><button type="button" class="btn small gold" data-op="copy" data-text="${esc(url)}">העתקה</button><button type="button" class="btn small" data-op="preview-revoke">ביטול הקישור</button></div>`;
    } catch (err) { box.innerHTML = `<span class="problems">${esc(err.message)}</span>`; }
  }
  $('#btn-publish-top').addEventListener('click', () => { const ch = changes(); if (ch && !ch.any) { U.notify('הכול כבר מפורסם.', 'info'); return; } setTab('publish'); });
  /* בתוך דף הניהול המשותף, תפריט הצד של אתר הסקר בוחר את החלק */
  if (EMBED && CLOUD) {
    const parentOrigin = new URL(S.sb.cfg.apiBase).origin;
    window.addEventListener('message', (e) => { if (e.origin === parentOrigin && e.data?.type === 'rosh-admin-tab') setTab(e.data.tab, { push: false }); });
  }

  /* ---------- העברת ההקלטות ---------- */

  const dlgMigrate = $('#dlg-migrate');
  let stopMigration = false;
  function openMigrate() {
    const eps = A.data.episodes.filter((e) => U.driveId(e));
    const bytes = eps.reduce((n, e) => n + (e.sourceFileBytes || 0), 0);
    $('#migrate-summary').textContent = `${eps.length} הקלטות בדרייב${bytes ? `, בערך ${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB` : ''}`;
    $('#migrate-progress').max = Math.max(1, eps.length); $('#migrate-progress').value = 0; $('#migrate-errors').textContent = '';
    dlgMigrate.showModal();
  }
  $('#migrate-stop').addEventListener('click', () => { stopMigration = true; $('#migrate-stop').disabled = true; });
  $('#migrate-start').addEventListener('click', async () => {
    const start = $('#migrate-start'), stop = $('#migrate-stop'), status = $('#migrate-status'), progress = $('#migrate-progress'), errors = $('#migrate-errors');
    if (!await checkAccess()) { U.notify('צריך להיות מחוברים כמנהל.', 'error'); return; }
    const episodes = A.data.episodes.filter((e) => U.driveId(e));
    progress.max = Math.max(1, episodes.length); progress.value = 0; errors.textContent = '';
    start.disabled = true; stop.disabled = false; stopMigration = false;
    let uploaded = 0, existing = 0, failed = 0;
    for (let i = 0; i < episodes.length && !stopMigration; i++) {
      const e = episodes[i];
      status.innerHTML = `<b>${i + 1} מתוך ${episodes.length}: ${esc(label(e))}</b><span>מעתיקים לאתר…</span>`;
      try { const r = await S.sb.importDrive(e); r.status === 'existing' ? existing++ : uploaded++; }
      catch (err) { failed++; errors.insertAdjacentHTML('beforeend', `<div>✕ ${esc(label(e))}: ${esc(err.message)}</div>`); }
      progress.value = i + 1;
    }
    status.innerHTML = `<b>${stopMigration ? 'ההעברה נעצרה' : 'ההעברה הסתיימה'}</b><span>${uploaded} הועברו · ${existing} כבר היו באתר · ${failed} לא הצליחו</span>`;
    start.disabled = false; start.textContent = failed || stopMigration ? 'המשך / ניסיון חוזר' : 'בדיקה חוזרת'; stop.disabled = true;
    if (!failed && !stopMigration) U.notify('כל ההקלטות הועברו לאתר.', 'success');
  });

  /* ---------- המדריך ---------- */

  const dlgGuide = $('#dlg-guide');
  $('#btn-guide').addEventListener('click', () => dlgGuide.showModal());
  function maybeGuide() { try { if (!localStorage.getItem('rosh:admin:guided')) { dlgGuide.showModal(); localStorage.setItem('rosh:admin:guided', '1'); } } catch { /* */ } }

  /* ======================================================
     אירועים — האצלה אחת על כל הפאנל
     ====================================================== */

  const P = $('#panel');

  P.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'ep-q') { A.q = t.value; renderList(); return; }
    const e = cur();
    const { f, lf, sf, uf, zf } = t.dataset;
    if (f && e) {
      const v = t.value;
      switch (f) {
        case 'number': e.number = v === '' ? null : Number(v); break;
        case 'tags': e.tags = splitList(v); break;
        case 'guests': e.guests = splitList(v); break;
        case 'season': if (v === '__new') { newSeasonInline(t); return; } e.season = v; break;
        case 'audio': e.audio = v; e.duration = 0; break;
        default: e[f] = v;
      }
      touch(); schedulePreview();
    } else if (lf && e) {
      const l = e.links[Number(t.dataset.i)]; if (!l) return;
      l[lf] = t.value; touch(); schedulePreview();
    } else if (sf) {
      const b = A.data.settings.banner || (A.data.settings.banner = {}); b[sf] = t.value; touch();
    } else if (t.dataset.bs) {
      const b = A.data.settings.banner || (A.data.settings.banner = {}); b.sites = { program: true, survey: false, ...(b.sites || {}) }; b.sites[t.dataset.bs] = t.checked; touch();
    } else if (uf) {
      const u = A.data.settings.updates[Number(t.dataset.i)]; if (!u) return; u[uf] = t.value; touch();
    } else if (zf) {
      const s = A.data.seasons[Number(t.dataset.i)]; if (!s) return;
      s[zf] = zf === 'year' ? (t.value ? Number(t.value) : null) : t.value; touch();
    }
  });

  P.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.id === 'ep-filter') { A.filter = t.value; renderList(); return; }
    if (t.id === 'pub-notify') { A.notify = t.checked; return; }
    if (t.id === 'stats-ep') { loadEpStats(t.value); return; }
    if (t.dataset.op === 'bulk-season') {
      const v = t.value; if (!v) return;
      A.picked.forEach((id) => { const e = A.data.episodes.find((x) => x.id === id); if (e) e.season = v === '__none' ? '' : v; });
      touch(); renderList(); renderEditor(); U.notify(`${A.picked.size} תוכניות שויכו${v === '__none' ? ' ל"בלי עונה"' : ` לעונה "${A.data.seasons.find((s) => s.id === v)?.title || ''}"`}.`, 'success');
      return;
    }
    const e = cur(); if (!e) return;
    if (t.dataset.upload) {
      const kind = t.dataset.upload, file = t.files[0]; if (!file) return;
      const status = P.querySelector(`[data-upload-status="${kind}"]`);
      t.disabled = true;
      try {
        status.textContent = 'מתחילים להעלות…';
        e[kind] = await window.RoshUpload(file, e.id, kind, (pct) => { status.textContent = `מעלים את ${file.name} — ${pct}%`; });
        if (kind === 'audio') e.duration = 0;
        touch();
        if (A.selected === e.id) renderEditor();
        U.notify('הקובץ הועלה. כשתלחצו פרסום, הוא יופיע באתר.', 'success');
      } catch (err) { status.textContent = err.message; t.disabled = false; t.value = ''; }
      return;
    }
    if (t.dataset.f === 'audio' || t.dataset.f === 'cover' || t.dataset.f === 'publishAt') renderEditor();
  });

  P.addEventListener('submit', async (ev) => {
    const pf = ev.target.closest('[data-push-send]');
    if (pf) {
      ev.preventDefault();
      const title = pf.elements.title.value.trim(); if (!title) return;
      if (!confirm(`לשלוח את ההתראה "${title}" ל־${A.pushCount ?? 'כל'} המכשירים?`)) return;
      const btn = pf.querySelector('button[type="submit"]'); btn.disabled = true;
      try {
        const url = new URL(pf.elements.url.value || '', site.url || location.href).href;
        const stopN = U.notify('שולחים…', 'progress');
        const r = await S.sb.call('/api/program/push/send', { method: 'POST', body: { title, body: pf.elements.body.value.trim(), url } });
        const sent = Number(r.remaining) ? await drainPush(Number(r.sent) || 0) : Number(r.sent) || 0;
        stopN(); U.notify(sent === 1 ? 'נשלח למכשיר אחד.' : `נשלח ל־${sent} מכשירים.`, 'success'); pf.reset();
        if (r.removed) A.pushCount = Math.max(0, (A.pushCount || 0) - r.removed);
      } catch (err) { U.notify(`השליחה לא הצליחה: ${err.message}`, 'error'); }
      btn.disabled = false;
      return;
    }
    const f = ev.target.closest('[data-admin-add]'); if (!f) return;
    ev.preventDefault();
    const email = f.querySelector('input').value.trim(); if (!email) return;
    try { A.admins = (await S.sb.admins.add(email)).admins; $('#admins-box').innerHTML = renderAdmins(); U.notify(`${email} נוסף לרשימת המנהלים.`, 'success'); }
    catch (err) { U.notify(err.message, 'error'); }
  });

  P.addEventListener('click', async (ev) => {
    const item = ev.target.closest('.ep-item[data-id]');
    if (item) {
      if (A.bulk) { A.picked.has(item.dataset.id) ? A.picked.delete(item.dataset.id) : A.picked.add(item.dataset.id); renderList(); }
      else select(item.dataset.id);
      return;
    }
    const b = ev.target.closest('[data-op]'); if (!b || b.tagName === 'SELECT') return;
    const op = b.dataset.op, i = Number(b.dataset.i), e = cur();
    switch (op) {
      // כללי
      case 'new': newEpisode(); break;
      case 'open': A.bulk = false; select(b.dataset.id, { tab: 'programs' }); break;
      case 'copy': (await U.copy(b.dataset.text)) ? U.notify('הועתק.', 'success') : U.notify('ההעתקה לא הצליחה.', 'error'); break;
      // רשימה ובחירה מרובה
      case 'bulk': A.bulk = !A.bulk; A.picked.clear(); renderPrograms(); break;
      case 'pick-all': { const l = listFiltered(); if (A.picked.size === l.length && l.length) A.picked.clear(); else l.forEach((x) => A.picked.add(x.id)); renderList(); break; }
      case 'bulk-show': case 'bulk-hide': { const on = op === 'bulk-show'; A.picked.forEach((id) => { const x = A.data.episodes.find((y) => y.id === id); if (x) x.visible = on; }); touch(); renderList(); renderEditor(); U.notify(`${A.picked.size} תוכניות ${on ? 'יוצגו באתר' : 'הוסתרו'}.`, 'success'); break; }
      case 'bulk-del': if (confirm(`למחוק ${A.picked.size} תוכניות?`)) removeMany([...A.picked]); break;
      // תוכנית
      case 'visible': if (e) { e.visible = !e.visible; touch(); renderEditor(); renderList(); } break;
      case 'featured': if (e) { const on = !e.featured; A.data.episodes.forEach((x) => { x.featured = on && x.id === e.id; }); touch(); renderEditor(); renderList(); U.notify(on ? 'התוכנית הזו תופיע בראש דף הבית.' : 'דף הבית יציג את התוכנית האחרונה.', 'info'); } break;
      case 'unschedule': if (e) { e.publishAt = ''; touch(); renderEditor(); renderList(); } break;
      case 'dup': if (e) duplicate(e); break;
      case 'del': if (e && confirm(`למחוק את "${label(e)}"?`)) removeMany([e.id]); break;
      case 'share': if (e) { (await U.copy(shareText(e))) ? U.notify('הטקסט הועתק — הדביקו בוואטסאפ.', 'success') : U.notify('ההעתקה לא הצליחה.', 'error'); } break;
      case 'history': if (e) openHistory(e); break;
      case 'cover-clear': if (e) { e.cover = ''; touch(); renderEditor(); } break;
      case 'cover-auto': if (e) { const st = P.querySelector('[data-upload-status="auto"]'); b.disabled = true; try { await autoCover(e, st); U.notify('התמונה נוצרה. לא אהבתם? לחצו שוב לגרסה אחרת.', 'success'); } catch (err) { st.textContent = err.message; b.disabled = false; } } break;
      case 'link-add': if (e) { e.links.push({ label: '', url: '' }); touch(); $('#link-rows').innerHTML = renderLinks(e); $$('#link-rows input[data-lf="label"]').pop()?.focus(); } break;
      case 'link-del': if (e) { e.links.splice(i, 1); touch(); $('#link-rows').innerHTML = renderLinks(e); renderPreview(); } break;
      // עבודות על כל התוכניות
      case 'fill-durations': fillDurations(); break;
      case 'covers-all': if (confirm(`ליצור תמונה אוטומטית ל־${A.data.episodes.filter((x) => !x.cover).length} תוכניות בלי תמונה?`)) coversAll(); break;
      case 'ai-all': if (confirm('לתמלל ולכתוב תיאור וסיכום לכל התוכניות בלי תיאור אמיתי? זה לוקח כמה דקות לכל תוכנית, ואפשר לעצור באמצע.')) aiAll(); break;
      case 'job-stop': if (A.jobs[b.dataset.job]) A.jobs[b.dataset.job].stop = true; break;
      // AI לתוכנית אחת
      case 'ai-run': if (e) aiRun(e).catch(() => {}); break;
      case 'ai-apply': if (e && A.ai.get(e.id)?.summary) { applySummary(e, A.ai.get(e.id).summary); touch(); renderEditor(); renderList(); U.notify('התיאור והסיכום נכנסו לתוכנית. בדקו, ואז "פרסום לאתר".', 'success'); } break;
      case 'ai-transcript': if (e) { const st = A.ai.get(e.id) || {}; A.ai.set(e.id, st); if (st.transcript != null) { st.transcript = null; paintAi(); break; } try { const r = await S.sb.call(`/api/program/ai/transcript/${encodeURIComponent(e.id)}`); st.transcript = r.text || ''; if (!st.summary && r.summary) st.summary = r.summary; } catch (err) { st.transcript = ''; st.error = err.status === 404 ? 'עדיין אין תמלול לתוכנית הזו.' : err.message; } paintAi(); } break;
      // האתר
      case 'banner-toggle': { const bn = A.data.settings.banner || (A.data.settings.banner = {}); bn.enabled = !bn.enabled; if (bn.enabled && !bn.text) { U.notify('כתבו קודם את ההודעה.', 'info'); bn.enabled = false; } touch(); renderSite(); break; }
      case 'update-add': A.data.settings.updates.unshift({ id: `u-${Date.now().toString(36)}`, date: new Date().toISOString().slice(0, 10), title: '', text: '', link: '', pinned: false }); touch(); $('#update-rows').innerHTML = renderUpdates(A.data.settings.updates); $('#update-rows input[data-uf="title"]')?.focus(); break;
      case 'update-pin': { const u = A.data.settings.updates[i]; if (u) { u.pinned = !u.pinned; touch(); $('#update-rows').innerHTML = renderUpdates(A.data.settings.updates); } break; }
      case 'update-del': if (confirm('למחוק את העדכון?')) { A.data.settings.updates.splice(i, 1); touch(); renderSite(); } break;
      case 'season-add': { const y = new Date().getFullYear(); A.data.seasons.push({ id: uniqueSeasonId(String(y)), title: `עונת ${y}`, year: y, note: '' }); touch(); $('#season-rows').innerHTML = renderSeasonRows(); $$('#season-rows input[data-zf="title"]').pop()?.select(); break; }
      case 'season-del': { const s = A.data.seasons[i]; if (!s) break; const n = A.data.episodes.filter((x) => x.season === s.id).length; if (!confirm(`למחוק את העונה "${s.title}"?${n ? ` ${n} תוכניות יישארו בלי עונה.` : ''}`)) break; A.data.episodes.forEach((x) => { if (x.season === s.id) x.season = ''; }); A.data.seasons.splice(i, 1); touch(); renderSite(); break; }
      // מאזינים
      case 'reload-listeners': A.stats = A.messages = null; renderListeners(); loadListeners(); break;
      case 'msg-read': try { await S.sb.messages.read(b.dataset.id, b.dataset.read === '1'); await loadListeners(); } catch (err) { U.notify(err.message, 'error'); } break;
      case 'msg-del': if (confirm('למחוק את ההודעה?')) { try { await S.sb.messages.remove(b.dataset.id); await loadListeners(); } catch (err) { U.notify(err.message, 'error'); } } break;
      // פרסום
      case 'publish': publish(b); break;
      case 'discard': discard(); break;
      case 'reload': loadOrigin(); break;
      case 'check-audio': runCheck('audio'); break;
      case 'check-media': runCheck('media'); break;
      case 'versions': b.disabled = true; try { A.versions = (await S.sb.versions.list()).versions; } catch (err) { U.notify(err.message, 'error'); A.versions = []; } renderPublish(); break;
      case 'restore-version': restoreVersion(b.dataset.id); break;
      case 'preview-link': previewLink(); break;
      case 'preview-revoke': try { await S.sb.preview.revoke(); $('#preview-link').innerHTML = '<span class="cue-hint">הקישור בוטל.</span>'; } catch (err) { U.notify(err.message, 'error'); } break;
      case 'backup': backupFile(); U.notify('קובץ הגיבוי ירד למחשב.', 'success'); break;
      case 'restore': $('#file-restore').click(); break;
      case 'migrate': openMigrate(); break;
      case 'admins': b.disabled = true; try { A.admins = (await S.sb.admins.list()).admins; } catch (err) { A.admins = { error: err.status === 404 ? 'השרת עדיין לא עודכן לגרסה שמנהלת מנהלים מכאן. בינתיים — בלשונית "הרשאות" באתר הסקר.' : err.message }; } renderPublish(); $('details.more-details').open = true; break;
      case 'admin-del': if (confirm(`להסיר את ${b.dataset.email} מרשימת המנהלים?`)) { try { A.admins = (await S.sb.admins.remove(b.dataset.email)).admins; $('#admins-box').innerHTML = renderAdmins(); } catch (err) { U.notify(err.message, 'error'); } } break;
      case 'logout': S.signOut(); gateMounted = false; checkAccess(); U.notify('התנתקתם.', 'success'); break;
    }
  });

  // האורך נקרא מהקובץ אוטומטית (אירועי מדיה לא מבעבעים — לכן capture)
  P.addEventListener('loadedmetadata', (ev) => {
    if (ev.target.id !== 'preview-audio') return;
    const e = cur(); if (e && !e.duration && isFinite(ev.target.duration)) { e.duration = Math.round(ev.target.duration); touch(); renderPreview(); }
  }, true);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); persist(); U.notify('הכול נשמר אוטומטית. כשמסיימים — "פרסום לאתר".', 'info'); }
  });
  $$('dialog.sheet').forEach((d) => { d.querySelectorAll('[data-close]').forEach((x) => x.addEventListener('click', () => d.close())); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); });

  /* ---------- התחלה ---------- */

  const first = U.qs('ep');
  if (first) { const e = A.data.episodes.find((x) => x.id === first || x.slug === first); if (e) A.selected = e.id; }
  setTab(location.hash.slice(1) || 'programs', { push: false });
  paintStatus();
  if (S.state.authRedirect) U.notify(`התחברתם כ־${S.state.authRedirect.email}.`, 'success');
  if (S.state.handoffError) U.notify(S.state.handoffError, 'error');
  const allowed = await checkAccess();
  if (allowed || !CLOUD) { await loadOrigin(); if (allowed) { maybeGuide(); loadListeners(); } }
})();
