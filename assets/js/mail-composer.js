/* טיוטת מייל לרשימת התפוצה על תוכנית חדשה — העורך, התצוגה המקדימה והיצירה בג'ימייל.
   הטיוטה נוצרת ישירות בתיקיית "טיוטות" של חשבון ה־Google המחובר (Gmail API, הרשאת
   gmail.compose בלבד — ליצור טיוטות, בלי לקרוא את הדואר), עם כל רשימת התפוצה בעותק
   מוסתר, קישור להאזנה באתר וקישור הורדה ישיר. שום דבר לא נשלח: שולחים מג'ימייל.
   הבחירות (סגנון, צבע, חתימה, ניסוח) נשמרות בחשבון לפעם הבאה — לא במכשיר.
     RoshMailComposer.mount(el, cfg) — בתוך דף (mail.html)
     RoshMailComposer.open(cfg)      — בחלון (אזור הניהול)
   cfg: { episodes(): [], episodeId, isLive(e), contacts() } */
(function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore, M = window.RoshMail;
  const { esc } = U;
  const SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
  const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const PREF = 'mailDraft';
  const TITLE = '{{title}}';   // בניסוח שנשמר לפעם הבאה, שם התוכנית מתחלף בשם של התוכנית הבאה
  const label = (e) => String(e?.title || '').trim() || 'תוכנית בלי שם';
  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || 0) - (a.number || 0);

  /* ---------- ההרשאה לג'ימייל: טוקן קצר בזיכרון בלבד ---------- */

  const auth = { token: '', exp: 0, client: null, waiter: null, loading: null, error: '' };
  const AUTH_ERRORS = {
    access_denied: 'לא אישרתם לאתר ליצור טיוטות בג\'ימייל. לחצו שוב, ובחלון של Google סמנו את האפשרות "ניהול טיוטות ושליחת אימיילים".',
    popup_failed_to_open: 'הדפדפן חסם את החלון של Google. אפשרו חלונות קופצים לאתר הזה ונסו שוב.',
    popup_closed: 'החלון של Google נסגר לפני שאישרתם. לחצו שוב כדי לנסות.',
  };
  const authError = (type) => new Error(AUTH_ERRORS[type] || `Google לא אישר את הגישה לג'ימייל${type ? ` (${type})` : ''}. נסו שוב.`);
  /** טוען מראש את הספרייה של Google, כדי שהלחיצה על "יצירה" תפתח את חלון האישור מיד (דפדפנים חוסמים חלון שנפתח באיחור) */
  function prepare() {
    if (auth.client) return Promise.resolve();
    if (auth.loading) return auth.loading;
    const clientId = S.sb.cfg?.googleClientId;
    if (!clientId) { auth.error = 'כניסה עם Google אינה מוגדרת באתר הזה.'; return Promise.resolve(); }
    auth.loading = S.sb.loadGoogle().then((g) => {
      const o = g.accounts?.oauth2;
      if (!o?.initTokenClient) throw new Error('הספרייה של Google לא נטענה במלואה. רעננו את הדף.');
      auth.client = o.initTokenClient({
        client_id: clientId, scope: SCOPE, include_granted_scopes: true, prompt: '', login_hint: S.sb.user?.email || '',
        callback: (r) => {
          const w = auth.waiter; auth.waiter = null; if (!w) return;
          if (r?.error) return w.reject(authError(r.error));
          if (o.hasGrantedAllScopes && !o.hasGrantedAllScopes(r, SCOPE)) return w.reject(authError('access_denied'));
          auth.token = r.access_token; auth.exp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          w.resolve(auth.token);
        },
        error_callback: (e) => { const w = auth.waiter; auth.waiter = null; w?.reject(authError(e?.type)); },
      });
      auth.error = '';
    }).catch((err) => { auth.error = err.message; }).finally(() => { auth.loading = null; });
    return auth.loading;
  }
  /** חייב להיקרא ישירות מתוך הלחיצה (בלי await לפניו) — אחרת הדפדפן חוסם את החלון של Google */
  function getToken() {
    if (auth.token && Date.now() < auth.exp - 60000) return Promise.resolve(auth.token);
    if (!auth.client) { prepare(); return Promise.reject(new Error(auth.error || 'החיבור ל־Google עוד נטען — לחצו שוב בעוד רגע.')); }
    auth.waiter?.reject(new Error('הבקשה הוחלפה בבקשה חדשה.'));
    return new Promise((resolve, reject) => {
      // חלון שלא החזיר תשובה (נסגר בלי הודעה) לא משאיר את הכפתור תקוע
      const timer = setTimeout(() => { if (auth.waiter?.resolve === done) { auth.waiter = null; reject(authError('popup_closed')); } }, 180000);
      const done = (t) => { clearTimeout(timer); resolve(t); };
      auth.waiter = { resolve: done, reject: (e) => { clearTimeout(timer); reject(e); } };
      auth.client.requestAccessToken({ login_hint: S.sb.user?.email || '' });
    });
  }
  function gmailError(status, j) {
    const msg = String(j?.error?.message || ''), why = `${msg} ${j?.error?.status || ''} ${(j?.error?.errors || []).map((x) => x.reason).join(' ')}`;
    let text;
    if (status === 401) { auth.token = ''; text = 'ההרשאה לג\'ימייל פגה. לחצו שוב על "יצירת הטיוטה".'; }
    else if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(why)) text = 'ה־Gmail API עוד לא הופעל בפרויקט של Google שהאתר משתמש בו — ההוראות בקובץ README של האתר. בינתיים אפשר ללחוץ "העתקת המייל" ולהדביק בהודעה חדשה בג\'ימייל.';
    else if (status === 403) { auth.token = ''; text = 'ג\'ימייל לא אישר ליצור טיוטה בחשבון הזה. לחצו שוב וסמנו בחלון של Google את האפשרות לנהל טיוטות.'; }
    else if (status === 429) text = 'יותר מדי בקשות לג\'ימייל ברגע אחד. נסו שוב בעוד דקה.';
    else text = `ג'ימייל החזיר שגיאה (${status})${msg ? `: ${msg}` : ''}.`;
    return Object.assign(new Error(text), { status });
  }
  async function gmail(path, { method = 'GET', body } = {}) {
    let r;
    try { r = await fetch(`${GMAIL}${path}`, { method, headers: { Authorization: `Bearer ${auth.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw new Error('אין חיבור לג\'ימייל כרגע. בדקו את החיבור ונסו שוב.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw gmailError(r.status, j);
    return j;
  }
  const inbox = (email) => `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}`;
  const draftUrl = (email, messageId) => `${inbox(email)}#drafts?compose=${encodeURIComponent(messageId)}`;

  /* ---------- מה שנשמר בחשבון לפעם הבאה ---------- */

  const toTemplate = (text, e) => { const t = label(e); return t.length > 1 ? String(text).split(t).join(TITLE) : String(text); };
  const fill = (text, e) => String(text).split(TITLE).join(label(e));
  const KEEP = ['style', 'accent', 'cover', 'listenLabel', 'downloadLabel', 'signature', 'descTitle'];
  function savedPrefs() { const p = S.prefs.get(PREF, null); return p && typeof p === 'object' ? p : {}; }

  /* ---------- העורך ---------- */

  function mount(root, cfg = {}) {
    const st = {
      id: '', opts: null, prefs: savedPrefs(), view: 'desktop', busy: false, results: {}, progress: '',
      mode: 'all', to: S.sb.user?.email || '', replyTo: '', chunk: 400,
      rcp: { state: 'loading', list: [], error: '', source: '' },
    };
    st.chunk = Math.min(2000, Math.max(1, Number(st.prefs.chunk) || 400));
    st.replyTo = String(st.prefs.replyTo || '');
    const eps = () => (cfg.episodes?.() || []).slice().sort(byDate);
    const ep = () => eps().find((e) => e.id === st.id) || null;
    const isLive = (e) => (cfg.isLive ? cfg.isLive(e) : e.visible && !S.scheduled(e));
    const $ = (s) => root.querySelector(s);

    function ctxFor(e) {
      const site = S.site || {};
      const base = site.url || new URL('.', location.href).href;
      return {
        siteName: site.name || 'ראש בראש', tagline: site.tagline || '', siteUrl: base,
        listenUrl: new URL(`episode.html?ep=${encodeURIComponent(e.slug || e.id)}&utm_source=email`, base).href,
        downloadUrl: U.downloadUrl(e), unsubscribeUrl: new URL('me.html#me-subscribe', base).href,
        dateText: e.date ? U.fmtDate(e.date) : '', durationText: e.duration ? U.fmtDuration(e.duration) : '',
        hue: U.hue(e), links: U.publicLinks(e), contacts: cfg.contacts?.() || S.settings?.contacts || {},
      };
    }
    function optionsFor(e) {
      const d = M.defaults(e, ctxFor(e)), p = st.prefs;
      const o = { ...d, show: { ...d.show, ...(p.show || {}) } };
      KEEP.forEach((k) => { if (typeof p[k] === 'string') o[k] = p[k]; });
      if (p.subject) o.subject = fill(p.subject, e);
      if (p.intro) o.intro = fill(p.intro, e);
      if (!M.STYLES[o.style]) o.style = 'night';
      return o;
    }
    let saveTimer = 0;
    function save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const e = ep(), o = st.opts; if (!e || !o) return;
        st.prefs = { ...Object.fromEntries(KEEP.map((k) => [k, o[k]])), show: { ...o.show }, subject: toTemplate(o.subject, e), intro: toTemplate(o.intro, e), chunk: st.chunk, replyTo: st.replyTo };
        S.prefs.set(PREF, st.prefs);
      }, 600);
    }
    const built = () => { const e = ep(); return e ? M.build(e, ctxFor(e), st.opts) : null; };

    function pick(id) {
      const prev = ep();
      st.id = id;
      const e = ep(); if (!e) return;
      if (prev && st.opts && prev.id !== e.id) {
        // מעבר לתוכנית אחרת: הניסוח נשאר, רק שם התוכנית מתחלף
        st.opts = { ...st.opts, subject: fill(toTemplate(st.opts.subject, prev), e), intro: fill(toTemplate(st.opts.intro, prev), e), description: String(e.description || '') };
      } else st.opts = optionsFor(e);
      render();
    }

    function styleCard(key, s, e) {
      const p = M.palette({ style: key }, { hue: U.hue(e) });
      return `<button type="button" class="mc-style" role="radio" data-mstyle="${key}" aria-checked="${st.opts.style === key}"><span class="mc-swatch" aria-hidden="true"><i style="background:${p.bg}"></i><i style="background:${p.card}"></i><i style="background:${p.accent}"></i></span><b>${esc(s.name)}</b><small>${esc(s.hint)}</small></button>`;
    }
    const check = (k, text, ok = true, why = '') => `<label class="check${ok ? '' : ' off'}"><input type="checkbox" data-mshow="${k}" ${st.opts.show[k] && ok ? 'checked' : ''} ${ok ? '' : 'disabled'}> ${esc(text)}${ok || !why ? '' : ` <small>(${esc(why)})</small>`}</label>`;

    function render() {
      const e = ep();
      if (!e) { root.innerHTML = '<div class="state"><span class="mark">✉</span><h3>אין תוכניות</h3><p>הוסיפו תוכנית באזור הניהול, ואז חזרו לכאן.</p></div>'; return; }
      const o = st.opts, pal = M.palette(o, { hue: U.hue(e) });
      const accentHex = /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : /^#[0-9a-f]{6}$/i.test(pal.accent) ? pal.accent : '#f0c65a';
      const hasCover = !!(e.cover || e.thumb), hasAudio = !!U.downloadUrl(e);
      const listOpen = !!$('[data-m-listbox]')?.open;
      root.innerHTML = `
<div class="mail-composer">
  <div class="mc-form">
    <section class="mc-sec">
      <label class="field"><span>התוכנית</span><select data-m="ep">${eps().map((x) => `<option value="${esc(x.id)}" ${x.id === e.id ? 'selected' : ''}>${esc(label(x))}${x.date ? ` · ${esc(U.fmtDate(x.date, true))}` : ''}${isLive(x) ? '' : ' (עוד לא באתר)'}</option>`).join('')}</select></label>
      <div class="mc-warn" data-m-warn></div>
    </section>

    <section class="mc-sec">
      <h3 class="mc-h">הטקסט</h3>
      <label class="field"><span>נושא המייל</span><input data-m="subject" value="${esc(o.subject)}" maxlength="200" autocomplete="off"><small data-m-subject-len></small></label>
      <label class="field"><span>פתיחה</span><textarea data-m="intro" rows="4" placeholder="כמה מילים לפני הכפתורים">${esc(o.intro)}</textarea><small>שורה ריקה פותחת פסקה חדשה. כשתעברו לתוכנית אחרת, השם שלה ייכנס במקום השם הזה.</small></label>
      <div class="field mc-desc">
        <label for="mc-desc"><span>תיאור התוכנית</span></label>
        <input data-m="descTitle" value="${esc(o.descTitle)}" maxlength="60" placeholder="כותרת לתיאור (לא חובה)" aria-label="הכותרת מעל התיאור">
        <textarea id="mc-desc" data-m="description" rows="6" placeholder="כמה משפטים על מה שהיה בתוכנית — מי התארח, על מה דיברו, אילו שירים">${esc(o.description)}</textarea>
        <small class="mc-desc-note"><span data-m-desc-note>${o.description === String(e.description || '') ? (o.description.trim() ? 'מתוך דף התוכנית באתר. שינוי כאן משנה רק את המייל.' : 'לתוכנית אין עדיין תיאור באתר — אפשר לכתוב כאן תיאור למייל.') : 'נערך למייל הזה (באתר נשאר התיאור המקורי).'}</span> <button type="button" class="link-btn" data-mop="desc-reset" ${o.description === String(e.description || '') ? 'hidden' : ''}>חזרה לתיאור מהאתר</button></small>
      </div>
      <label class="field"><span>חתימה</span><textarea data-m="signature" rows="2">${esc(o.signature)}</textarea></label>
      <div class="form-grid">
        <label class="field"><span>הכפתור הראשי</span><input data-m="listenLabel" value="${esc(o.listenLabel)}" maxlength="40"></label>
        <label class="field"><span>כפתור ההורדה</span><input data-m="downloadLabel" value="${esc(o.downloadLabel)}" maxlength="40" ${hasAudio ? '' : 'disabled'}></label>
      </div>
    </section>

    <section class="mc-sec">
      <h3 class="mc-h">העיצוב</h3>
      <div class="mc-styles" role="radiogroup" aria-label="סגנון המייל">${Object.entries(M.STYLES).map(([k, s]) => styleCard(k, s, e)).join('')}</div>
      <div class="mc-row">
        <label class="field mc-color"><span>צבע הכפתורים וההדגשות</span><input type="color" data-m="accent" value="${esc(accentHex)}"></label>
        <button type="button" class="btn small ghost" data-mop="accent-reset" ${o.accent ? '' : 'hidden'}>חזרה לצבע של הסגנון</button>
      </div>
      <div class="field"><span>התמונה של התוכנית</span>
        <div class="segmented" role="group" aria-label="מיקום התמונה">${[['side', 'ליד הכותרת'], ['full', 'גדולה למעלה'], ['none', 'בלי תמונה']].map(([k, t]) => `<button type="button" data-mcover="${k}" aria-pressed="${(hasCover ? o.cover : 'none') === k}" ${hasCover || k === 'none' ? '' : 'disabled'}>${t}</button>`).join('')}</div>
        ${hasCover ? '' : '<small>לתוכנית הזו אין תמונה.</small>'}
      </div>
    </section>

    <section class="mc-sec">
      <h3 class="mc-h">מה נכנס למייל</h3>
      <div class="mc-checks">
        ${check('download', 'כפתור הורדה ישירה', hasAudio, 'אין הקלטה')}
        ${check('description', 'תיאור התוכנית')}
        ${check('guests', 'האורחים', !!(e.guests || []).length, 'אין אורחים')}
        ${check('links', 'הקישורים מדף התוכנית', !!U.publicLinks(e).length, 'אין קישורים')}
        ${check('phone', 'קו הטלפון')}
        ${check('unsubscribe', 'שורת הסרה מהרשימה')}
      </div>
    </section>

    <section class="mc-sec">
      <h3 class="mc-h">למי</h3>
      <div class="segmented" role="group" aria-label="נמענים">
        <button type="button" data-mmode="all" aria-pressed="${st.mode === 'all'}">כל רשימת התפוצה</button>
        <button type="button" data-mmode="me" aria-pressed="${st.mode === 'me'}">רק אליי — לבדיקה</button>
      </div>
      <p class="help" data-m-count></p>
      <details class="mc-list" data-m-listbox>
        <summary>הרשימה — הצגה, עריכה או ייבוא מקובץ</summary>
        <textarea data-m="list" class="ltr" rows="5" spellcheck="false" aria-label="כתובות רשימת התפוצה, אחת בכל שורה"></textarea>
        <div class="actions" style="margin-top:8px">
          <button type="button" class="btn small" data-mop="import">ייבוא מקובץ (CSV / טקסט)</button>
          <button type="button" class="btn small" data-mop="reload-list">טעינה מחדש מהשרת</button>
          <button type="button" class="btn small ghost" data-mop="copy-list">העתקת הכתובות</button>
          <input type="file" data-m-file accept=".csv,.txt,text/csv,text/plain" hidden>
        </div>
      </details>
      <div class="form-grid">
        <label class="field"><span>נמען גלוי ("אל")</span><input data-m="to" value="${esc(st.to)}" class="ltr" type="email" autocomplete="off"><small>כל הרשימה נכנסת בעותק מוסתר — אף אחד לא רואה את הכתובות של האחרים.</small></label>
        <label class="field"><span>תשובות יגיעו אל (לא חובה)</span><input data-m="replyTo" value="${esc(st.replyTo)}" class="ltr" type="email" placeholder="${esc(st.to)}" autocomplete="off"></label>
        <label class="field"><span>עד כמה נמענים בכל טיוטה</span><input data-m="chunk" type="number" min="1" max="2000" value="${st.chunk}" inputmode="numeric"><small>בג'ימייל רגיל אפשר לשלוח עד 500 נמענים ביום; ברשימה ארוכה יותר נוצרות כמה טיוטות.</small></label>
      </div>
    </section>
  </div>

  <div class="mc-preview">
    <div class="mc-preview-head">
      <p class="kicker">כך זה ייראה בתיבת הדואר</p>
      <div class="segmented" role="group" aria-label="גודל התצוגה"><button type="button" data-mview="desktop" aria-pressed="${st.view === 'desktop'}">מחשב</button><button type="button" data-mview="phone" aria-pressed="${st.view === 'phone'}">טלפון</button></div>
    </div>
    <div class="mc-inbox" aria-hidden="true"><b>${esc(S.site?.name || 'ראש בראש')}</b><span data-m-inbox-subject></span><small data-m-inbox-pre></small></div>
    <div class="mc-frame-wrap${st.view === 'phone' ? ' phone' : ''}" data-m-framewrap><iframe data-m-frame title="תצוגה מקדימה של המייל" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></div>
  </div>

  <div class="mc-foot">
    <button type="button" class="btn xl primary" data-mop="create">יצירת טיוטה בג'ימייל <span>←</span></button>
    <button type="button" class="btn" data-mop="copy">העתקת המייל</button>
    <button type="button" class="btn ghost small" data-mop="reset">איפוס לברירת המחדל</button>
    <div class="mc-result" data-m-result role="status" aria-live="polite"></div>
  </div>
</div>`;
      if (listOpen) $('[data-m-listbox]').open = true;
      paintWarn(); paintRecipients(true); paintResult(); preview(true);
    }

    function paintWarn() {
      const e = ep(), box = $('[data-m-warn]'); if (!e || !box) return;
      const w = [];
      if (!isLive(e)) w.push(e.visible ? `התוכנית מתוזמנת ועוד לא באתר${e.publishAt ? ` (תעלה ב־${U.fmtDate(e.publishAt.slice(0, 10), true)} ${e.publishAt.slice(11, 16)})` : ''} — הקישורים יעבדו מאז. אפשר ליצור את הטיוטה עכשיו ולשלוח אחר כך.` : 'התוכנית עוד לא מוצגת באתר — הקישורים יעבדו רק אחרי שתפורסם. אפשר ליצור את הטיוטה עכשיו ולשלוח אחרי הפרסום.');
      if (!U.downloadUrl(e)) w.push('לתוכנית אין הקלטה, ולכן אין כפתור הורדה.');
      if (st.results[e.id]?.length) w.push('כבר יצרתם טיוטה לתוכנית הזו עכשיו — לחיצה נוספת תיצור עוד אחת.');
      box.innerHTML = w.map((t) => `<p>${esc(t)}</p>`).join('');
    }

    function paintDescNote() {
      const e = ep(), note = $('[data-m-desc-note]'), back = $('[data-mop="desc-reset"]'); if (!e || !note) return;
      const same = st.opts.description === String(e.description || '');
      note.textContent = same ? (st.opts.description.trim() ? 'מתוך דף התוכנית באתר. שינוי כאן משנה רק את המייל.' : 'לתוכנית אין עדיין תיאור באתר — אפשר לכתוב כאן תיאור למייל.') : 'נערך למייל הזה (באתר נשאר התיאור המקורי).';
      if (back) back.hidden = same;
      const box = root.querySelector('[data-mshow="description"]');
      if (box && !same && st.opts.description.trim() && !st.opts.show.description) { box.checked = true; st.opts.show.description = true; }
    }

    function paintRecipients(fillBox) {
      const r = st.rcp, count = $('[data-m-count]'), ta = $('[data-m="list"]'); if (!count) return;
      const n = r.list.length, drafts = Math.max(1, Math.ceil(n / st.chunk));
      if (st.mode === 'me') count.textContent = 'טיוטת בדיקה אליכם בלבד — בלי הרשימה. ככה רואים איך המייל נראה באמת לפני שיוצרים את הטיוטה לכולם.';
      else if (r.state === 'loading') count.innerHTML = '<span class="notice-spinner" aria-hidden="true"></span> טוענים את רשימת התפוצה…';
      else if (!n) count.innerHTML = `<span class="problems">${esc(r.state === 'missing' ? 'השרת עוד לא מחזיר את רשימת התפוצה (צריך לעדכן אותו). בינתיים: הורידו את הרשימה מניהול הסקר ("רשימת תפוצה" ← הורדה) וייבאו את הקובץ כאן, או הדביקו כתובות.' : r.state === 'error' ? `הרשימה לא נטענה: ${r.error}` : 'אין כתובות ברשימה. הדביקו כתובות או ייבאו קובץ.')}</span>`;
      else count.textContent = `${n.toLocaleString('he-IL')} כתובות${r.source === 'manual' ? ' (רשימה שערכתם כאן)' : ' מרשימת התפוצה'} ייכנסו בעותק מוסתר${drafts > 1 ? ` — ${drafts} טיוטות, עד ${st.chunk.toLocaleString('he-IL')} נמענים בכל אחת` : ''}.`;
      if (ta && fillBox) ta.value = r.list.join('\n');
      const box = $('[data-m-listbox]'); if (box && st.mode === 'all' && !n && r.state !== 'loading') box.open = true;
    }
    async function loadRecipients() {
      st.rcp = { state: 'loading', list: [], error: '', source: '' }; paintRecipients(true);
      try {
        const r = await S.sb.subscribe.list();
        st.rcp = { state: 'ready', list: M.parseEmails((r.subscribers || []).map((x) => (typeof x === 'string' ? x : x?.email)).join('\n')), error: '', source: 'server' };
      } catch (err) { st.rcp = { state: err.status === 404 ? 'missing' : 'error', list: [], error: err.message, source: '' }; }
      paintRecipients(true);
    }

    let previewTimer = 0;
    function preview(now) {
      clearTimeout(previewTimer);
      const run = () => {
        const b = built(); if (!b) return;
        const f = $('[data-m-frame]'); if (!f) return;
        f.onload = () => { try { f.style.height = `${Math.max(420, f.contentDocument.documentElement.scrollHeight + 4)}px`; } catch { /* */ } };
        f.srcdoc = b.html;
        const s = $('[data-m-inbox-subject]'), p = $('[data-m-inbox-pre]'), len = $('[data-m-subject-len]');
        if (s) s.textContent = b.subject; if (p) p.textContent = b.preheader;
        if (len) len.textContent = b.subject.length > 70 ? `${b.subject.length} תווים — בטלפון רואים רק את ההתחלה.` : '';
      };
      if (now) run(); else previewTimer = setTimeout(run, 160);
    }
    function paintResult() {
      const box = $('[data-m-result]'), btn = $('[data-mop="create"]'); if (!box) return;
      const e = ep(), done = e ? st.results[e.id] : null;
      if (btn) { btn.disabled = st.busy; btn.innerHTML = st.busy ? '<span class="notice-spinner" aria-hidden="true"></span> יוצרים…' : `${done?.length ? 'יצירת טיוטה נוספת' : 'יצירת טיוטה בג\'ימייל'} <span>←</span>`; }
      if (st.busy) { box.innerHTML = st.progress ? `<span class="cue-hint">${esc(st.progress)}</span>` : ''; return; }
      if (st.error) { box.innerHTML = `<p class="problems">${esc(st.error)}</p>`; return; }
      if (!done?.length) { box.innerHTML = ''; return; }
      const last = done[done.length - 1];
      box.innerHTML = `<div class="mc-done"><b>✓ ${last.drafts.length === 1 ? 'הטיוטה מחכה' : `${last.drafts.length} טיוטות מחכות`} בג'ימייל של ${esc(last.email)}</b>
<span>${last.mode === 'me' ? 'טיוטת בדיקה אליכם בלבד.' : `${last.total.toLocaleString('he-IL')} נמענים בעותק מוסתר.`} אפשר לערוך אותה שם, ואז "שליחה".</span>
<span class="mc-done-links">${last.drafts.map((d, i) => `<a class="btn small gold" href="${esc(draftUrl(last.email, d.messageId))}" target="_blank" rel="noopener">${last.drafts.length > 1 ? `טיוטה ${i + 1} (${d.count})` : 'פתיחת הטיוטה'} ←</a>`).join('')}<a class="btn small ghost" href="${esc(`${inbox(last.email)}#drafts`)}" target="_blank" rel="noopener">כל הטיוטות</a></span></div>`;
    }

    async function create() {
      if (st.busy) return;
      const e = ep(); if (!e) return;
      const list = st.mode === 'me' ? [] : st.rcp.list;
      if (st.mode === 'all' && !list.length) { st.error = 'אין כתובות ברשימה — ייבאו קובץ או הדביקו כתובות, או בחרו "רק אליי".'; paintResult(); return; }
      const to = M.parseEmails(st.to), replyTo = M.parseEmails(st.replyTo)[0] || '';
      if (st.mode === 'all' && !to.length) { st.error = 'כתבו כתובת בשדה "נמען גלוי" (בדרך כלל — הכתובת שלכם).'; paintResult(); return; }
      const tokenP = getToken();   // מיד, בתוך הלחיצה
      st.busy = true; st.error = ''; st.progress = 'מחכים לאישור של Google…'; paintResult();
      try {
        await tokenP;
        st.progress = 'יוצרים את הטיוטה…'; paintResult();
        const email = (await gmail('/profile')).emailAddress || S.sb.user?.email || '';
        const b = built();
        const groups = st.mode === 'me' ? [[]] : M.chunk(list, st.chunk);
        const drafts = [];
        for (let i = 0; i < groups.length; i++) {
          if (groups.length > 1) { st.progress = `יוצרים טיוטה ${i + 1} מתוך ${groups.length}…`; paintResult(); }
          const raw = M.raw({ to: st.mode === 'me' ? [email] : to, bcc: groups[i], replyTo, subject: b.subject, html: b.html, text: b.text });
          const d = await gmail('/drafts', { method: 'POST', body: { message: { raw } } });
          drafts.push({ id: d.id, messageId: d.message?.id || '', count: groups[i].length });
        }
        (st.results[e.id] = st.results[e.id] || []).push({ email, drafts, total: list.length, mode: st.mode });
        U.notify(drafts.length === 1 ? `הטיוטה נוצרה בג'ימייל של ${email}.` : `${drafts.length} טיוטות נוצרו בג'ימייל של ${email}.`, 'success');
        if (email && S.sb.user?.email && email.toLowerCase() !== S.sb.user.email.toLowerCase()) U.notify(`שימו לב: הטיוטה נוצרה בחשבון ${email}, לא ב־${S.sb.user.email}.`, 'info');
      } catch (err) { st.error = err.message; }
      finally { st.busy = false; st.progress = ''; paintResult(); paintWarn(); }
    }

    async function copyMail() {
      const b = built(); if (!b) return;
      try {
        if (window.ClipboardItem && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([b.bodyHtml], { type: 'text/html' }), 'text/plain': new Blob([b.text], { type: 'text/plain' }) })]);
        } else if (!await U.copy(b.text)) throw new Error('copy');
        U.notify('המייל הועתק. פתחו הודעה חדשה בג\'ימייל והדביקו (Ctrl+V). את הנושא כתבו בשדה הנושא.', 'success', { ttl: 9000 });
      } catch { U.notify('ההעתקה לא הצליחה.', 'error'); }
    }

    /* ---------- אירועים ---------- */
    root.addEventListener('input', (ev) => {
      const t = ev.target, k = t.dataset.m; if (!k || !st.opts) return;
      if (k === 'ep') return;
      if (k === 'list') { st.rcp = { ...st.rcp, state: 'ready', list: M.parseEmails(t.value), source: 'manual' }; st.error = ''; paintRecipients(false); paintResult(); return; }
      if (k === 'to') { st.to = t.value.trim(); return; }
      if (k === 'replyTo') { st.replyTo = t.value.trim(); save(); return; }
      if (k === 'chunk') { st.chunk = Math.min(2000, Math.max(1, Math.floor(Number(t.value) || 1))); paintRecipients(false); save(); return; }
      if (k === 'accent') { st.opts.accent = t.value; const r = $('[data-mop="accent-reset"]'); if (r) r.hidden = false; }
      else st.opts[k] = t.value;
      if (k === 'description') paintDescNote();
      save(); preview();
    });
    root.addEventListener('change', async (ev) => {
      const t = ev.target;
      if (t.dataset.m === 'ep') { st.error = ''; pick(t.value); return; }
      if (t.dataset.mshow) { st.opts.show[t.dataset.mshow] = t.checked; save(); preview(); return; }
      if (t.matches('[data-m-file]')) {
        const f = t.files?.[0]; t.value = ''; if (!f) return;
        const found = M.parseEmails(await f.text());
        if (!found.length) { U.notify('לא נמצאו כתובות מייל בקובץ.', 'error'); return; }
        const merged = [...new Set([...st.rcp.list, ...found])], added = merged.length - st.rcp.list.length;
        st.rcp = { state: 'ready', list: merged, error: '', source: 'manual' }; st.error = '';
        paintRecipients(true); paintResult();
        U.notify(added ? `נוספו ${added.toLocaleString('he-IL')} כתובות מהקובץ.` : 'כל הכתובות שבקובץ כבר ברשימה.', 'success');
      }
    });
    root.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button'); if (!b || !root.contains(b)) return;
      if (b.dataset.mstyle) { st.opts.style = b.dataset.mstyle; st.opts.accent = ''; render(); save(); return; }
      if (b.dataset.mcover) { st.opts.cover = b.dataset.mcover; root.querySelectorAll('[data-mcover]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); save(); preview(); return; }
      if (b.dataset.mview) { st.view = b.dataset.mview; root.querySelectorAll('[data-mview]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('[data-m-framewrap]')?.classList.toggle('phone', st.view === 'phone'); preview(true); return; }
      if (b.dataset.mmode) { st.mode = b.dataset.mmode; st.error = ''; root.querySelectorAll('[data-mmode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paintRecipients(false); paintResult(); return; }
      switch (b.dataset.mop) {
        case 'create': create(); break;
        case 'copy': copyMail(); break;
        case 'accent-reset': st.opts.accent = ''; render(); save(); break;
        case 'desc-reset': { const e = ep(); if (!e) break; st.opts.description = String(e.description || ''); const ta = $('[data-m="description"]'); if (ta) ta.value = st.opts.description; paintDescNote(); preview(); break; }
        case 'reset': if (confirm('לחזור לעיצוב ולניסוח של ברירת המחדל?')) { st.prefs = {}; S.prefs.set(PREF, {}); st.opts = optionsFor(ep()); render(); } break;
        case 'import': $('[data-m-file]')?.click(); break;
        case 'reload-list': loadRecipients(); break;
        case 'copy-list': (await U.copy(st.rcp.list.join(', '))) ? U.notify(`${st.rcp.list.length.toLocaleString('he-IL')} כתובות הועתקו.`, 'success') : U.notify('ההעתקה לא הצליחה.', 'error'); break;
      }
    });

    const all = eps();
    const first = all.find((e) => e.id === cfg.episodeId) || all.find(isLive) || all[0];
    if (first) pick(first.id); else render();
    prepare();
    loadRecipients();
    return { pick, get episodeId() { return st.id; } };
  }

  /** בחלון מעל אזור הניהול */
  function open(cfg) {
    let d = document.getElementById('dlg-mail');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'dlg-mail'; d.className = 'sheet mail-sheet'; d.setAttribute('aria-labelledby', 'dlg-mail-title');
      document.body.appendChild(d);
      d.addEventListener('click', (ev) => { if (ev.target.closest('[data-close]')) d.close(); });
    }
    d.innerHTML = `<div class="section-title"><div><p class="kicker">רשימת התפוצה</p><h2 id="dlg-mail-title">טיוטת מייל לתוכנית</h2></div><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div><div class="card-body" data-mail-host></div>`;
    const ctl = mount(d.querySelector('[data-mail-host]'), cfg);
    if (!d.open) d.showModal();
    return ctl;
  }

  window.RoshMailComposer = { mount, open, prepare };
})();
