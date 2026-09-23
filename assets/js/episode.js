/* דף תוכנית: הקלטה בנגן של האתר, קישור לכל רגע, שיתוף, קודמת/הבאה,
   ועוד מאותה עונה. ההקלטה מוזרמת ישירות — בלי נגן חיצוני. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore, Pl = window.RoshPlayer;
  const { esc, fmtTime, fmtDate, fmtDuration, fmtWeekday } = U;

  await S.ready;
  const on = { signal: window.RoshApp?.signal };   // המאזינים מוסרים במעבר לדף אחר
  const site = S.site || {};
  document.getElementById('site-header').innerHTML = U.header('episode', site);
  document.getElementById('site-footer').innerHTML = U.footer(site);

  const A = document.getElementById('episode');
  // ?ep=… בכתובת, או דף סטטי של התוכנית (episodes/<slug>.html) שמסמן את עצמו ב־data-ep
  const slug = U.qs('ep') || document.body.dataset.ep || '';
  const ep = slug ? S.bySlug(slug) : null;

  // תוכנית מוסתרת, או מתוזמנת שעוד לא הגיע זמנה — רק מנהלים רואים אותה
  if (!ep || ((!ep.visible || S.scheduled(ep)) && !S.sb.user?.isAdmin)) {
    document.title = `התוכנית לא נמצאה — ${site.name || 'ראש בראש'}`;
    A.innerHTML = `<div class="state error"><span class="mark">!</span><h3>התוכנית לא נמצאה</h3><p>${S.state.error ? 'טעינת רשימת התוכניות נכשלה. בדקו את החיבור ונסו שוב.' : 'ייתכן שהקישור ישן או שהתוכנית הוסרה מהארכיון.'}</p><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${S.state.error ? '<button type="button" class="btn" data-reload-page>ניסיון חוזר</button>' : ''}<a class="btn primary" href="archive.html">לארכיון התוכניות <span>←</span></a></div></div>`;
    A.querySelector('[data-reload-page]')?.addEventListener('click', () => location.reload());
    return;
  }

  const season = S.seasons().find((s) => s.id === ep.season);
  const stream = ep.stream;
  document.title = `${ep.title} — ${site.name || 'ראש בראש'}`;
  document.querySelector('meta[name="description"]').setAttribute('content', ep.description.slice(0, 160) || ep.title);

  // נתונים מובנים למנועי חיפוש
  document.querySelectorAll('script[type="application/ld+json"]').forEach((x) => x.remove());   // בדף הסטטי כבר יש אחד
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'RadioEpisode', name: ep.title, datePublished: ep.date || undefined,
    episodeNumber: ep.number ?? undefined, description: ep.description || undefined, image: ep.cover || undefined,
    partOfSeries: { '@type': 'RadioSeries', name: site.name || 'ראש בראש' },
    associatedMedia: stream ? { '@type': 'AudioObject', contentUrl: new URL(stream, location.href).href, duration: ep.duration ? `PT${ep.duration}S` : undefined } : undefined,
  });
  document.head.appendChild(ld);

  const links = U.publicLinks(ep);
  A.style.cssText = U.coverVars(ep);
  A.innerHTML = `
<div class="section-title">
  <div><p class="kicker">${ep.number != null ? `תוכנית ${ep.number}` : (ep.season === 'sets' ? 'סט' : 'תוכנית')}${season ? ` · ${esc(season.title)}` : ''}</p><h1>${esc(ep.title)}</h1></div>
  ${ep.date ? `<strong>${esc(fmtDate(ep.date, true))}</strong>` : ''}
</div>
<div class="ep-hero">
  <div class="cover">${ep.cover ? `<img src="${esc(ep.cover)}" alt="">` : `<div class="vinyl" data-num="${ep.number ?? '♫'}" style="--label:${U.hue(ep)}" data-vinyl="${esc(ep.id)}"><i></i></div>`}</div>
  <div>
    <div class="meta">
      ${ep.date ? `<span class="pill">${esc(fmtWeekday(ep.date))}, ${esc(fmtDate(ep.date))}</span><span class="pill">${esc(U.fmtHebDate(ep.date))}</span>` : ''}
      ${ep.duration ? `<span class="pill teal">${esc(fmtDuration(ep.duration))}</span>` : ''}
      ${ep.guests.length ? `<span class="pill navy">עם ${esc(ep.guests.join(', '))}</span>` : ''}
      ${ep.tags.map((t) => `<a class="chip" href="archive.html?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
    </div>
    ${ep.description ? `<p class="desc">${esc(ep.description)}</p>` : ''}
    <div class="actions">
      ${stream ? `<button type="button" class="btn xl primary" data-play>האזנה לתוכנית <span>▶</span></button>` : `<span class="pill">אין עדיין הקלטה לתוכנית הזו</span>`}
      ${U.actionButtons(ep)}
      <button type="button" class="btn" data-share>שיתוף</button>
      ${U.downloadUrl(ep) ? `<a class="btn ghost" href="${esc(U.downloadUrl(ep))}" download="${esc(ep.title)}.mp3" rel="noopener">הורדת ההקלטה</a>` : ''}
      ${links.map((l) => `<a class="btn ghost" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}
    </div>
  </div>
</div>
<div class="now-playing-strip" id="now-strip" hidden></div>
${ep.surveyId && S.settings.survey?.id === ep.surveyId ? `<div class="card-body" style="padding-top:0"><div class="site-banner${S.settings.survey.open ? ' vote' : ''}" style="margin:0"><span class="site-banner-mark" aria-hidden="true">${S.settings.survey.open ? '✓' : '✦'}</span><p>${S.settings.survey.open ? `המצעד של התוכנית הזו פתוח להצבעה${S.settings.survey.name ? ` — <b>${esc(S.settings.survey.name)}</b>` : ''}` : `התוכנית הזו מקושרת למצעד${S.settings.survey.name ? ` "${esc(S.settings.survey.name)}"` : ''} — ההצבעה הסתיימה`}</p>${S.settings.survey.open ? `<a class="btn small primary" href="${esc(S.settings.survey.url)}" target="_blank" rel="noopener">הצביעו עכשיו <span>←</span></a>` : ''}</div></div>` : ''}
${S.sb.configured ? '<section class="card-body comments" id="comments" aria-labelledby="comments-title"></section>' : ''}
${(() => { const form = U.messageForm({ episodeId: ep.id, title: 'הודעה פרטית למגישים', hint: 'רק המגישים יקראו אותה — לא תוצג באתר.' }); return form ? `<details class="card-body private-msg" style="padding-top:0"><summary>הודעה פרטית למגישים</summary>${form}</details>` : ''; })()}
`;

  // קודמת / הבאה
  const nb = S.neighbors(ep.id);
  document.getElementById('prevnext').innerHTML = `
${nb.older ? `<a href="episode.html?ep=${encodeURIComponent(nb.older.slug)}"><small>התוכנית הקודמת</small><b>${esc(nb.older.title)}</b></a>` : '<span></span>'}
${nb.newer ? `<a href="episode.html?ep=${encodeURIComponent(nb.newer.slug)}"><small>התוכנית הבאה</small><b>${esc(nb.newer.title)}</b></a>` : '<span></span>'}`;

  // עוד מאותה עונה
  const more = S.episodes().filter((e) => e.id !== ep.id && e.season === ep.season).slice(0, 4);
  const M = document.getElementById('more');
  if (more.length) {
    M.setAttribute('data-reveal', '');
    M.innerHTML = `<div class="grid-head"><div><p class="kicker">${season ? esc(season.title) : 'עוד'}</p><h2>עוד מאותה תקופה</h2></div><a href="archive.html${ep.season ? `?season=${encodeURIComponent(ep.season)}` : ''}">לכל התוכניות ←</a></div><div class="ep-grid">${more.map((e) => U.epCard(e)).join('')}</div>`;
  }
  U.reveal();

  /* ---------- תגובות המאזינים ----------
     תגובה יכולה להיות על כל התוכנית או על רגע מסוים בה ("בדקה 12:34"). תגובות
     על רגע מופיעות גם כסימנים על פס ההתקדמות בנגן. המגישים מאשרים כל תגובה,
     יכולים לענות עליה, ולבחור "תגובה נבחרת" שמופיעה ראשונה. */
  const C = document.getElementById('comments');
  let comments = [], mine = [];
  const ago = (unix) => {
    const s = Math.max(0, Date.now() / 1000 - Number(unix || 0));
    if (s < 3600) return 'לפני כמה דקות';
    if (s < 86400) { const h = Math.round(s / 3600); return h === 1 ? 'לפני שעה' : h === 2 ? 'לפני שעתיים' : `לפני ${h} שעות`; }
    const d = Math.round(s / 86400); if (d < 30) return d === 1 ? 'אתמול' : `לפני ${d} ימים`;
    return fmtDate(new Date(unix * 1000).toISOString().slice(0, 10), true);
  };
  const momentBtn = (at) => (at != null ? `<button type="button" class="moment-chip" data-seek="${Number(at)}" aria-label="האזנה מהרגע ${fmtTime(at)}">▶ ${fmtTime(at)}</button>` : '');
  function commentHtml(c, pending = false) {
    return `<li class="comment${c.pinned ? ' pinned' : ''}${pending ? ' pending' : ''}" id="c-${esc(c.id)}">
  <div class="comment-head"><b>${esc(c.name || 'מאזין')}</b>${c.pinned ? '<span class="pill gold">★ תגובה נבחרת</span>' : ''}${momentBtn(c.at)}<small>${pending ? 'ממתינה לאישור המגישים' : esc(ago(c.createdAt))}</small></div>
  <p>${esc(c.text)}</p>
  ${c.reply ? `<div class="comment-reply"><span>המגישים עונים</span><p>${esc(c.reply)}</p></div>` : ''}
</li>`;
  }
  function paintComments() {
    if (!C) return;
    const u = S.sb.user;
    const playingHere = Pl.isCurrent(ep.id) && Pl.time > 5;
    C.innerHTML = `
<div class="grid-head"><div><p class="kicker">מה המאזינים אומרים</p><h2 id="comments-title">תגובות${comments.length ? ` <span class="count">${comments.length}</span>` : ''}</h2></div></div>
${u ? `<form class="comment-form" data-comment-form>
  <label class="field"><span>התגובה שלכם</span><textarea name="text" required minlength="2" maxlength="1000" placeholder="מה חשבתם על התוכנית? על ויכוח, על שיר, על אורח…"></textarea></label>
  <div class="comment-form-foot">
    ${stream ? `<label class="check"><input type="checkbox" name="moment" ${playingHere ? 'checked' : ''} ${Pl.isCurrent(ep.id) ? '' : 'disabled'}> <span data-moment-label>${Pl.isCurrent(ep.id) ? `על הרגע הזה בתוכנית (${fmtTime(Pl.time)})` : 'על רגע מסוים — התחילו להאזין כדי לבחור רגע'}</span></label>` : ''}
    <button type="submit" class="btn primary">פרסום התגובה <span>←</span></button>
  </div>
  <p class="cue-hint">התגובה תופיע אחרי שהמגישים יאשרו אותה, בשם ${esc(String(u.name || '').split(' ')[0] || 'מאזין')}.</p>
</form>` : `<div class="comment-login"><p>כדי להגיב צריך להתחבר עם Google — כך התגובות נשארות נקיות ומכבדות.</p><a class="btn" href="me.html">להתחברות <span>←</span></a></div>`}
${mine.length ? `<ul class="comment-list mine">${mine.map((c) => commentHtml(c, true)).join('')}</ul>` : ''}
${comments.length ? `<ul class="comment-list">${comments.map((c) => commentHtml(c)).join('')}</ul>` : '<p class="cue-hint">עדיין אין תגובות. היו הראשונים.</p>'}`;
    Pl.setMarkers?.(ep.id, comments.filter((c) => c.at != null).map((c) => ({ at: c.at, label: `${c.name || 'מאזין'}: ${c.text.slice(0, 60)}` })));
  }
  async function loadComments() {
    if (!C) return;
    try {
      const r = await S.sb.call(`/api/program/comments?episode=${encodeURIComponent(ep.id)}`);
      comments = r.comments || []; mine = r.mine || [];
    } catch { comments = []; mine = []; }
    if (!on.signal?.aborted) paintComments();
  }
  if (C) {
    paintComments(); loadComments();
    const offSession = S.onSession(() => loadComments());
    on.signal?.addEventListener('abort', () => { offSession(); Pl.setMarkers?.(ep.id, []); });
    C.addEventListener('click', (e) => {
      const seek = e.target.closest('[data-seek]');
      if (seek) { const at = Number(seek.dataset.seek); Pl.isCurrent(ep.id) ? (Pl.seek(at), Pl.play()) : Pl.load(ep, { at }); }
    });
    C.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-comment-form]'); if (!f) return;
      e.preventDefault();
      const text = f.elements.text.value.trim(); if (text.length < 2) return;
      const at = f.elements.moment?.checked && Pl.isCurrent(ep.id) ? Math.floor(Pl.time) : undefined;
      const btn = f.querySelector('button[type="submit"]'); btn.disabled = true;
      try {
        const r = await S.sb.call('/api/program/comments', { method: 'POST', body: { episodeId: ep.id, text, at } });
        mine = [r.comment, ...mine.filter((c) => c.id !== r.comment?.id)].filter(Boolean);
        paintComments();
        U.notify('תודה! התגובה תופיע אחרי שהמגישים יאשרו אותה.', 'success');
      } catch (err) { U.notify(`התגובה לא נשלחה: ${err.message}`, 'error'); btn.disabled = false; }
    });
  }

  /* ---------- קישור עמוק לרגע ---------- */
  const tParam = Number(U.qs('t'));
  if (stream && tParam > 0) {
    Pl.load(ep, { at: tParam, autoplay: true, quiet: true });
    U.notify(`מתחילים מ־${fmtTime(tParam)}. אם הניגון לא התחיל, לחצו ▶.`, 'info');
  }

  /* ---------- אירועים ---------- */
  A.addEventListener('click', async (e) => {
    if (e.target.closest('[data-play]')) { Pl.isCurrent(ep.id) ? Pl.toggle() : Pl.load(ep); return; }
    if (e.target.closest('[data-share]')) {
      const url = U.shareUrl(ep);
      if (navigator.share) { try { await navigator.share({ title: ep.title, text: ep.description.slice(0, 120), url }); return; } catch { /* בוטל */ } }
      (await U.copy(url)) ? U.notify('הקישור לתוכנית הועתק.', 'success') : U.notify('ההעתקה נכשלה. הכתובת: ' + url, 'error');
      return;
    }
  });
  S.likes.load().then(() => { if (!on.signal?.aborted) U.paintActions(ep.id); });

  const strip = document.getElementById('now-strip');
  window.addEventListener('rosh:player', (ev) => {
    const mine = ev.detail.episode?.id === ep.id;
    const btn = A.querySelector('[data-play]');
    if (btn) btn.innerHTML = mine && !Pl.paused ? 'השהיה <span>■</span>' : 'האזנה לתוכנית <span>▶</span>';
    A.querySelector('[data-vinyl]')?.classList.toggle('live', mine);
    document.querySelectorAll('#more .ep-card').forEach((c) => c.classList.toggle('current', c.dataset.ep === ev.detail.episode?.id));
    if (mine && ev.detail.type !== 'close') {
      strip.hidden = false;
      strip.innerHTML = `<span>${Pl.paused ? 'מושהה ב־' : 'מתנגן עכשיו ·'} ${fmtTime(ev.detail.time)}</span>`;
    } else strip.hidden = true;
    // התווית "על הרגע הזה" מתעדכנת לפי המקום בנגן
    const ml = C?.querySelector('[data-moment-label]'), mc = C?.querySelector('input[name="moment"]');
    if (ml && mine !== null && Pl.isCurrent(ep.id)) { ml.textContent = `על הרגע הזה בתוכנית (${fmtTime(Pl.time)})`; if (mc) mc.disabled = false; }
    if (ev.detail.type === 'episode' && mine) paintMarkers();
  }, on);
  function paintMarkers() { Pl.setMarkers?.(ep.id, comments.filter((c) => c.at != null).map((c) => ({ at: c.at, label: `${c.name || 'מאזין'}: ${c.text.slice(0, 60)}` }))); }
})();
