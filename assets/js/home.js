/* דף הבית: התוכנית האחרונה, המשך האזנה, תוכניות אחרונות ומספרים. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore, Pl = window.RoshPlayer;
  const { esc, fmtTime, fmtDate, fmtDuration } = U;

  await S.ready;
  const site = S.site || {};
  document.getElementById('site-header').innerHTML = U.header('home', site);
  document.getElementById('site-footer').innerHTML = U.footer(site);
  document.title = `${site.name || 'ראש בראש'} — ${site.tagline || 'מצעד המוזיקה הגדול'}`;
  for (const [sel, key] of [['[data-site-name]', 'name'], ['[data-site-tagline]', 'tagline'], ['[data-site-numeral]', 'numeral'], ['[data-site-numeral-label]', 'numeralLabel'], ['[data-site-description]', 'description']]) {
    const el = document.querySelector(sel); if (el && site[key]) el.textContent = site[key];
  }

  if (S.state.loadedFrom === 'override') U.notify('מוצגת טיוטה מקומית מאזור הניהול — רק במכשיר הזה.', 'info', { ttl: 6000 });
  else if (S.state.loadedFrom === 'json-fallback') U.notify('החיבור למקור הנתונים נכשל — מוצג העותק השמור באתר.', 'info', { ttl: 6000 });
  else if (S.state.error) U.notify('טעינת רשימת התוכניות נכשלה. בדקו את החיבור ונסו שוב.', 'error', { action: 'ניסיון חוזר', onAction: () => location.reload(), ttl: 0 });

  const list = S.episodes();
  const feat = S.featured();

  /* ---------- כרטיס תוכנית ---------- */
  function epCard(e, { badge } = {}) {
    const pos = S.positions.get(e.id);
    const pct = pos && e.duration ? Math.min(100, (pos.t / e.duration) * 100) : 0;
    return `
<a class="ep-card${Pl.isCurrent(e.id) ? ' current' : ''}" href="episode.html?ep=${encodeURIComponent(e.slug)}" data-ep="${esc(e.id)}">
  ${e.cover ? `<img class="ep-cover" src="${esc(e.cover)}" alt="" loading="lazy">` : `<span class="cover-fallback num" aria-hidden="true">${e.number ?? '♫'}</span>`}
  ${e.number != null ? `<span class="ep-num">תוכנית ${e.number}</span>` : ''}
  ${badge ? `<i class="ep-badge gold" aria-hidden="true">${badge}</i>` : (e.audio ? '<i class="ep-badge" aria-hidden="true">▶</i>' : '')}
  <b>${esc(e.title)}</b>
  <small>${esc(fmtDate(e.date, true))}${e.duration ? ` · ${esc(fmtDuration(e.duration))}` : ''}</small>
  ${e.tracks.length ? `<span class="ep-meta">♫ ${e.tracks.length} שירים</span>` : ''}
  ${pct ? `<span class="resume" aria-hidden="true"><i style="width:${pct}%"></i></span>` : ''}
</a>`;
  }

  /* ---------- התוכנית האחרונה ---------- */
  const F = document.getElementById('featured');
  if (!feat) {
    F.innerHTML = `<div class="card"><div class="state"><span class="mark">♫</span><h3>עדיין אין תוכניות</h3><p>הוסיפו את התוכנית הראשונה מאזור הניהול.</p><a class="btn primary" href="admin.html">לאזור הניהול <span>←</span></a></div></div>`;
  } else {
    const tracks = feat.tracks.slice(0, 5);
    F.innerHTML = `
<article class="card">
  <div class="section-title">
    <div><p class="kicker">${feat.featured ? 'התוכנית המומלצת' : 'התוכנית האחרונה'}</p><h2>${esc(feat.title)}</h2></div>
    ${feat.number != null ? `<strong>תוכנית ${feat.number}</strong>` : ''}
  </div>
  <div class="ep-hero">
    <div class="cover">${feat.cover ? `<img src="${esc(feat.cover)}" alt="">` : `<span class="cover-fallback num" aria-hidden="true">${feat.number ?? '♫'}</span>`}</div>
    <div>
      <div class="meta">
        ${feat.date ? `<span class="pill">${esc(U.fmtWeekday(feat.date))}, ${esc(fmtDate(feat.date))}</span>` : ''}
        ${feat.duration ? `<span class="pill teal">${esc(fmtDuration(feat.duration))}</span>` : ''}
        ${feat.tracks.length ? `<span class="pill">♫ ${feat.tracks.length} שירים</span>` : ''}
        ${feat.tags.map((t) => `<a class="chip" href="archive.html?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
      </div>
      <p class="desc">${esc(feat.description)}</p>
      <div class="actions">
        ${feat.audio ? `<button type="button" class="btn primary" data-play="${esc(feat.id)}">האזנה לתוכנית <span>▶</span></button>` : ''}
        <a class="btn" href="episode.html?ep=${encodeURIComponent(feat.slug)}">לדף התוכנית</a>
        <button type="button" class="btn" data-later="${esc(feat.id)}" aria-pressed="${S.later.has(feat.id)}">${S.later.has(feat.id) ? '✓ שמור לאחר כך' : '+ לאחר כך'}</button>
      </div>
    </div>
  </div>
  ${tracks.length ? `
  <div class="card-body" style="padding-top:0">
    <div class="tracks"><fieldset><legend><b>מה השמענו</b><small>${feat.tracks.length > tracks.length ? `${tracks.length} מתוך ${feat.tracks.length} שירים — הרשימה המלאה בדף התוכנית` : 'לחצו על שיר כדי לקפוץ אליו בהקלטה'}</small></legend>
      ${tracks.map((t, i) => `
      <div class="row" data-track="${i}">
        <button type="button" class="row-main" data-cue="${esc(feat.id)}" data-at="${t.at}" ${feat.audio ? '' : 'disabled'}>
          <span class="n"><span>${i + 1}</span></span>
          <span class="txt"><b>${esc(t.title)}</b>${t.artist ? `<small>${esc(t.artist)}</small>` : ''}</span>
        </button>
        <span class="time">${fmtTime(t.at)}</span>
      </div>`).join('')}
    </fieldset></div>
  </div>` : ''}
</article>`;
  }

  /* ---------- המשך האזנה ---------- */
  const R = document.getElementById('resume');
  const resumable = S.positions.resumable().filter((r) => r.episode.id !== feat?.id).slice(0, 4);
  if (resumable.length) {
    R.className = 'grid-section';
    R.innerHTML = `
<div class="grid-head"><div><p class="kicker">ממשיכים</p><h2>מאיפה שעצרתם</h2></div></div>
<div class="row-list">
  ${resumable.map((r) => `
  <div class="row">
    <button type="button" class="row-main" data-cue="${esc(r.episode.id)}" data-at="${r.t}">
      <i aria-hidden="true">▶</i>
      <span class="txt"><b>${esc(r.episode.title)}</b><small>נשארו ${esc(fmtDuration(Math.max(60, (r.dur || r.episode.duration) - r.t)))}</small></span>
    </button>
    <span class="time">${fmtTime(r.t)}</span>
  </div>`).join('')}
</div>`;
  }

  /* ---------- תוכניות אחרונות ---------- */
  const recent = list.filter((e) => e.id !== feat?.id).slice(0, 8);
  const Rc = document.getElementById('recent');
  Rc.innerHTML = recent.length ? `
<div class="grid-head"><div><p class="kicker">ארכיון</p><h2>תוכניות אחרונות</h2></div><a href="archive.html">לכל ${list.length} התוכניות ←</a></div>
<div class="ep-grid">${recent.map((e) => epCard(e)).join('')}</div>` : '';

  /* ---------- מספרים ---------- */
  const songs = S.songIndex().length;
  const totalSec = list.reduce((a, e) => a + (e.duration || 0), 0);
  const listen = totalSec >= 3600 ? [Math.round(totalSec / 3600), 'שעות האזנה'] : [Math.max(1, Math.round(totalSec / 60)), 'דקות האזנה'];
  document.getElementById('stats').innerHTML = list.length ? `
<div class="stats">
  <div class="stat"><b>${list.length}</b><small>תוכניות</small></div>
  <div class="stat"><b>${songs}</b><small>שירים ברשימות</small></div>
  <div class="stat"><b>${listen[0]}</b><small>${listen[1]}</small></div>
  <div class="stat"><b>${S.seasons().filter((s) => s.count).length}</b><small>עונות</small></div>
</div>` : '';

  /* ---------- עקבו אחרינו ---------- */
  const links = site.links || [];
  document.getElementById('follow').innerHTML = `
<section class="subscribe-card">
  <div class="subscribe-copy"><b>רוצים לשמוע מאיתנו?</b><small>${esc(site.description || 'כל התוכניות של ראש בראש במקום אחד.')}</small></div>
  <a class="continue btn" href="archive.html">לארכיון התוכניות <span>←</span></a>
  ${links.length ? `<p class="subscribe-note">${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(' · ')}</p>` : ''}
</section>`;

  /* ---------- אירועים ---------- */
  document.addEventListener('click', (e) => {
    const play = e.target.closest('[data-play]');
    if (play) { const ep = S.byId(play.dataset.play); if (ep) Pl.load(ep); return; }
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
    const { episode, trackIndex } = ev.detail;
    document.querySelectorAll('.ep-card').forEach((c) => c.classList.toggle('current', !!episode && c.dataset.ep === episode.id));
    if (feat && episode?.id === feat.id) {
      F.querySelectorAll('[data-track]').forEach((r) => r.toggleAttribute('aria-current', Number(r.dataset.track) === trackIndex) || r.setAttribute('aria-current', Number(r.dataset.track) === trackIndex ? 'true' : 'false'));
      F.querySelectorAll('[data-track]').forEach((r) => { if (r.getAttribute('aria-current') === 'false') r.removeAttribute('aria-current'); });
      const btn = F.querySelector('[data-play]');
      if (btn) btn.innerHTML = ev.detail.type === 'pause' || Pl.paused ? 'האזנה לתוכנית <span>▶</span>' : 'מתנגן עכשיו <span>■</span>';
    }
  });
})();
