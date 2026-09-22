/* דף הבית: גיבור עם אקולייזר וסרט נע, התוכנית האחרונה על תקליט, המשך האזנה,
   תוכניות אחרונות, סטים, מספרים רצים והקהילה. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore, Pl = window.RoshPlayer;
  const { esc, fmtTime, fmtDate, fmtDuration } = U;

  await S.ready;
  const site = S.site || {};
  document.getElementById('site-header').innerHTML = U.header('home', site);
  document.getElementById('site-footer').innerHTML = U.footer(site);
  document.title = `${site.name || 'ראש בראש'} — ${site.tagline || 'מוזיקה ואקטואליה'}`;
  for (const [sel, key] of [['[data-site-name]', 'name'], ['[data-site-tagline]', 'tagline'], ['[data-site-description]', 'description']]) {
    const el = document.querySelector(sel); if (el && site[key]) { el.textContent = site[key]; if (el.dataset.text != null) el.dataset.text = site[key]; }
  }

  if (S.state.loadedFrom === 'override') U.notify('מוצגת טיוטה מקומית מאזור הניהול — רק במכשיר הזה.', 'info', { ttl: 6000 });
  else if (S.state.loadedFrom === 'json-fallback') U.notify('החיבור למקור הנתונים נכשל — מוצג העותק השמור באתר.', 'info', { ttl: 6000 });
  else if (S.state.error) U.notify('טעינת רשימת התוכניות נכשלה. בדקו את החיבור ונסו שוב.', 'error', { action: 'ניסיון חוזר', onAction: () => location.reload(), ttl: 0 });

  const list = S.episodes();
  const feat = S.featured();
  const shows = list.filter((e) => e.season !== 'sets');

  /* ---------- גיבור ---------- */
  document.getElementById('hero-eq').innerHTML = U.eqBars(56, 3);
  const live = document.getElementById('hero-live');
  if (feat) { live.hidden = false; live.querySelector('[data-live-title]').textContent = feat.number != null ? `תוכנית ${feat.number} · ${feat.title}` : feat.title; }
  const playLatest = document.querySelector('[data-play-latest]');
  const latestPlayable = (feat?.stream ? feat : null) || shows.find((e) => e.stream) || null;
  if (!latestPlayable) playLatest.hidden = true;

  // סרט נע: כל התוכניות בלולאה, פעמיים כדי שהמעבר יהיה חלק
  const tick = shows.slice(0, 40).map((e) => `<a href="episode.html?ep=${encodeURIComponent(e.slug)}">${e.number != null ? `<small>${e.number}</small>` : ''}<b>${esc(e.title)}</b></a>`).join('');
  document.getElementById('ticker').innerHTML = tick ? `<div class="ticker-track">${tick}${tick}</div>` : '';

  /* ---------- התוכנית האחרונה ---------- */
  const F = document.getElementById('featured');
  if (!feat) {
    F.innerHTML = `<div class="card"><div class="state"><span class="mark">♫</span><h3>עדיין אין תוכניות</h3><p>הוסיפו את התוכנית הראשונה מאזור הניהול.</p><a class="btn primary" href="admin.html">לאזור הניהול <span>←</span></a></div></div>`;
  } else {
    const season = S.seasons().find((s) => s.id === feat.season);
    F.innerHTML = `
<article class="card featured-card" style="${U.coverVars(feat)}">
  <div class="section-title">
    <div><p class="kicker">${feat.featured ? 'התוכנית המומלצת' : 'התוכנית האחרונה'}${season ? ` · ${esc(season.title)}` : ''}</p><h2>${esc(feat.title)}</h2></div>
    ${feat.number != null ? `<strong>תוכנית ${feat.number}</strong>` : ''}
  </div>
  <div class="ep-hero">
    <div class="cover">${feat.cover ? `<img src="${esc(feat.cover)}" alt="">` : `<div class="vinyl live" data-num="${feat.number ?? '♫'}" style="--label:${U.hue(feat)}" data-vinyl="${esc(feat.id)}"><i></i></div>`}</div>
    <div>
      <div class="meta">
        ${feat.date ? `<span class="pill">${esc(U.fmtWeekday(feat.date))}, ${esc(fmtDate(feat.date))}</span>` : ''}
        ${feat.duration ? `<span class="pill teal">${esc(fmtDuration(feat.duration))}</span>` : ''}
        ${feat.guests.length ? `<span class="pill navy">עם ${esc(feat.guests.join(', '))}</span>` : ''}
        ${feat.tags.map((t) => `<a class="chip" href="archive.html?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
      </div>
      <p class="desc">${esc(feat.description)}</p>
      <div class="actions">
        ${feat.stream ? `<button type="button" class="btn xl primary" data-play="${esc(feat.id)}">האזנה לתוכנית <span>▶</span></button>` : '<span class="pill">אין עדיין הקלטה לתוכנית הזו</span>'}
        <a class="btn" href="episode.html?ep=${encodeURIComponent(feat.slug)}">לדף התוכנית</a>
        <button type="button" class="btn" data-later="${esc(feat.id)}" aria-pressed="${S.later.has(feat.id)}">${S.later.has(feat.id) ? '✓ שמור לאחר כך' : '+ לאחר כך'}</button>
      </div>
    </div>
  </div>
</article>`;
  }

  /* ---------- המשך האזנה ---------- */
  const R = document.getElementById('resume');
  const resumable = S.positions.resumable().filter((r) => r.episode.id !== feat?.id).slice(0, 4);
  if (resumable.length) {
    R.className = 'grid-section';
    R.setAttribute('data-reveal', '');
    R.innerHTML = `
<div class="grid-head"><div><p class="kicker">ממשיכים</p><h2>מאיפה שעצרתם</h2></div><a href="me.html">לאזור האישי ←</a></div>
<div class="row-list">
  ${resumable.map((r) => `
  <div class="row" data-ep="${esc(r.episode.id)}">
    <button type="button" class="row-main" data-cue="${esc(r.episode.id)}" data-at="${r.t}">
      <i aria-hidden="true">▶</i>
      <span class="txt"><b>${esc(r.episode.title)}</b><small>נשארו ${esc(fmtDuration(Math.max(60, (r.dur || r.episode.duration) - r.t)))}</small></span>
    </button>
    <span class="time">${fmtTime(r.t)}</span>
  </div>`).join('')}
</div>`;
  }

  /* ---------- תוכניות אחרונות ---------- */
  const recent = shows.filter((e) => e.id !== feat?.id).slice(0, 8);
  const Rc = document.getElementById('recent');
  Rc.setAttribute('data-reveal', '');
  Rc.innerHTML = recent.length ? `
<div class="grid-head"><div><p class="kicker">ארכיון</p><h2>תוכניות אחרונות</h2></div><a href="archive.html">לכל ${list.length} התוכניות ←</a></div>
<div class="ep-grid">${recent.map((e) => U.epCard(e)).join('')}</div>` : '';

  /* ---------- סטים ---------- */
  const sets = list.filter((e) => e.season === 'sets');
  const Se = document.getElementById('sets');
  Se.setAttribute('data-reveal', '');
  Se.innerHTML = sets.length ? `<div class="grid-head"><div><p class="kicker">רק המוזיקה</p><h2>סטים מיוחדים</h2></div><a href="archive.html?season=sets">לכל הסטים ←</a></div><div class="ep-grid">${sets.map((e) => U.epCard(e)).join('')}</div>` : '';

  /* ---------- מספרים ---------- */
  const St = document.getElementById('stats');
  const nShows = list.filter((e) => e.season !== 'sets' && e.season !== 'legacy').length;
  const nLegacy = list.filter((e) => e.season === 'legacy').length;
  const nAudio = list.filter((e) => e.stream).length;
  St.setAttribute('data-reveal', '');
  St.innerHTML = list.length ? `
<div class="stats">
  <div class="stat"><b data-count="${nShows}">0</b><small>תוכניות ופרקי בונוס</small></div>
  <div class="stat"><b data-count="${nLegacy}">0</b><small>הקלטות מקו המכלול</small></div>
  <div class="stat"><b data-count="${sets.length}">0</b><small>סטים מיוחדים</small></div>
  <div class="stat"><b data-count="${nAudio}">0</b><small>הקלטות להאזנה</small></div>
</div>` : '';

  /* ---------- הקהילה ---------- */
  const links = U.publicLinks({ links: site.links || [] });
  const Fo = document.getElementById('follow');
  Fo.setAttribute('data-reveal', '');
  Fo.innerHTML = `
<section class="subscribe-card">
  <div class="subscribe-copy"><b>נשארים בראש</b><small>התוכנית החדשה ישירות למייל, בכל שבועיים.${S.sb.configured ? '' : ' שלחו בקשת הצטרפות לתפוצה.'}</small></div>
  ${S.sb.configured ? '<div data-subscribe-host></div>' : `<a class="continue btn xl primary" href="mailto:rbr17011701@gmail.com?subject=${encodeURIComponent('צרף')}">הצטרפות לתפוצה</a>`}
  ${links.length ? `<p class="subscribe-note">${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(' · ')}</p>` : ''}
</section>
<div class="community-grid"><article class="card card-body"><p class="kicker">קו התוכן</p><h2>גם בטלפון</h2><p>האזנה לתוכניות בשלוחה 1, שירים מומלצים בשלוחה 3 והרשמה לצינתוק בשלוחה 4.</p><a class="btn" href="tel:0772262271" dir="ltr">077-226-2271</a><p style="margin-top:10px">מספר נוסף: <a href="tel:0737079536" dir="ltr">073-707-9536</a></p></article><article class="card card-body"><p class="kicker">מדברים איתנו</p><h2>הקול שלכם</h2><p>לשאלות ולתגובות למגישים: שלוחה 9 בקו התוכן. פורום המאזינים נמצא בשלוחה 5.</p><a class="btn" href="mailto:rbr17011701@gmail.com?subject=${encodeURIComponent("צרף לצ'אט")}">בקשת הצטרפות לצ׳אט</a><p style="margin-top:10px">בבקשה ציינו לאיזו קבוצה להצטרף — גברים או נשים.</p>${U.messageForm({ title: 'או כתבו כאן', hint: 'ההודעה מגיעה ישירות למגישים.' })}</article></div>`;
  U.mountSubscribe(Fo.querySelector('[data-subscribe-host]'));

  U.reveal();

  // מספרים רצים כשהלוח נכנס למסך
  const counters = [...document.querySelectorAll('[data-count]')];
  if (counters.length) {
    const run = () => counters.forEach((el) => U.countUp(el, Number(el.dataset.count)));
    if (typeof IntersectionObserver === 'function' && !U.reduceMotion()) {
      const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) { run(); io.disconnect(); } }, { threshold: .2 });
      io.observe(St);
    } else run();
  }

  /* ---------- אירועים ---------- */
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-play-latest]')) { if (latestPlayable) Pl.isCurrent(latestPlayable.id) ? Pl.toggle() : Pl.load(latestPlayable); return; }
    if (e.target.closest('[data-random]')) { Pl.random(); return; }
    const play = e.target.closest('[data-play]');
    if (play) { const ep = S.byId(play.dataset.play); if (ep) Pl.isCurrent(ep.id) ? Pl.toggle() : Pl.load(ep); return; }
    const cue = e.target.closest('[data-cue]');
    if (cue) {
      const ep = S.byId(cue.dataset.cue); if (!ep) return;
      const at = Number(cue.dataset.at) || 0;
      if (Pl.isCurrent(ep.id)) { Pl.seek(at); Pl.play(); } else Pl.load(ep, { at });
      return;
    }
    const later = e.target.closest('[data-later]');
    if (later) {
      const on = S.later.toggle(later.dataset.later);
      later.setAttribute('aria-pressed', String(on));
      later.textContent = on ? '✓ שמור לאחר כך' : '+ לאחר כך';
      U.notify(on ? 'נשמר לרשימת "לאחר כך".' : 'הוסר מרשימת "לאחר כך".', 'success');
    }
  });

  window.addEventListener('rosh:player', (ev) => {
    const { episode } = ev.detail;
    document.querySelectorAll('.ep-card').forEach((c) => c.classList.toggle('current', !!episode && c.dataset.ep === episode.id));
    if (feat && episode?.id === feat.id) {
      const btn = F.querySelector('[data-play]');
      if (btn) btn.innerHTML = Pl.paused ? 'האזנה לתוכנית <span>▶</span>' : 'השהיה <span>■</span>';
    }
    if (latestPlayable && episode?.id === latestPlayable.id) playLatest.innerHTML = Pl.paused ? 'האזנה לתוכנית האחרונה <span>▶</span>' : 'מתנגן עכשיו <span>■</span>';
    document.querySelectorAll('[data-vinyl]').forEach((v) => v.classList.toggle('live', !!episode && v.dataset.vinyl === episode.id));
  });
})();
