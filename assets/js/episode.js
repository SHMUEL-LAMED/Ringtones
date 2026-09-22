/* דף תוכנית: הקלטה, רשימת השירים עם קפיצה לרגע, שיתוף, קודמת/הבאה. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore, Pl = window.RoshPlayer;
  const { esc, fmtTime, fmtDate, fmtDuration, fmtWeekday } = U;

  await S.ready;
  const site = S.site || {};
  document.getElementById('site-header').innerHTML = U.header('episode', site);
  document.getElementById('site-footer').innerHTML = U.footer(site);

  const A = document.getElementById('episode');
  const slug = U.qs('ep');
  const ep = slug ? S.bySlug(slug) : null;

  if (!ep || (!ep.visible && !S.admin.hasOverride)) {
    document.title = `התוכנית לא נמצאה — ${site.name || 'ראש בראש'}`;
    A.innerHTML = `<div class="state error"><span class="mark">!</span><h3>התוכנית לא נמצאה</h3><p>${S.state.error ? 'טעינת רשימת התוכניות נכשלה. בדקו את החיבור ונסו שוב.' : 'ייתכן שהקישור ישן או שהתוכנית הוסרה מהארכיון.'}</p><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${S.state.error ? '<button type="button" class="btn" onclick="location.reload()">ניסיון חוזר</button>' : ''}<a class="btn primary" href="archive.html">לארכיון התוכניות <span>←</span></a></div></div>`;
    return;
  }

  const season = S.seasons().find((s) => s.id === ep.season);
  document.title = `${ep.title} — ${site.name || 'ראש בראש'}`;
  document.querySelector('meta[name="description"]').setAttribute('content', ep.description.slice(0, 160) || ep.title);

  // נתונים מובנים למנועי חיפוש
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'RadioEpisode', name: ep.title, datePublished: ep.date || undefined,
    episodeNumber: ep.number ?? undefined, description: ep.description || undefined, image: ep.cover || undefined,
    partOfSeries: { '@type': 'RadioSeries', name: site.name || 'ראש בראש' },
    associatedMedia: ep.audio ? { '@type': 'AudioObject', contentUrl: new URL(ep.audio, location.href).href, duration: ep.duration ? `PT${ep.duration}S` : undefined } : undefined,
  });
  document.head.appendChild(ld);

  const isLater = S.later.has(ep.id);
  A.innerHTML = `
<div class="section-title">
  <div><p class="kicker">${ep.number != null ? `תוכנית ${ep.number}` : 'תוכנית'}${season ? ` · ${esc(season.title)}` : ''}</p><h1>${esc(ep.title)}</h1></div>
  ${ep.date ? `<strong>${esc(fmtDate(ep.date, true))}</strong>` : ''}
</div>
<div class="ep-hero">
  <div class="cover">${ep.cover ? `<img src="${esc(ep.cover)}" alt="">` : `<span class="cover-fallback num" aria-hidden="true">${ep.number ?? '♫'}</span>`}</div>
  <div>
    <div class="meta">
      ${ep.date ? `<span class="pill">${esc(fmtWeekday(ep.date))}, ${esc(fmtDate(ep.date))}</span>` : ''}
      ${ep.duration ? `<span class="pill teal">${esc(fmtDuration(ep.duration))}</span>` : ''}
      ${ep.tracks.length ? `<span class="pill">♫ ${ep.tracks.length} שירים</span>` : ''}
      ${ep.guests.length ? `<span class="pill navy">עם ${esc(ep.guests.join(', '))}</span>` : ''}
      ${ep.tags.map((t) => `<a class="chip" href="archive.html?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
    </div>
    ${ep.description ? `<p class="desc">${esc(ep.description)}</p>` : ''}
    <div class="actions">
      ${ep.audio
        ? `<button type="button" class="btn primary" data-play>האזנה לתוכנית <span>▶</span></button>`
        : `<span class="pill">אין עדיין הקלטה לתוכנית הזו</span>`}
      <button type="button" class="btn" data-later aria-pressed="${isLater}">${isLater ? '✓ שמור לאחר כך' : '+ לאחר כך'}</button>
      <button type="button" class="btn" data-share>שיתוף</button>
      ${ep.audio ? `<a class="btn" href="${esc(ep.audio)}" download>הורדת ההקלטה</a>` : ''}
      ${ep.links.map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}
    </div>
  </div>
</div>
<div class="now-playing-strip" id="now-strip" hidden></div>
${ep.tracks.length ? `
<div class="card-body">
  <div class="tracks"><fieldset>
    <legend><b>מה השמענו בתוכנית</b><small>${ep.audio ? 'לחצו על שיר כדי לקפוץ אליו בהקלטה. Shift + חץ עובר בין שירים.' : 'רשימת השירים לפי סדר ההשמעה.'}</small></legend>
    ${ep.tracks.map((t, i) => `
    <div class="row" data-track="${i}">
      <button type="button" class="row-main" data-at="${t.at}" ${ep.audio ? '' : 'disabled'} aria-label="${esc(t.title)}${t.artist ? `, ${esc(t.artist)}` : ''}, ${fmtTime(t.at)}">
        <span class="n"><span>${i + 1}</span></span>
        <span class="txt"><b>${esc(t.title)}</b>${t.artist || t.note ? `<small>${esc(t.artist)}${t.note ? `${t.artist ? ' · ' : ''}${esc(t.note)}` : ''}</small>` : ''}</span>
      </button>
      <span class="time">${fmtTime(t.at)}</span>
      <button type="button" class="icon-btn gold" data-copy-at="${t.at}" aria-label="העתקת קישור לרגע ${fmtTime(t.at)}" title="קישור לרגע הזה">←</button>
    </div>`).join('')}
  </fieldset></div>
</div>` : `<div class="card-body"><div class="state"><span class="mark">♫</span><h3>עדיין אין רשימת שירים</h3><p>רשימת השירים של התוכנית תתווסף בקרוב.</p></div></div>`}`;

  // קודמת / הבאה
  const nb = S.neighbors(ep.id);
  document.getElementById('prevnext').innerHTML = `
${nb.older ? `<a href="episode.html?ep=${encodeURIComponent(nb.older.slug)}"><small>התוכנית הקודמת</small><b>${esc(nb.older.title)}</b></a>` : '<span></span>'}
${nb.newer ? `<a href="episode.html?ep=${encodeURIComponent(nb.newer.slug)}"><small>התוכנית הבאה</small><b>${esc(nb.newer.title)}</b></a>` : '<span></span>'}`;

  /* ---------- קישור עמוק לרגע ---------- */
  const tParam = Number(U.qs('t'));
  if (ep.audio && tParam > 0) {
    Pl.load(ep, { at: tParam, autoplay: true, quiet: true });
    U.notify(`מתחילים מ־${fmtTime(tParam)}. אם הניגון לא התחיל, לחצו ▶.`, 'info');
  }

  /* ---------- אירועים ---------- */
  A.addEventListener('click', async (e) => {
    if (e.target.closest('[data-play]')) { Pl.isCurrent(ep.id) ? Pl.toggle() : Pl.load(ep); return; }
    const later = e.target.closest('[data-later]');
    if (later) { const on = S.later.toggle(ep.id); later.setAttribute('aria-pressed', String(on)); later.textContent = on ? '✓ שמור לאחר כך' : '+ לאחר כך'; U.notify(on ? 'נשמר לרשימת "לאחר כך".' : 'הוסר מרשימת "לאחר כך".', 'success'); return; }
    if (e.target.closest('[data-share]')) {
      const url = new URL(`episode.html?ep=${encodeURIComponent(ep.slug)}`, location.href).href;
      if (navigator.share) { try { await navigator.share({ title: ep.title, text: ep.description.slice(0, 120), url }); return; } catch { /* בוטל */ } }
      (await U.copy(url)) ? U.notify('הקישור לתוכנית הועתק.', 'success') : U.notify('ההעתקה נכשלה. הכתובת: ' + url, 'error');
      return;
    }
    const cp = e.target.closest('[data-copy-at]');
    if (cp) {
      const url = new URL(`episode.html?ep=${encodeURIComponent(ep.slug)}&t=${cp.dataset.copyAt}`, location.href).href;
      (await U.copy(url)) ? U.notify(`הקישור לרגע ${fmtTime(cp.dataset.copyAt)} הועתק.`, 'success') : U.notify('ההעתקה נכשלה. הכתובת: ' + url, 'error');
      return;
    }
    const row = e.target.closest('[data-at]');
    if (row) { const at = Number(row.dataset.at); Pl.isCurrent(ep.id) ? (Pl.seek(at), Pl.play()) : Pl.load(ep, { at }); }
  });

  const strip = document.getElementById('now-strip');
  window.addEventListener('rosh:player', (ev) => {
    const mine = ev.detail.episode?.id === ep.id;
    const btn = A.querySelector('[data-play]');
    if (btn) btn.innerHTML = mine && !Pl.paused ? 'השהיה <span>■</span>' : 'האזנה לתוכנית <span>▶</span>';
    A.querySelectorAll('[data-track]').forEach((r) => {
      if (mine && Number(r.dataset.track) === ev.detail.trackIndex) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
    });
    if (mine && ev.detail.type !== 'close') {
      const tr = ep.tracks[ev.detail.trackIndex];
      strip.hidden = false;
      strip.innerHTML = `<span>${Pl.paused ? 'מושהה ב־' : 'מתנגן עכשיו ·'} ${fmtTime(ev.detail.time)}</span>${tr ? `<b>♫ ${esc(tr.title)}${tr.artist ? ` — ${esc(tr.artist)}` : ''}</b>` : ''}`;
    } else strip.hidden = true;
  });
})();
