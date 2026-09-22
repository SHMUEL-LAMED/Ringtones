/* אזור הניהול של ראש בראש.
   עובדים על טיוטה: כל שינוי נשמר בדפדפן (Ctrl+S) ומופיע באתר במכשיר הזה בלבד.
   "פרסום" מעביר את הטיוטה למקור — Supabase (אם מחובר) או קובץ episodes.json להורדה. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore;
  const { esc, fmtTime, parseTime, fmtDate, fmtDuration, slugify } = U;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  await S.ready;
  const site = S.site || {};
  $('#site-header').innerHTML = U.header('admin', site);
  $('#site-footer').innerHTML = U.footer(site);

  const A = {
    data: clone(S.data),
    originIds: new Set(),
    removed: new Set(),
    selected: null,
    dirty: false,
    q: '',
    filter: 'all',
    previewTimer: null,
  };

  // מזהי המקור — כדי לדעת מה למחוק ב־Supabase בפרסום
  async function loadOriginIds() {
    try { const o = await S.admin.pullOrigin(); o.episodes.forEach((e) => A.originIds.add(e.id)); if (S.state.loadedFrom !== 'override') { A.data = clone(o); renderList(); } }
    catch { /* המקור לא זמין כרגע; נעבוד על מה שיש */ }
  }

  /* ---------- סטטוס ---------- */

  function paintStatus() {
    const dot = $('#src-dot'), txt = $('#src-text');
    const src = S.state.source === 'supabase' ? 'Supabase' : 'קובץ episodes.json';
    if (S.admin.hasOverride) { dot.className = 'dot draft'; txt.textContent = `טיוטה מקומית · המקור: ${src}`; }
    else if (S.state.error && S.state.loadedFrom !== 'override') { dot.className = 'dot err'; txt.textContent = `המקור לא נטען · ${src}`; }
    else { dot.className = 'dot on'; txt.textContent = `המקור: ${src}${S.state.source === 'supabase' && S.sb.user ? ` · ${S.sb.user.email}` : ''}`; }
    $('#dirty').hidden = !A.dirty;
  }
  function markDirty() { A.dirty = true; $('#dirty').hidden = false; }
  window.addEventListener('beforeunload', (e) => { if (A.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- רשימת התוכניות ---------- */

  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || 0) - (a.number || 0);

  function listFiltered() {
    let l = A.data.episodes.slice().sort(byDate);
    if (A.filter === 'visible') l = l.filter((e) => e.visible);
    if (A.filter === 'hidden') l = l.filter((e) => !e.visible);
    if (A.filter === 'noaudio') l = l.filter((e) => !e.audio);
    if (A.filter === 'notracks') l = l.filter((e) => !e.tracks.length);
    if (A.q) l = S.searchEpisodes(A.q, l);
    return l;
  }
  function renderList() {
    const l = listFiltered();
    $('#ep-count').textContent = `${l.length} / ${A.data.episodes.length}`;
    $('#ep-list').innerHTML = l.length ? l.map((e) => `
<button type="button" class="ep-item${e.visible ? '' : ' hidden-ep'}" role="option" data-id="${esc(e.id)}" aria-current="${A.selected === e.id}" aria-selected="${A.selected === e.id}">
  <span class="num">${e.number ?? '♫'}</span>
  <span class="txt"><b>${esc(e.title || 'ללא כותרת')}</b><small>${esc(fmtDate(e.date, true) || 'ללא תאריך')}${e.tracks.length ? ` · ${e.tracks.length} שירים` : ''}</small></span>
  <span class="flags">${e.featured ? '<span class="flag featured" title="מומלצת"></span>' : ''}${e.audio ? '<span class="flag audio" title="יש הקלטה"></span>' : ''}${e.visible ? '' : '<span class="flag hidden" title="מוסתרת"></span>'}</span>
</button>`).join('') : '<div class="state" style="padding:24px"><p>אין תוכניות שמתאימות לסינון.</p></div>';
  }
  $('#ep-q').addEventListener('input', (e) => { A.q = e.target.value; renderList(); });
  $('#ep-filter').addEventListener('change', (e) => { A.filter = e.target.value; renderList(); });
  $('#ep-list').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) select(b.dataset.id); });

  /* ---------- בחירה ועריכה ---------- */

  const cur = () => A.data.episodes.find((e) => e.id === A.selected) || null;

  function select(id) {
    A.selected = id;
    renderList();
    renderEditor();
    $('#editor')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function seasonOptions(val) {
    return `<option value="">ללא עונה</option>${A.data.seasons.map((s) => `<option value="${esc(s.id)}" ${s.id === val ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}<option value="__new">+ עונה חדשה…</option>`;
  }

  function renderEditor() {
    const e = cur();
    const E = $('#editor');
    if (!e) { E.innerHTML = '<div class="card"><div class="state empty-editor"><span class="mark">♫</span><h3>בחרו תוכנית או צרו חדשה</h3><p>כל שינוי נשמר כטיוטה בדפדפן הזה. "פרסום" מעביר את הטיוטה לאתר.</p></div></div>'; return; }
    E.innerHTML = `
<div class="card">
  <div class="section-title">
    <div><p class="kicker">${e.number != null ? `תוכנית ${e.number}` : 'תוכנית'}</p><h2 id="ed-title-echo">${esc(e.title || 'ללא כותרת')}</h2></div>
    <div class="inline-toggles">
      <button type="button" class="toggle${e.visible ? ' on' : ''}" data-op="visible" aria-pressed="${e.visible}">${e.visible ? 'פעיל' : 'מוסתר'}</button>
      <a class="btn small" href="episode.html?ep=${encodeURIComponent(e.slug)}" target="_blank" rel="noopener">צפייה</a>
      <button type="button" class="btn small" data-op="dup">שכפול</button>
      <button type="button" class="btn small danger" data-op="del">מחיקה</button>
    </div>
  </div>
  <div class="card-body">
    <div class="form-grid">
      <label class="field span2"><span>כותרת התוכנית *</span><input data-f="title" value="${esc(e.title)}" required placeholder="למשל: שירי הסתיו"></label>
      <label class="field"><span>מספר תוכנית</span><input data-f="number" type="number" inputmode="numeric" value="${e.number ?? ''}" placeholder="38"></label>
      <label class="field"><span>תאריך שידור</span><input data-f="date" type="date" value="${esc(e.date)}"></label>
      <label class="field"><span>עונה</span><select data-f="season">${seasonOptions(e.season)}</select></label>
      <label class="field"><span>כתובת הדף (slug)</span><div class="slug-line"><input data-f="slug" value="${esc(e.slug)}" spellcheck="false"><button type="button" class="btn small" data-op="slug-auto" title="לפי התאריך והמספר">אוטומטי</button></div><small>episode.html?ep=<span id="slug-echo">${esc(e.slug)}</span></small></label>
      <label class="field span2"><span>תיאור</span><textarea data-f="description" placeholder="מה היה בתוכנית? שורה ריקה יוצרת פסקה חדשה.">${esc(e.description)}</textarea></label>
      <div class="field"><span>תגיות ואורחים</span>
        <input data-f="tags" value="${esc(e.tags.join(', '))}" placeholder="תגיות, מופרדות בפסיקים" aria-label="תגיות">
        <input data-f="guests" value="${esc(e.guests.join(', '))}" placeholder="אורחים, מופרדים בפסיקים" aria-label="אורחים" style="margin-top:6px">
        <label class="check" style="margin-top:10px"><input type="checkbox" data-f="featured" ${e.featured ? 'checked' : ''}> להציג כתוכנית המומלצת בדף הבית</label>
      </div>
    </div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">מדיה</p><h2>הקלטה ותמונה</h2></div>${e.duration ? `<strong>${fmtDuration(e.duration)}</strong>` : ''}</div>
  <div class="card-body">
    <div class="form-grid">
      <div class="field">
        <label class="field"><span>קישור להקלטה (MP3 / M4A / WAV)</span><input data-f="audio" value="${esc(e.audio)}" placeholder="https://… או assets/audio/…" spellcheck="false" style="direction:ltr;text-align:left"></label>
        ${e.audio ? `<audio class="audio-preview" id="preview-audio" controls preload="metadata" src="${esc(e.audio)}"></audio><small class="cue-hint">הנגן הזה משמש גם לסימון זמני השירים למטה.</small>` : ''}
        <label class="field" style="margin-top:10px"><span>אורך (דקות:שניות)</span><div class="slug-line"><input data-f="duration" value="${e.duration ? fmtTime(e.duration) : ''}" placeholder="58:30" style="direction:ltr;text-align:center"><button type="button" class="btn small" data-op="dur-auto" ${e.audio ? '' : 'disabled'}>מהקובץ</button></div></label>
      </div>
      <div class="field">
        <label class="field"><span>קישור לתמונה</span><input data-f="cover" value="${esc(e.cover)}" placeholder="https://…/cover.jpg" spellcheck="false" style="direction:ltr;text-align:left"></label>
        ${e.cover ? `<img class="cover-preview" src="${esc(e.cover)}" alt="" style="margin-top:8px">` : '<div class="cover-preview" style="margin-top:8px;display:grid;place-items:center;color:var(--gold-ink);font-size:32px">♫</div>'}
      </div>
    </div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">מה השמענו</p><h2>רשימת השירים</h2></div><strong id="tracks-count">${e.tracks.length}</strong></div>
  <div class="card-body">
    <div class="track-editor" id="track-editor">${renderTracks(e)}</div>
    <div class="track-tools">
      <button type="button" class="btn small gold" data-op="track-add">+ שיר</button>
      <button type="button" class="btn small" data-op="track-cue" ${e.audio ? '' : 'disabled'} title="מוסיף שיר בזמן הנוכחי של הנגן">+ שיר מהנקודה בנגן</button>
      <button type="button" class="btn small" data-op="track-paste">הדבקת רשימה</button>
      <button type="button" class="btn small" data-op="track-sort">מיון לפי זמן</button>
      <span class="spacer"></span>
      <span class="cue-hint">גררו את ⋮ כדי לסדר. "סמן" מעתיק את הזמן מהנגן. Enter בשורה האחרונה מוסיף שיר.</span>
    </div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">עוד</p><h2>קישורים</h2></div></div>
  <div class="card-body">
    <div class="link-rows" id="link-rows">${renderLinks(e)}</div>
    <div class="track-tools"><button type="button" class="btn small" data-op="link-add">+ קישור</button><span class="cue-hint">למשל: הפלייליסט בספוטיפיי, הפוסט בפייסבוק, קישור להורדה.</span></div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">כך זה ייראה</p><h2>תצוגה מקדימה</h2></div></div>
  <div class="card-body"><div class="preview-wrap"><div id="preview-card"></div><pre class="preview-json" id="preview-json"></pre></div></div>
</div>`;
    renderPreview();
  }

  function renderTracks(e) {
    if (!e.tracks.length) return '<div class="state" style="padding:20px"><p>עדיין אין שירים. הוסיפו שיר, או הדביקו רשימה שלמה.</p></div>';
    return `<div class="track-head"><span></span><span>זמן</span><span>שם השיר</span><span>זמר/ת</span><span>הערה</span><span></span></div>` + e.tracks.map((t, i) => `
<div class="track-row" data-i="${i}" draggable="false">
  <span class="handle" draggable="true" title="גרירה לסידור" aria-label="גרירה">⋮</span>
  <input class="t" data-tf="at" data-i="${i}" value="${fmtTime(t.at)}" aria-label="זמן" inputmode="numeric">
  <input class="s" data-tf="title" data-i="${i}" value="${esc(t.title)}" aria-label="שם השיר" placeholder="שם השיר">
  <input class="a" data-tf="artist" data-i="${i}" value="${esc(t.artist)}" aria-label="זמר" placeholder="זמר/ת">
  <input class="n" data-tf="note" data-i="${i}" value="${esc(t.note)}" aria-label="הערה" placeholder="הערה">
  <span class="ops">
    <button type="button" class="icon-btn gold" data-op="track-mark" data-i="${i}" title="סימון הזמן מהנגן" aria-label="סימון הזמן מהנגן">סמן</button>
    <button type="button" class="icon-btn" data-op="track-play" data-i="${i}" title="ניגון מכאן" aria-label="ניגון מכאן">▶</button>
    <button type="button" class="icon-btn" data-op="track-del" data-i="${i}" title="מחיקה" aria-label="מחיקת השיר" style="border-color:var(--error-border);color:var(--error);background:var(--error-bg)">✕</button>
  </span>
</div>`).join('');
  }
  function renderLinks(e) {
    return e.links.map((l, i) => `
<div class="link-row" data-i="${i}">
  <input data-lf="label" data-i="${i}" value="${esc(l.label)}" placeholder="כותרת הקישור" aria-label="כותרת">
  <input class="u" data-lf="url" data-i="${i}" value="${esc(l.url)}" placeholder="https://…" aria-label="כתובת" spellcheck="false">
  <button type="button" class="icon-btn" data-op="link-del" data-i="${i}" aria-label="מחיקת הקישור" style="border-color:var(--error-border);color:var(--error);background:var(--error-bg)">✕</button>
</div>`).join('') || '<p class="cue-hint" style="margin:0">אין קישורים.</p>';
  }
  function renderPreview() {
    const e = cur(); if (!e) return;
    $('#preview-card').innerHTML = `
<span class="ep-card">
  ${e.cover ? `<img class="ep-cover" src="${esc(e.cover)}" alt="">` : `<span class="cover-fallback num" aria-hidden="true">${e.number ?? '♫'}</span>`}
  ${e.number != null ? `<span class="ep-num">תוכנית ${e.number}</span>` : ''}
  ${e.audio ? '<i class="ep-badge" aria-hidden="true">▶</i>' : ''}
  <b>${esc(e.title || 'ללא כותרת')}</b>
  <small>${esc(fmtDate(e.date, true) || 'ללא תאריך')}${e.duration ? ` · ${esc(fmtDuration(e.duration))}` : ''}</small>
  ${e.tracks.length ? `<span class="ep-meta">♫ ${e.tracks.length} שירים</span>` : ''}
</span>`;
    $('#preview-json').textContent = JSON.stringify(e, null, 2);
    $('#ed-title-echo').textContent = e.title || 'ללא כותרת';
    $('#slug-echo').textContent = e.slug;
    $('#tracks-count').textContent = e.tracks.length;
  }
  const schedulePreview = () => { clearTimeout(A.previewTimer); A.previewTimer = setTimeout(() => { renderPreview(); renderList(); }, 200); };

  function uniqueSlug(slug, selfId) {
    let s = slugify(slug) || 'episode', n = 2;
    while (A.data.episodes.some((x) => x.slug === s && x.id !== selfId)) s = `${slugify(slug)}-${n++}`;
    return s;
  }
  const splitList = (v) => String(v).split(/[,،]/).map((s) => s.trim()).filter(Boolean);

  function bindEditor() {
    const E = $('#editor');
    // שדות התוכנית
    E.addEventListener('input', (ev) => {
      const e = cur(); if (!e) return;
      const f = ev.target.dataset.f, tf = ev.target.dataset.tf, lf = ev.target.dataset.lf;
      if (f) {
        const v = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
        switch (f) {
          case 'number': e.number = v === '' ? null : Number(v); break;
          case 'duration': { const s = parseTime(v); ev.target.closest('.field')?.classList.toggle('invalid', isNaN(s)); if (!isNaN(s)) e.duration = s; break; }
          case 'tags': e.tags = splitList(v); break;
          case 'guests': e.guests = splitList(v); break;
          case 'featured': if (v) A.data.episodes.forEach((x) => { x.featured = x.id === e.id; }); else e.featured = false; break;
          case 'slug': e.slug = v; break;
          case 'season': if (v === '__new') { newSeasonInline(ev.target); return; } e.season = v; break;
          default: e[f] = v;
        }
        markDirty(); schedulePreview();
      } else if (tf) {
        const t = e.tracks[Number(ev.target.dataset.i)]; if (!t) return;
        if (tf === 'at') { const s = parseTime(ev.target.value); ev.target.closest('.track-row').classList.toggle('bad-time', isNaN(s)); if (!isNaN(s)) t.at = s; }
        else t[tf] = ev.target.value;
        markDirty(); schedulePreview();
      } else if (lf) {
        const l = e.links[Number(ev.target.dataset.i)]; if (!l) return;
        l[lf] = ev.target.value; markDirty(); schedulePreview();
      }
    });
    E.addEventListener('change', (ev) => {
      const e = cur(); if (!e) return;
      if (ev.target.dataset.f === 'slug') { e.slug = uniqueSlug(ev.target.value, e.id); ev.target.value = e.slug; renderPreview(); }
      if (ev.target.dataset.f === 'audio' || ev.target.dataset.f === 'cover') renderEditor();
      if (ev.target.dataset.tf === 'at') { ev.target.value = fmtTime(parseTime(ev.target.value) || 0); }
    });
    E.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target.dataset.tf) {
        ev.preventDefault();
        const e = cur(); const i = Number(ev.target.dataset.i);
        if (i === e.tracks.length - 1) { addTrack(); } else { $(`.track-row[data-i="${i + 1}"] input.s`, E)?.focus(); }
      }
    });
    E.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-op]'); if (!b) return;
      const e = cur(); if (!e) return;
      const i = Number(b.dataset.i);
      switch (b.dataset.op) {
        case 'visible': e.visible = !e.visible; markDirty(); renderEditor(); renderList(); break;
        case 'dup': duplicate(e); break;
        case 'del': remove(e); break;
        case 'slug-auto': e.slug = uniqueSlug(e.date || (e.number != null ? `episode-${e.number}` : e.title), e.id); markDirty(); renderEditor(); break;
        case 'dur-auto': { const a = $('#preview-audio'); if (a && isFinite(a.duration) && a.duration) { e.duration = Math.round(a.duration); markDirty(); renderEditor(); U.notify(`האורך עודכן: ${fmtTime(e.duration)}`, 'success'); } else U.notify('הקובץ עדיין לא נטען. נסו שוב בעוד רגע.', 'info'); break; }
        case 'track-add': addTrack(); break;
        case 'track-cue': { const a = $('#preview-audio'); addTrack(a ? Math.floor(a.currentTime) : 0); break; }
        case 'track-paste': openPaste(); break;
        case 'track-sort': e.tracks.sort((x, y) => x.at - y.at); markDirty(); refreshTracks(); break;
        case 'track-del': e.tracks.splice(i, 1); markDirty(); refreshTracks(); break;
        case 'track-mark': { const a = $('#preview-audio'); if (!a) { U.notify('אין הקלטה — הוסיפו קישור להקלטה למעלה.', 'info'); break; } e.tracks[i].at = Math.floor(a.currentTime); markDirty(); refreshTracks(); $(`.track-row[data-i="${i}"] input.s`, E)?.focus(); break; }
        case 'track-play': { const a = $('#preview-audio'); if (!a) { U.notify('אין הקלטה — הוסיפו קישור להקלטה למעלה.', 'info'); break; } a.currentTime = e.tracks[i].at; a.play().catch(() => {}); break; }
        case 'link-add': e.links.push({ label: '', url: '' }); markDirty(); $('#link-rows').innerHTML = renderLinks(e); $('#link-rows input[data-lf="label"]:last-of-type')?.focus(); break;
        case 'link-del': e.links.splice(i, 1); markDirty(); $('#link-rows').innerHTML = renderLinks(e); renderPreview(); break;
      }
    });
    // האורך מהקובץ באופן אוטומטי אם ריק (אירועי מדיה לא מבעבעים — לכן capture)
    E.addEventListener('loadedmetadata', (ev) => { if (ev.target.id !== 'preview-audio') return; const e = cur(); if (e && !e.duration && isFinite(ev.target.duration)) { e.duration = Math.round(ev.target.duration); markDirty(); const f = $('[data-f="duration"]', E); if (f) f.value = fmtTime(e.duration); renderPreview(); } }, true);
    bindDrag(E);
  }

  function refreshTracks() { const e = cur(); $('#track-editor').innerHTML = renderTracks(e); renderPreview(); }
  function addTrack(at) {
    const e = cur();
    const last = e.tracks[e.tracks.length - 1];
    e.tracks.push({ at: at ?? (last ? last.at + 180 : 0), title: '', artist: '', note: '' });
    markDirty(); refreshTracks();
    $(`.track-row[data-i="${e.tracks.length - 1}"] input.s`)?.focus();
  }

  /* גרירה לסידור השירים — האצלה על העורך כולו, פעם אחת */
  function bindDrag(wrap) {
    let from = null;
    wrap.addEventListener('dragstart', (ev) => { const row = ev.target.closest('.track-row'); if (!row || !ev.target.classList.contains('handle')) { ev.preventDefault(); return; } from = Number(row.dataset.i); row.classList.add('dragging'); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(from)); });
    wrap.addEventListener('dragover', (ev) => { const row = ev.target.closest('.track-row'); if (!row || from == null) return; ev.preventDefault(); const r = row.getBoundingClientRect(); const before = ev.clientY < r.top + r.height / 2; $$('.track-row', wrap).forEach((x) => x.classList.remove('drop-before', 'drop-after')); row.classList.add(before ? 'drop-before' : 'drop-after'); });
    wrap.addEventListener('dragleave', (ev) => { ev.target.closest?.('.track-row')?.classList.remove('drop-before', 'drop-after'); });
    wrap.addEventListener('drop', (ev) => {
      const row = ev.target.closest('.track-row'); if (!row || from == null) return; ev.preventDefault();
      const e = cur(); const r = row.getBoundingClientRect(); let to = Number(row.dataset.i) + (ev.clientY < r.top + r.height / 2 ? 0 : 1);
      const [moved] = e.tracks.splice(from, 1); if (to > from) to--; e.tracks.splice(to, 0, moved);
      from = null; markDirty(); refreshTracks();
    });
    wrap.addEventListener('dragend', () => { from = null; $$('.track-row', wrap).forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
  }

  /* ---------- יצירה, שכפול, מחיקה ---------- */

  function newEpisode() {
    const today = new Date().toISOString().slice(0, 10);
    const maxNum = A.data.episodes.reduce((m, e) => Math.max(m, e.number || 0), 0);
    const latestSeason = A.data.seasons.slice().sort((a, b) => (b.year || 0) - (a.year || 0))[0];
    const base = { id: `ep-${Date.now().toString(36)}`, slug: '', number: maxNum + 1, season: latestSeason?.id || '', title: '', date: today, description: '', cover: '', audio: '', duration: 0, tags: [], guests: [], links: [], featured: false, visible: true, tracks: [] };
    base.slug = uniqueSlug(today, base.id);
    A.data.episodes.unshift(base);
    markDirty(); select(base.id);
    $('[data-f="title"]')?.focus();
  }
  function duplicate(e) {
    const c = clone(e);
    c.id = `ep-${Date.now().toString(36)}`; c.slug = uniqueSlug(`${e.slug}-2`, c.id); c.number = e.number != null ? e.number + 1 : null; c.featured = false; c.title = `${e.title} (עותק)`;
    A.data.episodes.unshift(c); markDirty(); select(c.id); U.notify('התוכנית שוכפלה.', 'success');
  }
  function remove(e) {
    const i = A.data.episodes.findIndex((x) => x.id === e.id); if (i < 0) return;
    const [gone] = A.data.episodes.splice(i, 1);
    if (A.originIds.has(gone.id)) A.removed.add(gone.id);
    A.selected = null; markDirty(); renderList(); renderEditor();
    U.notify(`"${gone.title || 'התוכנית'}" נמחקה.`, 'success', { action: 'ביטול', ttl: 9000, onAction: () => { A.data.episodes.splice(i, 0, gone); A.removed.delete(gone.id); select(gone.id); } });
  }
  $('#btn-new').addEventListener('click', newEpisode);

  /* ---------- עונות ---------- */

  function newSeasonInline(sel) {
    const title = prompt('שם העונה החדשה (למשל: עונת 2027):');
    if (!title) { sel.value = cur()?.season || ''; return; }
    const year = (title.match(/\d{4}/) || [])[0];
    const id = uniqueSeasonId(year || slugify(title));
    A.data.seasons.push({ id, title, year: year ? Number(year) : null, note: '' });
    cur().season = id; markDirty(); renderEditor();
  }
  function uniqueSeasonId(id) { let s = id || 's', n = 2; while (A.data.seasons.some((x) => x.id === s)) s = `${id}-${n++}`; return s; }

  const dlgSeasons = $('#dlg-seasons');
  function renderSeasons() {
    const counts = {}; A.data.episodes.forEach((e) => { counts[e.season] = (counts[e.season] || 0) + 1; });
    $('#season-rows').innerHTML = A.data.seasons.map((s, i) => `
<div class="season-row" data-i="${i}">
  <input class="id" data-sf="id" data-i="${i}" value="${esc(s.id)}" aria-label="מזהה" spellcheck="false">
  <input data-sf="title" data-i="${i}" value="${esc(s.title)}" aria-label="שם" placeholder="עונת 2026">
  <input data-sf="year" data-i="${i}" type="number" value="${s.year ?? ''}" aria-label="שנה" placeholder="2026" style="direction:ltr;text-align:center">
  <input data-sf="note" data-i="${i}" value="${esc(s.note)}" aria-label="הערה" placeholder="הערה">
  <span class="pill">${counts[s.id] || 0}</span>
  <button type="button" class="icon-btn" data-sop="del" data-i="${i}" aria-label="מחיקת העונה" style="border-color:var(--error-border);color:var(--error);background:var(--error-bg)">✕</button>
</div>`).join('') || '<p class="cue-hint" style="margin:0">אין עונות. הוסיפו אחת.</p>';
  }
  $('#btn-seasons').addEventListener('click', () => { A.seasonsDraft = clone(A.data.seasons); renderSeasons(); dlgSeasons.showModal(); });
  $('#season-add').addEventListener('click', () => { const y = new Date().getFullYear(); A.data.seasons.push({ id: uniqueSeasonId(String(y)), title: `עונת ${y}`, year: y, note: '' }); renderSeasons(); });
  $('#season-rows').addEventListener('input', (ev) => { const s = A.data.seasons[Number(ev.target.dataset.i)]; const f = ev.target.dataset.sf; if (!s || !f) return; s[f] = f === 'year' ? (ev.target.value ? Number(ev.target.value) : null) : ev.target.value; });
  $('#season-rows').addEventListener('click', (ev) => { const b = ev.target.closest('[data-sop="del"]'); if (!b) return; const s = A.data.seasons[Number(b.dataset.i)]; A.data.episodes.forEach((e) => { if (e.season === s.id) e.season = ''; }); A.data.seasons.splice(Number(b.dataset.i), 1); renderSeasons(); });
  $('#season-save').addEventListener('click', () => {
    // עדכון מזהים ששונו אצל התוכניות
    A.seasonsDraft.forEach((old, i) => { const now = A.data.seasons[i]; if (now && now.id !== old.id) A.data.episodes.forEach((e) => { if (e.season === old.id) e.season = now.id; }); });
    markDirty(); dlgSeasons.close(); renderEditor(); renderList(); U.notify('העונות נשמרו בטיוטה.', 'success');
  });

  /* ---------- הדבקת רשימה ---------- */

  const dlgPaste = $('#dlg-paste');
  function parsePaste(text) {
    const out = [];
    for (let line of String(text).split(/\r?\n/)) {
      line = line.trim().replace(/^\d+[.)]\s*/, '');
      if (!line) continue;
      let at = null;
      let m = line.match(/^[\[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*[-–—:]?\s*/);
      if (m) { at = parseTime(m[1]); line = line.slice(m[0].length); }
      else { m = line.match(/\s*[\[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*$/); if (m) { at = parseTime(m[1]); line = line.slice(0, m.index); } }
      const parts = line.split(/\s+[-–—|\/]\s+|\s*:\s+/);
      const title = (parts[0] || '').trim(), artist = parts.slice(1).join(' — ').trim();
      if (title) out.push({ at, title, artist, note: '' });
    }
    return out;
  }
  function openPaste() { $('#paste-area').value = ''; $('#paste-preview').textContent = ''; $('#paste-replace').checked = false; dlgPaste.showModal(); $('#paste-area').focus(); }
  $('#paste-area').addEventListener('input', (ev) => { const p = parsePaste(ev.target.value); $('#paste-preview').textContent = p.length ? `זוהו ${p.length} שירים${p.some((t) => t.at == null) ? ' — לחלק אין זמן; יקבלו זמן משוער לפי הסדר' : ''}.` : ''; });
  $('#paste-apply').addEventListener('click', () => {
    const e = cur(); if (!e) return;
    const parsed = parsePaste($('#paste-area').value);
    if (!parsed.length) { U.notify('לא זוהו שירים בטקסט.', 'error'); return; }
    if ($('#paste-replace').checked) e.tracks = [];
    let lastAt = e.tracks.length ? e.tracks[e.tracks.length - 1].at : -180;
    for (const t of parsed) { if (t.at == null) t.at = lastAt + 180; lastAt = t.at; e.tracks.push(t); }
    markDirty(); refreshTracks(); dlgPaste.close(); U.notify(`נוספו ${parsed.length} שירים.`, 'success');
  });

  /* ---------- JSON, ייבוא וייצוא ---------- */

  const dlgJson = $('#dlg-json');
  $('#btn-json').addEventListener('click', () => { $('#json-area').value = S.admin.export(A.data); $('#json-msg').innerHTML = ''; dlgJson.showModal(); });
  $('#json-validate').addEventListener('click', () => { const r = validateText($('#json-area').value); showJsonMsg(r); });
  $('#json-apply').addEventListener('click', () => {
    const r = validateText($('#json-area').value); showJsonMsg(r);
    if (r.errors.length) return;
    applyData(r.data); dlgJson.close(); U.notify('ה־JSON הוחל על הטיוטה.', 'success');
  });
  $('#json-copy').addEventListener('click', async () => { (await U.copy($('#json-area').value)) ? U.notify('ה־JSON הועתק.', 'success') : U.notify('ההעתקה נכשלה.', 'error'); });
  $('#json-download').addEventListener('click', () => download('episodes.json', $('#json-area').value));
  function validateText(text) {
    let data; try { data = JSON.parse(text); } catch (err) { return { errors: [`JSON לא תקין: ${err.message}`] }; }
    const errors = S.admin.validate(data); return { errors, data };
  }
  function showJsonMsg({ errors, data }) {
    $('#json-msg').innerHTML = errors.length ? `<ul class="err-list">${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="ok-line">✓ תקין — ${data.episodes.length} תוכניות, ${(data.seasons || []).length} עונות.</p>`;
  }
  function applyData(raw) {
    A.data = S.admin.normalize(raw);
    A.data.episodes.forEach((e) => A.originIds.has(e.id) && A.removed.delete(e.id));
    A.originIds.forEach((id) => { if (!A.data.episodes.some((e) => e.id === id)) A.removed.add(id); });
    A.selected = A.data.episodes.some((e) => e.id === A.selected) ? A.selected : null;
    markDirty(); renderList(); renderEditor();
  }
  function download(name, text) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    const r = validateText(await f.text());
    if (r.errors.length) { U.notify(`הקובץ לא תקין: ${r.errors[0]}`, 'error'); return; }
    if (!confirm(`לייבא ${r.data.episodes.length} תוכניות מהקובץ? זה יחליף את הטיוטה הנוכחית.`)) return;
    applyData(r.data); U.notify('הקובץ יובא לטיוטה.', 'success'); ev.target.value = '';
  });

  /* ---------- שמירה ופרסום ---------- */

  function save(silent) {
    const errs = S.admin.validate(A.data);
    if (errs.length) { U.notify(errs[0], 'error'); return false; }
    S.admin.saveOverride(A.data);
    A.dirty = false; paintStatus();
    if (!silent) U.notify('הטיוטה נשמרה. האתר במכשיר הזה מציג אותה.', 'success');
    return true;
  }
  $('#btn-save').addEventListener('click', () => save());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if (e.key === 'n' && !U.isTyping(e) && !document.querySelector('dialog[open]')) { e.preventDefault(); newEpisode(); }
  });

  const dlgPublish = $('#dlg-publish');
  function renderPublish() {
    const body = $('#publish-body'), foot = $('#publish-foot');
    const n = A.data.episodes.length, removed = A.removed.size;
    if (S.state.source === 'supabase') {
      const u = S.sb.user;
      body.innerHTML = `
<div class="sb-box">
  <b>פרסום ל־Supabase</b>
  ${u ? `<span class="who">מחוברים כ־${esc(u.email)}</span>` : '<span style="color:var(--error);font-weight:800;font-size:12px">לא מחוברים. התחברו דרך "חיבור" כדי לפרסם.</span>'}
  <span style="font-size:13px">${n} תוכניות ו־${A.data.seasons.length} עונות יישמרו.${removed ? ` ${removed} תוכניות יימחקו מהמקור.` : ''}</span>
</div>`;
      foot.innerHTML = `${u ? '' : '<button type="button" class="btn" data-pub="login">התחברות</button>'}<button type="button" class="btn primary" data-pub="push" ${u ? '' : 'disabled'}>פרסום עכשיו <span>←</span></button>`;
    } else {
      body.innerHTML = `
<ol class="publish-steps">
  <li>הורידו את הקובץ המעודכן (${n} תוכניות).</li>
  <li>החליפו איתו את <code>data/episodes.json</code> במאגר ב־GitHub (העלאה דרך האתר של GitHub או commit).</li>
  <li>אחרי שהאתר התעדכן, לחצו "ניקוי הטיוטה" כדי שהמכשיר הזה יחזור להציג את המקור.</li>
</ol>
<p class="cue-hint" style="margin:12px 0 0">רוצים לפרסם בלחיצה אחת? חברו את Supabase ב־<code>data/site.json</code> (ראו README).</p>`;
      foot.innerHTML = `<button type="button" class="btn" data-pub="copy">העתקת ה־JSON</button><button type="button" class="btn" data-pub="clear">ניקוי הטיוטה</button><button type="button" class="btn primary" data-pub="download">הורדת episodes.json <span>←</span></button>`;
    }
  }
  $('#btn-publish').addEventListener('click', () => { if (A.dirty && !save(true)) return; renderPublish(); dlgPublish.showModal(); });
  dlgPublish.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-pub]'); if (!b) return;
    switch (b.dataset.pub) {
      case 'download': download('episodes.json', S.admin.export(A.data)); U.notify('הקובץ ירד. העלו אותו ל־data/episodes.json במאגר.', 'success'); break;
      case 'copy': (await U.copy(S.admin.export(A.data))) ? U.notify('ה־JSON הועתק.', 'success') : U.notify('ההעתקה נכשלה.', 'error'); break;
      case 'clear': if (confirm('לנקות את הטיוטה המקומית ולחזור לנתוני המקור?')) { S.admin.clearOverride(); location.reload(); } break;
      case 'login': dlgPublish.close(); openSettings(); break;
      case 'push': {
        b.disabled = true; const stop = U.notify('מפרסמים…', 'progress');
        try {
          await S.sb.push(A.data, { removedIds: [...A.removed] });
          S.admin.clearOverride(); A.removed.clear(); A.dirty = false; A.originIds = new Set(A.data.episodes.map((e) => e.id));
          stop(); U.notify('פורסם. האתר מציג עכשיו את הנתונים החדשים.', 'success'); dlgPublish.close(); paintStatus();
        } catch (err) { stop(); U.notify(`הפרסום נכשל: ${err.message}`, 'error'); b.disabled = false; }
        break;
      }
    }
  });

  /* ---------- חיבור ---------- */

  const dlgSettings = $('#dlg-settings');
  function openSettings() {
    const u = S.sb.user, cfg = S.sb.cfg;
    $('#settings-body').innerHTML = `
<div class="sb-box" style="margin-bottom:14px">
  <b>מקור הנתונים: ${S.state.source === 'supabase' ? 'Supabase' : 'קובץ episodes.json במאגר'}</b>
  <span style="font-size:12px;color:var(--muted)">${S.state.source === 'supabase' ? `פרויקט: <code style="direction:ltr">${esc(cfg.url)}</code>` : 'כדי לפרסם בלחיצה, הגדירו את Supabase ב־data/site.json (storage.provider = "supabase").'}</span>
  ${S.admin.hasOverride ? '<span style="font-size:12px;color:var(--gold-ink);font-weight:800">במכשיר הזה יש טיוטה מקומית שמוצגת במקום המקור.</span>' : ''}
</div>
${S.state.source === 'supabase' ? (u ? `
<div class="sb-box"><b>מחוברים</b><span class="who">${esc(u.email)}</span><button type="button" class="btn small" data-set="logout">התנתקות</button></div>` : `
<form class="sb-box" data-set="login">
  <b>התחברות למנהל</b>
  <button type="button" class="btn" data-set="google">התחברות עם Google</button>
  <span class="cue-hint">או עם דוא״ל וסיסמה של משתמש ב־Supabase Auth:</span>
  <label class="field"><span>דוא״ל</span><input name="email" type="email" required autocomplete="username" style="direction:ltr;text-align:left"></label>
  <label class="field"><span>סיסמה</span><input name="password" type="password" required autocomplete="current-password" style="direction:ltr;text-align:left"></label>
  <button type="submit" class="btn primary">התחברות <span>←</span></button>
</form>`) : ''}
<div class="track-tools" style="margin-top:14px">
  <button type="button" class="btn small" data-set="reload">משיכה מחדש מהמקור</button>
  <button type="button" class="btn small danger" data-set="discard" ${S.admin.hasOverride ? '' : 'disabled'}>מחיקת הטיוטה המקומית</button>
</div>`;
    dlgSettings.showModal();
  }
  $('#btn-settings').addEventListener('click', openSettings);
  dlgSettings.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('[data-set="login"]'); if (!f) return; ev.preventDefault();
    const btn = f.querySelector('button[type="submit"]'); btn.disabled = true;
    try { await S.sb.signIn(f.email.value.trim(), f.password.value); U.notify('התחברתם.', 'success'); openSettings(); paintStatus(); loadOriginIds(); }
    catch (err) { U.notify(`ההתחברות נכשלה: ${err.message}`, 'error'); btn.disabled = false; }
  });
  dlgSettings.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-set]'); if (!b || b.tagName === 'FORM') return;
    switch (b.dataset.set) {
      case 'logout': S.sb.signOut(); U.notify('התנתקתם.', 'success'); openSettings(); paintStatus(); break;
      case 'google': S.sb.signInWithGoogle(); break;
      case 'reload': { if (A.dirty && !confirm('יש שינויים שלא נשמרו. להמשיך?')) return; const stop = U.notify('מושכים מהמקור…', 'progress'); try { const o = await S.admin.pullOrigin(); A.data = clone(o); A.originIds = new Set(o.episodes.map((e) => e.id)); A.removed.clear(); A.dirty = true; stop(); renderList(); renderEditor(); dlgSettings.close(); U.notify('נמשך מהמקור אל הטיוטה. שמרו כדי להחיל.', 'success'); } catch (err) { stop(); U.notify(`המשיכה נכשלה: ${err.message}`, 'error'); } break; }
      case 'discard': if (confirm('למחוק את הטיוטה המקומית? השינויים שלא פורסמו יאבדו.')) { S.admin.clearOverride(); location.reload(); } break;
    }
  });

  // סגירת דיאלוגים
  $$('dialog.sheet').forEach((d) => { d.querySelector('[data-close]')?.addEventListener('click', () => d.close()); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); });

  /* ---------- התחלה ---------- */

  bindEditor();
  paintStatus();
  renderList();
  if (S.state.authRedirect) U.notify(`התחברתם כ־${S.state.authRedirect.email}.`, 'success');
  if (S.state.error && S.state.loadedFrom !== 'override') U.notify('טעינת המקור נכשלה. אפשר לעבוד על הטיוטה ולנסות שוב.', 'error', { action: 'ניסיון חוזר', onAction: () => location.reload(), ttl: 0 });
  loadOriginIds();
  const first = U.qs('ep'); if (first && A.data.episodes.some((e) => e.id === first || e.slug === first)) select(A.data.episodes.find((e) => e.id === first || e.slug === first).id);
})();
