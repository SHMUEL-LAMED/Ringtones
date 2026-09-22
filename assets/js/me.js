/* האזור האישי: כל אחד מתחבר עם Google (דרך אתר הסקר) ורואה את מה שלו —
   ממשיכים מאיפה שעצרתם, "לאחר כך", היסטוריית האזנה והעדפות.
   הנתונים האישיים נשמרים במכשיר. רק מי שמוגדר כמנהל רואה "מעבר לניהול". */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore, Pl = window.RoshPlayer;
  const { esc, fmtTime, fmtDate, fmtDuration } = U;

  await S.ready;
  const site = S.site || {};
  const paintHeader = () => { document.getElementById('site-header').innerHTML = U.header('me', site); };
  paintHeader();
  document.getElementById('site-footer').innerHTML = U.footer(site);

  const P = document.getElementById('me-profile');
  const $ = (id) => document.getElementById(id);

  function firstName(u) { return String(u?.name || u?.email || '').split(/[\s@]/)[0] || ''; }

  function renderProfile(checking) {
    const u = S.sb.user;
    if (!u) {
      P.innerHTML = `
<div class="profile-hero">
  <div class="profile-avatar" aria-hidden="true">☺</div>
  <div class="profile-copy">
    <p class="kicker">האזור האישי</p>
    <h1>שלום, מאזין.</h1>
    <p class="desc">התחברו כדי שהאזור האישי יזהה אתכם: ממשיכים מאיפה שעצרתם, "לאחר כך", היסטוריית ההאזנה וההעדפות — הכול במקום אחד.${S.sb.configured ? '' : ' (ההתחברות אינה מוגדרת באתר הזה; הנתונים שלמטה נשמרים במכשיר.)'}</p>
    <div class="actions">${S.sb.configured ? '<div class="google-slot" data-google></div>' : ''}<a class="btn" href="archive.html">לארכיון</a></div>
    ${S.sb.configured ? '<p class="cue-hint" style="margin-top:10px;font-size:12px;color:var(--muted);font-weight:700"><a href="#" data-login>בעיה עם הכפתור? כניסה דרך אתר הסקר</a></p>' : ''}
  </div>
</div>`;
      if (S.sb.configured) S.sb.google(P.querySelector('[data-google]'), { onDone: async (u) => { await S.sb.isAdmin().catch(() => {}); renderProfile(false); paintHeader(); renderSubscription(); U.notify(`שלום, ${firstName(u) || 'מאזין'}. התחברתם.`, 'success'); }, onError: (err) => U.notify(`ההתחברות לא הצליחה: ${err.message}`, 'error') })
        .catch((err) => { const g = P.querySelector('[data-google]'); if (g) g.innerHTML = `<button type="button" class="btn xl primary" data-login>התחברות עם Google <span>←</span></button><small class="cue-hint">${esc(err.message)}</small>`; });
      return;
    }
    const name = firstName(u);
    P.innerHTML = `
<div class="profile-hero">
  ${u.picture ? `<img class="profile-avatar" src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<div class="profile-avatar" aria-hidden="true">${esc(name.slice(0, 1) || '☺')}</div>`}
  <div class="profile-copy">
    <p class="kicker">האזור האישי${u.isAdmin ? ' · <span class="pill gold" style="vertical-align:middle">מנהל</span>' : ''}</p>
    <h1>שלום, ${esc(name || 'מאזין')}.</h1>
    <p class="desc">${esc(u.email || '')}${checking ? ' · מאמתים…' : ''}</p>
    <div class="actions">
      ${u.isAdmin ? '<a class="btn xl primary" href="admin.html">מעבר לניהול <span>←</span></a>' : ''}
      <a class="btn" href="archive.html">לארכיון</a>
      <button type="button" class="btn ghost" data-logout>התנתקות</button>
    </div>
  </div>
</div>`;
  }

  /** רשימת התפוצה באזור האישי: הצטרפות או הסרה בלחיצה */
  function renderSubscription() {
    const box = document.getElementById('me-subscribe'); if (!box) return;
    if (!S.sb.configured || !S.sb.user) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="section-title"><div><p class="kicker">רשימת התפוצה</p><h2>התוכנית החדשה במייל</h2></div></div><div class="card-body"><div data-subscribe-host></div></div>`;
    U.mountSubscribe(box.querySelector('[data-subscribe-host]'));
  }

  function renderLists() {
    const all = S.episodes();
    const resumable = S.positions.resumable();
    const laterIds = S.later.list();
    const later = laterIds.map((id) => S.byId(id)).filter((e) => e && e.visible);
    const history = S.history.list().map((h) => ({ ...h, episode: S.byId(h.id) })).filter((h) => h.episode && h.episode.visible).slice(0, 20);
    let listened = 0;
    for (const e of all) { const p = S.positions.get(e.id); if (p) listened += p.t; }

    $('me-stats').innerHTML = `
<div class="stats">
  <div class="stat"><b>${history.length}</b><small>תוכניות ששמעתם</small></div>
  <div class="stat"><b>${listened >= 3600 ? Math.round(listened / 3600) : Math.round(listened / 60)}</b><small>${listened >= 3600 ? 'שעות האזנה' : 'דקות האזנה'}</small></div>
  <div class="stat"><b>${resumable.length}</b><small>באמצע</small></div>
  <div class="stat"><b>${later.length}</b><small>לאחר כך</small></div>
</div>`;

    $('me-resume').innerHTML = resumable.length ? `
<div class="grid-head"><div><p class="kicker">ממשיכים</p><h2>מאיפה שעצרתם</h2></div><button type="button" class="chip" data-clear-positions>ניקוי</button></div>
<div class="row-list">
  ${resumable.map((r) => `
  <div class="row" data-ep="${esc(r.episode.id)}" style="${U.coverVars(r.episode)}">
    <button type="button" class="row-main" data-cue="${esc(r.episode.id)}" data-at="${r.t}">
      <i aria-hidden="true" style="background:hsl(var(--h) 70% 40% / .5);border-color:hsl(var(--h) 80% 60% / .6)">▶</i>
      <span class="txt"><b>${esc(r.episode.title)}</b><small>נשארו ${esc(fmtDuration(Math.max(60, (r.dur || r.episode.duration) - r.t)))} · ${esc(fmtDate(r.episode.date, true))}</small></span>
    </button>
    <span class="time">${fmtTime(r.t)}</span>
  </div>`).join('')}
</div>` : '';

    $('me-later').innerHTML = later.length ? `
<div class="grid-head"><div><p class="kicker">שמרתם</p><h2>לאחר כך</h2></div><a href="archive.html?later=1">בארכיון ←</a></div>
<div class="ep-grid">${later.map((e) => U.epCard(e)).join('')}</div>
<div class="actions">${later.map((e) => `<button type="button" class="chip" data-unlater="${esc(e.id)}">✕ ${esc(e.title)}</button>`).join('')}</div>` : `
<div class="grid-head"><div><p class="kicker">שמרתם</p><h2>לאחר כך</h2></div></div>
<div class="card"><div class="state"><span class="mark">+</span><h3>הרשימה ריקה</h3><p>לחצו "+ לאחר כך" בכל תוכנית כדי לשמור אותה כאן.</p></div></div>`;

    $('me-history').innerHTML = history.length ? `
<div class="grid-head"><div><p class="kicker">שמעתם</p><h2>היסטוריית האזנה</h2></div><button type="button" class="chip" data-clear-history>ניקוי</button></div>
<div class="row-list">
  ${history.map((h) => `
  <div class="row" data-ep="${esc(h.episode.id)}" style="${U.coverVars(h.episode)}">
    <a class="row-main" href="episode.html?ep=${encodeURIComponent(h.episode.slug)}">
      <i aria-hidden="true" style="background:hsl(var(--h) 70% 40% / .5);border-color:hsl(var(--h) 80% 60% / .6)">${h.episode.number ?? '♫'}</i>
      <span class="txt"><b>${esc(h.episode.title)}</b><small>${esc(new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(h.at)))}</small></span>
    </a>
    ${h.episode.stream ? `<button type="button" class="icon-btn solid" data-play="${esc(h.episode.id)}" aria-label="האזנה ל${esc(h.episode.title)}">▶</button>` : ''}
  </div>`).join('')}
</div>` : '';

    const rate = S.prefs.get('rate', 1);
    $('me-prefs').innerHTML = `
<div class="section-title"><div><p class="kicker">העדפות</p><h2>ככה אתם אוהבים</h2></div></div>
<div class="card-body">
  <div class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
    <label class="field"><span>מהירות ניגון קבועה</span><select class="input" data-pref-rate>${[0.75, 1, 1.25, 1.5, 2].map((r) => `<option value="${r}" ${Number(rate) === r ? 'selected' : ''}>${r === 1 ? 'רגילה' : `${r}×`}</option>`).join('')}</select></label>
    <div class="field"><span>הנתונים שלכם</span><small>ההאזנה, "לאחר כך" וההיסטוריה נשמרים במכשיר הזה בלבד.</small><div class="actions" style="margin-top:6px"><button type="button" class="btn small" data-clear-positions>מחיקת מיקומי האזנה</button><button type="button" class="btn small danger" data-clear-all>מחיקת כל הנתונים האישיים</button></div></div>
  </div>
</div>`;
    document.querySelectorAll('#me-resume, #me-later, #me-history').forEach((el) => { if (el.innerHTML.trim()) el.setAttribute('data-reveal', ''); });
    U.reveal();
  }

  /* ---------- התחלה ---------- */
  renderProfile(!!S.sb.user);
  renderLists();
  renderSubscription();
  if (S.sb.user) {
    try { await S.sb.isAdmin(); } catch { /* נשאר עם מה שיש */ }
    renderProfile(false); paintHeader();
  }

  /* ---------- אירועים ---------- */
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-login]')) {
      e.preventDefault();
      const b = e.target.closest('[data-login]'); b.disabled = true;
      try { const u = await S.sb.signIn(); await S.sb.isAdmin().catch(() => {}); renderProfile(false); paintHeader(); renderSubscription(); U.notify(`שלום, ${firstName(u) || 'מאזין'}. התחברתם.`, 'success'); }
      catch (err) { U.notify(`ההתחברות נכשלה: ${err.message}`, 'error'); b.disabled = false; }
      return;
    }
    if (e.target.closest('[data-logout]')) { S.sb.signOut(); renderProfile(false); paintHeader(); renderSubscription(); U.notify('התנתקתם.', 'success'); return; }
    const play = e.target.closest('[data-play]');
    if (play) { const ep = S.byId(play.dataset.play); if (ep) Pl.isCurrent(ep.id) ? Pl.toggle() : Pl.load(ep); return; }
    const cue = e.target.closest('[data-cue]');
    if (cue) { const ep = S.byId(cue.dataset.cue); if (!ep) return; const at = Number(cue.dataset.at) || 0; Pl.isCurrent(ep.id) ? (Pl.seek(at), Pl.play()) : Pl.load(ep, { at }); return; }
    const un = e.target.closest('[data-unlater]');
    if (un) { S.later.toggle(un.dataset.unlater); renderLists(); U.notify('הוסר מרשימת "לאחר כך".', 'success'); return; }
    if (e.target.closest('[data-clear-history]')) { S.history.clear(); renderLists(); U.notify('ההיסטוריה נמחקה.', 'success'); return; }
    if (e.target.closest('[data-clear-positions]')) { if (!confirm('למחוק את כל מיקומי ההאזנה השמורים?')) return; S.episodes({ includeHidden: true }).forEach((ep) => S.positions.clear(ep.id)); renderLists(); U.notify('מיקומי ההאזנה נמחקו.', 'success'); return; }
    if (e.target.closest('[data-clear-all]')) {
      if (!confirm('למחוק את כל הנתונים האישיים במכשיר הזה (האזנה, לאחר כך, היסטוריה והעדפות)?')) return;
      try { Object.keys(localStorage).filter((k) => k.startsWith('rosh:') && k !== 'rosh:override' && k !== 'rosh:cf:session').forEach((k) => localStorage.removeItem(k)); } catch { /* */ }
      renderLists(); U.notify('הנתונים האישיים נמחקו.', 'success');
    }
  });
  document.addEventListener('change', (e) => { if (e.target.matches('[data-pref-rate]')) { Pl.setRate(Number(e.target.value)); U.notify('המהירות נשמרה.', 'success'); } });
  window.addEventListener('rosh:player', (ev) => {
    const id = ev.detail.episode?.id;
    document.querySelectorAll('[data-ep]').forEach((c) => { c.classList.toggle('current', c.dataset.ep === id); c.classList.toggle('selected', c.classList.contains('row') && c.dataset.ep === id); });
  });
})();
