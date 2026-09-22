/* ארכיון התוכניות: חיפוש, סינון לפי עונה, מיון ותצוגות. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore, Pl = window.RoshPlayer;
  const { esc, fmtTime, fmtDate, fmtDuration } = U;

  await S.ready;
  const site = S.site || {};
  document.getElementById('site-header').innerHTML = U.header('archive', site);
  document.getElementById('site-footer').innerHTML = U.footer(site);
  if (S.state.loadedFrom === 'json-fallback') U.notify('החיבור למקור הנתונים נכשל — מוצג העותק השמור באתר.', 'info', { ttl: 6000 });
  else if (S.state.error && S.state.loadedFrom !== 'override') U.notify('טעינת רשימת התוכניות נכשלה. בדקו את החיבור ונסו שוב.', 'error', { action: 'ניסיון חוזר', onAction: () => location.reload(), ttl: 0 });

  const params = new URLSearchParams(location.search);
  const state = {
    q: params.get('q') || '',
    season: params.get('season') || '',
    audio: params.get('audio') === '1',
    later: params.get('later') === '1',
    sort: params.get('sort') || 'new',
    view: params.get('view') || S.prefs.get('archiveView', 'grid'),
  };

  const qEl = document.getElementById('q');
  qEl.value = state.q;
  document.getElementById('search-form').addEventListener('submit', (e) => e.preventDefault());
  let t;
  qEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = qEl.value; render(); }, 120); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !U.isTyping(e)) { e.preventDefault(); qEl.focus(); qEl.select(); }
    if (e.key === 'Escape' && document.activeElement === qEl) { qEl.value = ''; state.q = ''; render(); }
  });

  const seasons = S.seasons();
  const all = S.episodes();

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.season) p.set('season', state.season);
    if (state.audio) p.set('audio', '1');
    if (state.later) p.set('later', '1');
    if (state.sort !== 'new') p.set('sort', state.sort);
    if (state.view !== 'grid') p.set('view', state.view);
    history.replaceState(null, '', `${location.pathname}${p.toString() ? '?' + p : ''}`);
    S.prefs.set('archiveView', state.view);
  }

  function renderFilters() {
    document.getElementById('filters').innerHTML = `
<button type="button" class="chip" data-season="" aria-pressed="${!state.season}">כל העונות</button>
${seasons.filter((s) => s.count).map((s) => `<button type="button" class="chip" data-season="${esc(s.id)}" style="${U.seasonVars(s.id)}" aria-pressed="${state.season === s.id}">${esc(s.title)} <span style="opacity:.6">${s.count}</span></button>`).join('')}
<button type="button" class="chip" data-audio aria-pressed="${state.audio}">עם הקלטה</button>
<button type="button" class="chip" data-later aria-pressed="${state.later}">לאחר כך</button>
<span class="spacer"></span>
<label class="visually-hidden" for="sort">מיון</label>
<select id="sort" class="input" style="width:auto;min-height:36px;padding-block:6px;border-radius:99px;font-size:12px;font-weight:800">
  <option value="new" ${state.sort === 'new' ? 'selected' : ''}>מהחדשה לישנה</option>
  <option value="old" ${state.sort === 'old' ? 'selected' : ''}>מהישנה לחדשה</option>
  <option value="num" ${state.sort === 'num' ? 'selected' : ''}>לפי מספר תוכנית</option>
  <option value="long" ${state.sort === 'long' ? 'selected' : ''}>הארוכות קודם</option>
</select>
<div class="segmented" role="group" aria-label="תצוגה">
  <button type="button" data-view="grid" aria-pressed="${state.view === 'grid'}">רשת</button>
  <button type="button" data-view="list" aria-pressed="${state.view === 'list'}">רשימה</button>
  <button type="button" data-view="seasons" aria-pressed="${state.view === 'seasons'}">לפי עונות</button>
</div>`;
  }

  function filtered() {
    let list = all;
    if (state.season) list = list.filter((e) => e.season === state.season);
    if (state.audio) list = list.filter((e) => e.stream);
    if (state.later) { const l = S.later.list(); list = list.filter((e) => l.includes(e.id)); }
    list = S.searchEpisodes(state.q, list);
    const by = {
      new: (a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || 0) - (a.number || 0),
      old: (a, b) => (a.date || '').localeCompare(b.date || '') || (a.number || 0) - (b.number || 0),
      num: (a, b) => (b.number || 0) - (a.number || 0),
      long: (a, b) => (b.duration || 0) - (a.duration || 0),
    }[state.sort] || (() => 0);
    return list.slice().sort(by);
  }

  const mark = (text, q) => {
    if (!q) return esc(text);
    const terms = q.trim().split(/\s+/).filter(Boolean).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return esc(text).replace(new RegExp(`(${terms.join('|')})`, 'gi'), '<mark>$1</mark>');
  };

  const card = (e) => U.epCard(e, { titleHtml: mark(e.title, state.q) });

  function rowItem(e) {
    return `
<div class="row${Pl.isCurrent(e.id) ? ' selected' : ''}" data-ep="${esc(e.id)}" style="${U.coverVars(e)}">
  <a class="row-main" href="episode.html?ep=${encodeURIComponent(e.slug)}">
    <i aria-hidden="true" style="background:hsl(var(--h) 70% 40% / .5);border-color:hsl(var(--h) 80% 60% / .6)">${e.number ?? '♫'}</i>
    <span class="txt"><b>${mark(e.title, state.q)}</b><small>${esc(fmtDate(e.date))}${e.guests.length ? ` · עם ${esc(e.guests.join(', '))}` : ''}</small></span>
  </a>
  ${e.duration ? `<span class="time">${fmtTime(e.duration)}</span>` : ''}
  ${e.stream ? `<button type="button" class="icon-btn solid" data-play="${esc(e.id)}" aria-label="האזנה ל${esc(e.title)}">▶</button>` : ''}
</div>`;
  }

  function render() {
    const list = filtered();
    document.getElementById('count').textContent = list.length === all.length ? `${all.length} תוכניות` : `${list.length} מתוך ${all.length}`;
    const R = document.getElementById('results');

    if (!list.length) {
      R.innerHTML = `<div class="state"><span class="mark">♫</span><h3>לא נמצאו תוכניות</h3><p>${state.q ? `אין תוכנית שמתאימה ל"${esc(state.q)}". נסו מילה אחרת או נקו את הסינון.` : 'עדיין אין תוכניות בעונה הזו.'}</p>${state.q || state.season || state.audio || state.later ? '<button type="button" class="btn" data-clear>ניקוי הסינון</button>' : ''}</div>`;
      syncUrl();
      return;
    }
    if (state.view === 'list') R.innerHTML = `<div class="row-list">${list.map(rowItem).join('')}</div>`;
    else if (state.view === 'seasons') {
      // העונות מוצגות לפי סדר ההגדרה שלהן (סדר התיקיות בארכיון התוכנית),
      // ובתוך כל עונה לפי המיון שנבחר. עונה עם הערה מציגה אותה מתחת לכותרת.
      const groups = new Map();
      for (const e of list) { const k = e.season || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
      const order = (id) => { const i = seasons.findIndex((x) => x.id === id); return i < 0 ? seasons.length : i; };
      R.innerHTML = [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([id, eps]) => {
        const s = seasons.find((x) => x.id === id);
        return `<section class="season-block" style="${U.seasonVars(id)}"><div class="season-head"><h2 style="color:hsl(var(--h) 90% 78%)">${esc(s?.title || 'ללא עונה')}</h2><span class="line" aria-hidden="true" style="background:linear-gradient(90deg,hsl(var(--h) 90% 65%),transparent)"></span><span class="pill">${eps.length} תוכניות</span></div>${s?.note ? `<p class="season-note">${esc(s.note)}</p>` : ''}<div class="ep-grid">${eps.map(card).join('')}</div></section>`;
      }).join('');
    } else R.innerHTML = `<div class="ep-grid">${list.map(card).join('')}</div>`;
    syncUrl();
  }

  renderFilters();
  render();

  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-season]');
    if (s) { state.season = s.dataset.season; renderFilters(); render(); return; }
    if (e.target.closest('[data-audio]')) { state.audio = !state.audio; renderFilters(); render(); return; }
    if (e.target.closest('[data-later]')) { state.later = !state.later; renderFilters(); render(); return; }
    const v = e.target.closest('[data-view]');
    if (v) { state.view = v.dataset.view; renderFilters(); render(); return; }
    if (e.target.closest('[data-clear]')) { Object.assign(state, { q: '', season: '', audio: false, later: false }); qEl.value = ''; renderFilters(); render(); return; }
    const play = e.target.closest('[data-play]');
    if (play) { const ep = S.byId(play.dataset.play); if (ep) Pl.load(ep); return; }
    const hit = e.target.closest('[data-hit]');
    if (hit) {
      const ep = S.byId(hit.dataset.hit);
      if (ep?.stream) { e.preventDefault(); Pl.isCurrent(ep.id) ? (Pl.seek(Number(hit.dataset.at)), Pl.play()) : Pl.load(ep, { at: Number(hit.dataset.at) }); }
    }
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'sort') { state.sort = e.target.value; render(); } });

  window.addEventListener('rosh:player', (ev) => {
    const id = ev.detail.episode?.id;
    document.querySelectorAll('[data-ep]').forEach((c) => { c.classList.toggle('current', c.dataset.ep === id); c.classList.toggle('selected', c.classList.contains('row') && c.dataset.ep === id); });
  });
})();
