/* הנגן הקבוע של ראש בראש: נגן אחד לכל האתר, פס התקדמות,
   המשך מאיפה שעצרתם, מהירות, טיימר כיבוי, קיצורי מקלדת ו־Media Session. */
(function () {
  'use strict';
  const { esc, fmtTime } = window.RoshUI;
  const S = window.RoshStore;

  /** המהירויות האפשריות — אותה רשימה בנגן, בקיצורי המקלדת ובאזור האישי */
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const audio = new Audio();
  audio.preload = 'metadata';

  const P = {
    episode: null,
    sleepAt: null,      // timestamp ms
    dock: null,
    els: {},
    candidates: null,   // כתובות ההזרמה של התוכנית הנוכחית, לפי עדיפות
    candidateIndex: 0,
    wantPlay: false,
    lastSaved: 0,
    dragging: false,
  };

  const emit = (type, detail = {}) => window.dispatchEvent(new CustomEvent('rosh:player', { detail: { type, episode: P.episode, time: audio.currentTime, ...detail } }));

  /* ---------- בניית הנגן ---------- */

  function build() {
    if (P.dock) return;
    const d = document.createElement('div');
    d.className = 'dock';
    d.id = 'dock';
    d.setAttribute('role', 'region');
    d.setAttribute('aria-label', 'נגן התוכנית');
    d.innerHTML = `
<div class="dock-inner">
  <div class="dock-top">
    <div class="dock-art" data-art aria-hidden="true"><i></i></div>
    <div class="dock-text">
      <a data-link href="#"><b data-title>—</b></a>
      <small class="now"><span class="dock-live" aria-hidden="true"><i style="--d:0s"></i><i style="--d:.2s"></i><i style="--d:.1s"></i><i style="--d:.3s"></i></span><span data-now aria-live="polite"></span></small>
    </div>
    <div class="dock-controls" style="direction:ltr">
      <button type="button" class="icon-btn" data-prev aria-label="לתוכנית הקודמת">◂◂</button>
      <button type="button" class="icon-btn dock-skip" data-back aria-label="15 שניות אחורה">−15</button>
      <button type="button" class="icon-btn solid main" data-toggle aria-label="ניגון">▶</button>
      <button type="button" class="icon-btn dock-skip" data-fwd aria-label="15 שניות קדימה">+15</button>
      <button type="button" class="icon-btn" data-next aria-label="לתוכנית הבאה">▸▸</button>
    </div>
  </div>
  <div class="dock-bar">
    <time data-cur>0:00</time>
    <div class="scrub" data-scrub role="slider" tabindex="0" aria-label="מיקום בתוכנית" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="0:00">
      <div class="segs" data-segs></div>
      <div class="markers" data-markers aria-hidden="true"></div>
      <div class="knob" data-knob style="left:0"></div>
      <div class="tip" data-tip></div>
    </div>
    <time data-dur>0:00</time>
  </div>
  <div class="dock-extra">
    <select data-speed aria-label="מהירות ניגון">
      ${RATES.map((r) => `<option value="${r}"${r === 1 ? ' selected' : ''}>${r === 1 ? 'מהירות רגילה' : `${r}×`}</option>`).join('')}
    </select>
    <select data-sleep aria-label="טיימר כיבוי">
      <option value="">טיימר כיבוי</option><option value="15">בעוד 15 דקות</option><option value="30">בעוד 30 דקות</option><option value="45">בעוד 45 דקות</option><option value="60">בעוד שעה</option>
    </select>
    <button type="button" class="chip hide-sm" data-mute aria-pressed="false">השתקה</button>
    <button type="button" class="chip moment-btn" data-moment aria-pressed="false" title="סימון הרגע הזה ברשימת הרגעים שאהבתם">♡ הרגע הזה</button>
    <button type="button" class="chip" data-share>שיתוף הרגע הזה</button>
    <a class="chip hide-sm" data-download href="#" download rel="noopener">הורדה</a>
    <span class="spacer"></span>
    <span class="dock-sleep-left" data-sleep-left style="color:var(--gold-ink);font-size:11px;font-weight:800"></span>
    <button type="button" class="icon-btn dock-close" data-close aria-label="סגירת הנגן">✕</button>
  </div>
</div>`;
    document.body.appendChild(d);
    P.dock = d;
    const q = (s) => d.querySelector(s);
    P.els = {
      art: q('[data-art]'), link: q('[data-link]'), title: q('[data-title]'), now: q('[data-now]'),
      toggle: q('[data-toggle]'), cur: q('[data-cur]'), dur: q('[data-dur]'),
      scrub: q('[data-scrub]'), segs: q('[data-segs]'), markers: q('[data-markers]'), knob: q('[data-knob]'), tip: q('[data-tip]'),
      speed: q('[data-speed]'), sleep: q('[data-sleep]'), sleepLeft: q('[data-sleep-left]'), mute: q('[data-mute]'), download: q('[data-download]'),
    };

    q('[data-toggle]').addEventListener('click', toggle);
    q('[data-back]').addEventListener('click', () => seek(audio.currentTime - 15));
    q('[data-fwd]').addEventListener('click', () => seek(audio.currentTime + 15));
    q('[data-prev]').addEventListener('click', prevEpisode);
    q('[data-next]').addEventListener('click', nextEpisode);
    q('[data-close]').addEventListener('click', close);
    q('[data-share]').addEventListener('click', shareMoment);
    q('[data-moment]').addEventListener('click', toggleMoment);
    P.els.mute.addEventListener('click', () => { audio.muted = !audio.muted; P.els.mute.setAttribute('aria-pressed', String(audio.muted)); P.els.mute.textContent = audio.muted ? 'ביטול השתקה' : 'השתקה'; });
    P.els.speed.addEventListener('change', () => setRate(Number(P.els.speed.value)));
    P.els.sleep.addEventListener('change', () => setSleep(P.els.sleep.value));

    // גרירה על הפס
    const sc = P.els.scrub;
    const ratioFromEvent = (e) => {
      const r = sc.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    sc.addEventListener('pointerdown', (e) => { P.dragging = true; sc.setPointerCapture(e.pointerId); preview(ratioFromEvent(e)); });
    sc.addEventListener('pointermove', (e) => { const r = ratioFromEvent(e); showTip(r); if (P.dragging) preview(r); });
    sc.addEventListener('pointerup', (e) => { if (!P.dragging) return; P.dragging = false; seek(ratioFromEvent(e) * dur()); });
    sc.addEventListener('pointerleave', () => { P.els.tip.style.opacity = ''; });
    sc.addEventListener('keydown', (e) => {
      const map = { ArrowRight: 5, ArrowLeft: -5, ArrowUp: 30, ArrowDown: -30, PageUp: 300, PageDown: -300 };
      // stopPropagation: אחרת גם קיצורי המקלדת הכלליים (±15 שניות) מופעלים על אותה לחיצה
      if (e.key in map) { e.preventDefault(); e.stopPropagation(); seek(audio.currentTime + map[e.key]); }
      if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); seek(0); }
      if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); seek(dur() - 1); }
    });

    // העדפות
    setRate(S.prefs.get('rate', 1), true);
    audio.volume = S.prefs.get('volume', 1);
  }

  const dur = () => (isFinite(audio.duration) && audio.duration) || P.episode?.duration || 0;

  function open() { build(); P.dock.classList.add('open'); document.body.classList.add('has-dock'); }
  function close() {
    pause();
    P.dock?.classList.remove('open');
    document.body.classList.remove('has-dock');
    emit('close');
  }

  /* ---------- טעינת תוכנית ---------- */

  /* ההקלטה מוזרמת ישירות לנגן של האתר (ep.stream) — גם כשהקובץ שמור בדרייב.
     אין הפניה החוצה ואין נגן חיצוני. */
  function load(ep, { at = null, autoplay = true, quiet = false } = {}) {
    const candidates = window.RoshUI.streamCandidates(ep);
    if (!candidates.length) { window.RoshUI.notify('לתוכנית הזו אין עדיין הקלטה להאזנה.', 'info'); return false; }
    open();
    const same = P.episode && P.episode.id === ep.id && P.candidates && audio.src === P.candidates[P.candidateIndex];
    P.episode = ep;
    if (!same) {
      flushListen();
      P.candidates = candidates;
      P.candidateIndex = 0;
      audio.src = candidates[0];
      audio.load();
      S.history.add(ep.id);
      // סטטיסטיקה: האזנה אחת לכל טעינה של הקלטה (בלי פרטים מזהים)
      S.sb.event('play', ep.id);
      P.listened = 0;
    }
    P.els.title.textContent = ep.title;
    P.els.link.href = `episode.html?ep=${encodeURIComponent(ep.slug)}`;
    P.els.art.style.setProperty('--h', String(window.RoshUI.hue(ep)));
    const dl = window.RoshUI.downloadUrl(ep);
    P.els.download.hidden = !dl;
    if (dl) { P.els.download.href = dl; P.els.download.setAttribute('download', `${ep.title}.mp3`); }   // השרת קובע את שם הקובץ
    P.els.art.innerHTML = ep.cover ? `<img src="${esc(ep.cover)}" alt=""><i></i>` : '<i></i>';
    P.els.dur.textContent = fmtTime(dur());
    renderSegments();
    updateNow(true);

    let start = at;
    if (start == null && !same) {
      const saved = S.positions.get(ep.id);
      if (saved && saved.t > 20 && (!saved.dur || saved.t < saved.dur - 30)) {
        start = saved.t;
        if (!quiet) window.RoshUI.notify(`ממשיכים מ־${fmtTime(saved.t)}`, 'info', { action: 'מההתחלה', onAction: () => seek(0) });
      }
    }
    if (start != null) seek(start);
    if (autoplay) play();
    mediaSession();
    emit('episode');
    return true;
  }

  function play() {
    if (!P.episode) return;
    P.wantPlay = true;
    audio.play().catch((err) => {
      if (err?.name === 'NotAllowedError') return; // דורש מחווה של המשתמש
      if (err?.name === 'AbortError' || err?.name === 'NotSupportedError') return; // מקור הוחלף / נכשל — מטופל ב־error
      window.RoshUI.notify('ניגון ההקלטה נכשל. בדקו את החיבור ונסו שוב.', 'error', { action: 'ניסיון חוזר', onAction: () => { audio.load(); play(); } });
    });
  }
  function pause() { P.wantPlay = false; audio.pause(); }
  function toggle() { audio.paused ? play() : pause(); }
  function seek(t) {
    t = Math.min(Math.max(0, t), dur() ? dur() - 0.25 : t);
    if (!isFinite(t)) return;
    audio.currentTime = t;
    paint();
    updateNow();
    save(true);
  }
  function setRate(r, silent) {
    r = Number(r) || 1;
    r = RATES.reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) ? x : best), 1);
    audio.playbackRate = r;
    if (P.els.speed) P.els.speed.value = String(r);
    S.prefs.set('rate', r);
    if (!silent) emit('rate', { rate: r });
  }
  function setSleep(v) {
    P.sleepAt = null;
    if (v) P.sleepAt = Date.now() + Number(v) * 60_000;
    paintSleep();
  }
  function paintSleep() {
    if (!P.els.sleepLeft) return;
    if (P.sleepAt) P.els.sleepLeft.textContent = `כיבוי בעוד ${Math.max(1, Math.ceil((P.sleepAt - Date.now()) / 60_000))} דק׳`;
    else P.els.sleepLeft.textContent = '';
  }

  /* ---------- תוכנית קודמת / הבאה ---------- */

  /** בסדר הארכיון: "הבאה" היא החדשה יותר, "הקודמת" היא הישנה יותר. */
  function nextEpisode() { const nb = P.episode && S.neighbors(P.episode.id); if (nb?.newer?.stream) load(nb.newer, { at: 0 }); else window.RoshUI.notify('זו התוכנית האחרונה.', 'info'); }
  function prevEpisode() {
    if (audio.currentTime > 3) { seek(0); return; }   // כמו בנגנים: לחיצה באמצע חוזרת להתחלה
    const nb = P.episode && S.neighbors(P.episode.id); if (nb?.older?.stream) load(nb.older, { at: 0 }); else window.RoshUI.notify('זו התוכנית הראשונה.', 'info');
  }
  /** תוכנית אקראית עם הקלטה — לא זו שמתנגנת עכשיו. */
  function random() {
    const pool = S.episodes().filter((e) => e.stream && e.id !== P.episode?.id);
    if (!pool.length) return false;
    const ep = pool[Math.floor(Math.random() * pool.length)];
    window.RoshUI.notify(`✦ ${ep.title}`, 'info', { ttl: 5000 });
    return load(ep, { at: 0 });
  }
  function updateNow(force) {
    if (!force) return;
    P.els.now.textContent = P.episode?.date ? window.RoshUI.fmtDate(P.episode.date) : '';
    mediaSession();
  }
  /* סימנים על פס ההתקדמות: רגעים שמאזינים הגיבו עליהם (מדף התוכנית) */
  const markers = new Map();   // episodeId → [{ at, label }]
  function setMarkers(id, list) { markers.set(id, list || []); paintMarkers(); }
  function paintMarkers() {
    if (!P.els.markers) return;
    const D = dur(), list = (P.episode && markers.get(P.episode.id)) || [];
    P.els.markers.innerHTML = D ? list.filter((m) => m.at < D).map((m) => `<i style="left:${(m.at / D) * 100}%" title="${esc(`${fmtTime(m.at)} · ${m.label}`)}"></i>`).join('') : '';
  }
  function renderSegments() {
    const D = dur();
    P.segs = [{ from: 0, to: D || 1 }];
    P.els.segs.innerHTML = '<span class="seg" style="flex-grow:1"><i></i></span>';
    P.els.scrub.setAttribute('aria-valuemax', String(Math.floor(D)));
    paintMarkers();
  }
  function paint(ratioOverride) {
    const D = dur();
    const t = ratioOverride != null ? ratioOverride * D : audio.currentTime;
    if (P.els.dur.textContent !== fmtTime(D)) { P.els.dur.textContent = fmtTime(D); renderSegments(); }
    P.els.cur.textContent = fmtTime(t);
    const ratio = D ? t / D : 0;
    P.els.knob.style.left = `${ratio * 100}%`;
    P.els.scrub.setAttribute('aria-valuenow', String(Math.floor(t)));
    P.els.scrub.setAttribute('aria-valuetext', fmtTime(t));
    const segEls = P.els.segs.children;
    (P.segs || []).forEach((s, i) => {
      const el = segEls[i]; if (!el) return;
      const fill = el.firstElementChild;
      if (t >= s.to) { el.classList.add('done'); el.classList.remove('on'); fill.style.width = '100%'; }
      else if (t >= s.from) { el.classList.remove('done'); el.classList.add('on'); fill.style.width = `${((t - s.from) / Math.max(.001, s.to - s.from)) * 100}%`; }
      else { el.classList.remove('done', 'on'); fill.style.width = '0'; }
    });
    P.els.toggle.textContent = audio.paused ? '▶' : '■';
    P.els.toggle.setAttribute('aria-label', audio.paused ? 'ניגון' : 'השהיה');
  }
  function preview(ratio) { paint(ratio); }
  function showTip(ratio) {
    const D = dur();
    const t = ratio * D;
    P.els.tip.style.left = `${ratio * 100}%`;
    P.els.tip.textContent = fmtTime(t);
    P.els.tip.style.opacity = '1';
  }

  /* ---------- שמירת מיקום ---------- */

  // דקות האזנה לסטטיסטיקה: כל שתי דקות של ניגון נשלחות כאירוע אחד, ומה שנשאר
  // נשלח גם בעצירה, במעבר לתוכנית אחרת ובסגירת הדף — כדי ששום דקה לא תלך לאיבוד.
  // עם כל אירוע נשלח גם עד איפה הגיעו (באחוזים) — לגרף "עד איפה מאזינים".
  const pctNow = () => { const D = dur(); return D ? Math.min(100, Math.round((audio.currentTime / D) * 100)) : 0; };
  function flushListen(closing = false) {
    if (!P.episode || !P.listened) return;
    S.sb.event('listen', P.episode.id, P.listened, { pct: pctNow() }, { beacon: closing });
    P.listened = 0;
  }
  setInterval(() => {
    if (audio.paused || !P.episode) return;
    P.listened = (P.listened || 0) + 1;
    S.listening.tick(1);   // זמן האזנה אמיתי באזור האישי
    if (P.listened >= 120) flushListen();
  }, 1000);

  function save(force) {
    if (!P.episode) return;
    const now = Date.now();
    if (!force && now - P.lastSaved < 5000) return;
    P.lastSaved = now;
    S.positions.set(P.episode.id, audio.currentTime, dur());
    S.last.set(P.episode.id, audio.currentTime);
  }

  /* ---------- Media Session ---------- */

  function mediaSession() {
    if (!('mediaSession' in navigator) || !P.episode) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: P.episode.title,
        artist: S.site?.name || 'ראש בראש',
        album: P.episode.title,
        // תמונת התוכנית במסך הנעילה ובשעון; כשאין תמונה — הלוגו של התוכנית
        artwork: P.episode.cover
          ? [{ src: P.episode.cover, sizes: '1400x1400', type: 'image/jpeg' }]
          : [{ src: new URL('assets/img/icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' }],
      });
      const h = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      h('play', play); h('pause', pause);
      h('seekbackward', () => seek(audio.currentTime - 15)); h('seekforward', () => seek(audio.currentTime + 15));
      h('previoustrack', prevEpisode); h('nexttrack', nextEpisode);
      h('seekto', (d) => seek(d.seekTime));
    } catch { /* */ }
  }

  /* ---------- ♥ על רגע: נשמר ב"הרגעים שסימנתם" באזור האישי ---------- */
  async function toggleMoment() {
    if (!P.episode) return;
    try {
      const r = await S.moments.toggle(P.episode.id, audio.currentTime);
      paintMomentBtn();
      window.RoshUI.notify(r.on ? `♥ נשמר: ${fmtTime(r.at)}. תמצאו את זה באזור האישי.` : 'הסימון הוסר.', 'success');
    } catch (err) {
      window.RoshUI.notify(err.message, 'info', err.login ? { action: 'להתחברות', onAction: () => (window.RoshApp ? window.RoshApp.navigate('me.html') : (location.href = 'me.html')) } : {});
    }
  }
  function paintMomentBtn() {
    const b = P.dock?.querySelector('[data-moment]'); if (!b || !P.episode) return;
    const on = S.moments.near(P.episode.id, audio.currentTime) != null;
    if (b.getAttribute('aria-pressed') !== String(on)) { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '♥ הרגע הזה' : '♡ הרגע הזה'; }
  }

  /* ---------- שיתוף ---------- */

  async function shareMoment() {
    if (!P.episode) return;
    const t = Math.floor(audio.currentTime);
    const url = window.RoshUI.shareUrl(P.episode, t);
    const text = `${P.episode.title} (${fmtTime(t)})`;
    if (navigator.share) { try { await navigator.share({ title: P.episode.title, text, url }); return; } catch { /* בוטל */ } }
    (await window.RoshUI.copy(url)) ? window.RoshUI.notify('הקישור לרגע הזה הועתק.', 'success') : window.RoshUI.notify('ההעתקה נכשלה. העתיקו מהשורה: ' + url, 'error');
  }

  /* ---------- אירועי אודיו ---------- */

  audio.addEventListener('timeupdate', () => { if (!P.dragging) { paint(); updateNow(); save(); paintMomentBtn(); } if (P.sleepAt && Date.now() >= P.sleepAt) { pause(); setSleep(''); P.els.sleep.value = ''; window.RoshUI.notify('הטיימר כיבה את הנגן. לילה טוב.', 'info'); } paintSleep(); emit('time'); });
  audio.addEventListener('loadedmetadata', () => { paint(); renderSegments(); paint(); });
  audio.addEventListener('durationchange', () => { renderSegments(); paint(); });
  const paintPlaying = () => document.body.classList.toggle('is-playing', !audio.paused && !audio.ended);
  audio.addEventListener('play', () => { paint(); paintPlaying(); emit('play'); });
  audio.addEventListener('playing', paintPlaying);
  audio.addEventListener('waiting', () => document.body.classList.remove('is-playing'));
  audio.addEventListener('pause', () => { paint(); paintPlaying(); save(true); flushListen(); emit('pause'); });
  /* סוף תוכנית: אם יש תור — ממשיכים לבאה בתור מיד. אחרת מציעים את "התוכנית
     הבאה" — אותו כיוון כמו הכפתור ▸▸ בנגן (החדשה יותר). */
  audio.addEventListener('ended', () => {
    paintPlaying(); paint();
    if (!P.episode) return;
    const id = P.episode.id;
    flushListen();
    S.positions.clear(id); S.listening.finish(id);
    emit('end');
    const queued = S.queue.shift(id);
    if (queued) { window.RoshUI.notify(`ממשיכים בתור: ${queued.title}`, 'info', { ttl: 5000 }); load(queued, { at: 0 }); return; }
    const nb = S.neighbors(id);
    if (nb.newer?.stream) window.RoshUI.notify(`נגמר. להמשיך לתוכנית הבאה, "${nb.newer.title}"?`, 'info', { action: 'כן, נגנו', onAction: () => load(nb.newer, { at: 0 }), ttl: 12000 });
  });
  audio.addEventListener('error', () => {
    paintPlaying();
    if (!P.episode || !audio.src) return;
    // מקור נוסף? (למשל הכתובת הישירה כשה־Worker לא זמין)
    if (P.candidates && P.candidateIndex + 1 < P.candidates.length) {
      const wasPlaying = !audio.paused || P.wantPlay;
      const t = audio.currentTime;
      P.candidateIndex += 1;
      audio.src = P.candidates[P.candidateIndex];
      audio.load();
      if (t > 0) { try { audio.currentTime = t; } catch { /* */ } }
      if (wasPlaying) play();
      return;
    }
    const src = audio.src;
    const dl = window.RoshUI.downloadUrl(P.episode);
    window.RoshUI.notify('ההקלטה לא נטענה כרגע. אפשר לנסות שוב או להוריד אותה.', 'error', {
      action: 'ניסיון חוזר', ttl: 15000,
      onAction: () => { P.candidateIndex = 0; audio.src = P.candidates?.[0] || src; audio.load(); play(); },
    });
    if (dl) P.els.download.href = dl;
  });
  audio.addEventListener('volumechange', () => S.prefs.set('volume', audio.volume));
  // כשהדף נסגר או עובר לרקע (בטלפון זה לפעמים הרגע האחרון) — שליחה ב־sendBeacon, שלא נחתכת
  document.addEventListener('visibilitychange', () => { if (document.hidden) { save(true); flushListen(true); } });
  window.addEventListener('pagehide', () => { save(true); flushListen(true); });

  /* ---------- קיצורי מקלדת ---------- */

  document.addEventListener('keydown', (e) => {
    if (window.RoshUI.isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!P.episode && e.key !== ' ' && e.key !== 'r' && e.key !== 'R') return;
    const open = document.querySelector('dialog[open]');
    if (open) return;
    switch (e.key) {
      case ' ': case 'k': case 'K': if (P.episode) { e.preventDefault(); toggle(); } break;
      case 'ArrowRight': e.preventDefault(); e.shiftKey ? nextEpisode() : seek(audio.currentTime + 15); break;
      case 'ArrowLeft': e.preventDefault(); e.shiftKey ? prevEpisode() : seek(audio.currentTime - 15); break;
      case 'j': case 'J': seek(audio.currentTime - 15); break;
      case 'l': case 'L': seek(audio.currentTime + 15); break;
      case 'm': case 'M': P.els.mute.click(); break;
      case 'r': case 'R': random(); break;
      case '+': case '=': setRate(RATES[Math.min(RATES.length - 1, RATES.indexOf(audio.playbackRate) + 1)] || 1); break;
      case '-': setRate(RATES[Math.max(0, RATES.indexOf(audio.playbackRate) - 1)] || 1); break;
      default:
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); seek(dur() * (Number(e.key) / 10)); }
    }
  });

  /* ---------- שחזור הנגן בכל דף ---------- */

  // התוכנית האחרונה מהחשבון (בכל מכשיר) — מוכנה בנגן, מושהית
  const restore = () => {
    const l = S.last.get();
    const ep = l && S.byId(l.id);
    if (ep && ep.visible && !S.scheduled(ep) && ep.stream && !P.episode) load(ep, { at: l.t, autoplay: false, quiet: true });
  };
  S.ready.then(restore);
  S.onSession(() => S.ready.then(restore));

  window.RoshPlayer = {
    load, play, pause, toggle, seek, nextEpisode, prevEpisode, random, close, setRate, shareMoment, setMarkers, RATES,
    get episode() { return P.episode; },
    get time() { return audio.currentTime; },
    get duration() { return dur(); },
    get paused() { return audio.paused; },
    get src() { return audio.currentSrc || audio.src; },
    isCurrent(id) { return P.episode?.id === id; },
  };
})();
