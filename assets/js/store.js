/* שכבת הנתונים של ראש בראש.
   מקורות אפשריים (site.json → storage.provider):
     "json"     — קובץ data/episodes.json במאגר (ברירת מחדל, בלי שרת).
     "cloudflare" — אותו D1 של אתר הסקר; קריאה ציבורית וכתיבת מנהל.
   בכל מצב, אזור הניהול יכול לשמור "טיוטה מקומית" בדפדפן שמופיעה באתר
   רק במכשיר הזה — כדי לבדוק לפני שמפרסמים. */
(function () {
  'use strict';

  const LS = {
    override: 'rosh:override',      // טיוטה מקומית של כל הנתונים
    pos: 'rosh:pos:',               // מיקום האזנה לכל תוכנית
    last: 'rosh:last',              // התוכנית האחרונה שנוגנה
    later: 'rosh:later',            // "לאחר כך"
    sb: 'rosh:cf:session',          // סשן מנהל Cloudflare
    prefs: 'rosh:prefs',            // מהירות, עוצמה, תצוגת ארכיון
  };

  const read = (k, fb) => { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* מצב פרטי */ } };

  const state = {
    site: null,
    data: { version: 1, seasons: [], episodes: [] },
    source: 'json',
    error: null,
    loadedFrom: null,
  };

  /* ---------- נרמול ---------- */

  function normEpisode(e, i) {
    const tracks = Array.isArray(e.tracks) ? e.tracks : [];
    const ep = {
      id: String(e.id || e.slug || `ep-${i}`),
      slug: String(e.slug || e.id || `ep-${i}`),
      number: e.number == null || e.number === '' ? null : Number(e.number),
      season: e.season ? String(e.season) : '',
      title: String(e.title || ''),
      date: e.date ? String(e.date).slice(0, 10) : '',
      description: String(e.description || ''),
      cover: String(e.cover || ''),
      audio: String(e.audio || ''),
      duration: Number(e.duration) || 0,
      tags: Array.isArray(e.tags) ? e.tags.map(String).filter(Boolean) : [],
      guests: Array.isArray(e.guests) ? e.guests.map(String).filter(Boolean) : [],
      links: Array.isArray(e.links) ? e.links.filter((l) => l && l.url).map((l) => ({ label: String(l.label || l.url), url: String(l.url) })) : [],
      featured: !!e.featured,
      visible: e.visible !== false,
      tracks: tracks
        .filter((t) => t && (t.title || t.artist))
        .map((t) => ({ at: Math.max(0, Number(t.at) || 0), title: String(t.title || ''), artist: String(t.artist || ''), note: String(t.note || '') }))
        .sort((a, b) => a.at - b.at),
    };
    return ep;
  }

  function normalize(raw) {
    const seasons = (Array.isArray(raw?.seasons) ? raw.seasons : []).map((s, i) => ({
      id: String(s.id || `s${i + 1}`), title: String(s.title || `עונה ${i + 1}`), year: s.year ? Number(s.year) : null, note: String(s.note || ''),
    }));
    const episodes = (Array.isArray(raw?.episodes) ? raw.episodes : []).map(normEpisode);
    // עונות שמופיעות בתוכניות אך לא הוגדרו
    for (const e of episodes) {
      if (e.season && !seasons.find((s) => s.id === e.season)) seasons.push({ id: e.season, title: e.season, year: null, note: '' });
    }
    return { version: Number(raw?.version) || 1, updated: raw?.updated || '', seasons, episodes };
  }

  /* ---------- Cloudflare: אותו D1 ואותו אימות Google של אתר הסקר ---------- */

  const sb = {
    get cfg() { return state.site?.storage?.cloudflare || null; },
    get configured() { return !!this.cfg?.apiBase; },
    get session() { return read(LS.sb, null); },
    set session(v) { write(LS.sb, v); },
    get user() { return this.session?.user || null; },
    base(path) { return `${this.cfg.apiBase.replace(/\/$/, '')}${path}`; },
    headers(auth = true) {
      const h = { 'Content-Type': 'application/json' };
      if (auth && this.session?.token) h.Authorization = `Bearer ${this.session.token}`;
      return h;
    },
    async signInWithGoogle() {
      const origin = new URL(this.cfg.apiBase).origin;
      const popup = window.open(this.base('/api/program/login'), 'rosh-program-login', 'popup,width=460,height=620');
      if (!popup) throw new Error('הדפדפן חסם את חלון ההתחברות. אפשרו חלונות קופצים ונסו שוב.');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('ההתחברות ארכה יותר מדי. נסו שוב.')); }, 120000);
        const receive = (event) => {
          if (event.origin !== origin || event.data?.type !== 'rosh-program-auth') return;
          clearTimeout(timer); window.removeEventListener('message', receive);
          if (!event.data.token || !event.data.user?.isAdmin) return reject(new Error('לחשבון הזה אין הרשאת ניהול.'));
          this.session = { token:event.data.token, user:event.data.user };
          resolve(event.data.user);
        };
        window.addEventListener('message', receive);
      });
    },
    async refresh() { return this.session; },
    signOut() { this.session = null; },
    async isAdmin() {
      if (!this.session?.token) return false;
      const r = await fetch(this.base('/api/program/me'), { headers:this.headers() });
      if (!r.ok) { if (r.status === 401) this.session = null; return false; }
      const j = await r.json();
      this.session = { ...this.session, user:j.user };
      return !!j.user?.isAdmin;
    },
    async pull(auth = false) {
      const r = await fetch(this.base('/api/program/catalog'), { headers:this.headers(auth), cache:'no-store' });
      if (!r.ok) throw new Error(`Cloudflare: ${r.status}`);
      return r.json();
    },
    async push(data, { removedIds = [] } = {}) {
      if (!await this.isAdmin()) throw new Error('צריך להתחבר עם חשבון מנהל כדי לפרסם');
      const r = await fetch(this.base('/api/program/catalog'), {
        method:'POST', headers:this.headers(), body:JSON.stringify({ seasons:data.seasons, episodes:data.episodes, removedIds }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `שמירת התוכניות נכשלה (${r.status})`);
      return j;
    },
  };

  /* ---------- טעינה ---------- */

  async function fetchJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  }

  let readyResolve;
  const ready = new Promise((res) => { readyResolve = res; });

  async function load({ ignoreOverride = false } = {}) {
    state.error = null;
    try { state.site = await fetchJSON('data/site.json'); }
    catch (e) { state.site = { name: 'ראש בראש', tagline: 'מוזיקה ואקטואליה', storage: { provider: 'json' } }; }
    state.source = state.site.storage?.provider === 'cloudflare' && sb.configured ? 'cloudflare' : 'json';


    const override = ignoreOverride ? null : read(LS.override, null);
    if (override) {
      state.data = normalize(override);
      state.loadedFrom = 'override';
    } else {
      try {
        const raw = state.source === 'cloudflare' ? await sb.pull() : await fetchJSON('data/episodes.json');
        state.data = normalize(raw);
        state.loadedFrom = state.source;
      } catch (e) {
        state.error = e;
        // נפילה חזרה לקובץ המקומי אם Supabase לא זמין
        if (state.source === 'cloudflare') {
          try { state.data = normalize(await fetchJSON('data/episodes.json')); state.loadedFrom = 'json-fallback'; }
          catch { state.data = normalize({}); }
        } else state.data = normalize({});
      }
    }
    readyResolve(state);
    return state;
  }

  /* ---------- שאילתות ---------- */

  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || 0) - (a.number || 0);

  function episodes({ includeHidden = false } = {}) {
    return state.data.episodes.filter((e) => includeHidden || e.visible).sort(byDate);
  }
  function seasons() {
    const list = state.data.seasons.slice();
    const counts = {};
    for (const e of episodes()) counts[e.season] = (counts[e.season] || 0) + 1;
    return list.map((s) => ({ ...s, count: counts[s.id] || 0 })).sort((a, b) => (b.year || 0) - (a.year || 0));
  }
  function bySlug(slug) { return state.data.episodes.find((e) => e.slug === slug || e.id === slug) || null; }
  function byId(id) { return state.data.episodes.find((e) => e.id === id) || null; }
  function latest() { return episodes()[0] || null; }
  function featured() { return episodes().find((e) => e.featured) || latest(); }
  function neighbors(id) {
    const list = episodes();
    const i = list.findIndex((e) => e.id === id);
    return { newer: i > 0 ? list[i - 1] : null, older: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
  }

  /** אינדקס כל השירים בכל התוכניות — "איפה השמעתם את…" */
  function songIndex() {
    const out = [];
    for (const e of episodes()) for (const t of e.tracks) out.push({ episode: e, track: t });
    return out;
  }

  const fold = (s) => String(s || '').toLowerCase().replace(/[֑-ׇ]/g, '').replace(/[״"'׳]/g, '').replace(/\s+/g, ' ').trim();

  function searchEpisodes(q, list = episodes()) {
    q = fold(q);
    if (!q) return list;
    const terms = q.split(' ');
    return list.filter((e) => {
      const hay = fold([e.title, e.description, e.number, e.date, ...e.tags, ...e.guests, ...e.tracks.map((t) => `${t.title} ${t.artist}`)].join(' '));
      return terms.every((t) => hay.includes(t));
    });
  }
  function searchSongs(q, limit = 40) {
    q = fold(q);
    if (q.length < 2) return [];
    const terms = q.split(' ');
    return songIndex().filter(({ track }) => {
      const hay = fold(`${track.title} ${track.artist} ${track.note}`);
      return terms.every((t) => hay.includes(t));
    }).slice(0, limit);
  }

  /* ---------- העדפות ומיקומי האזנה ---------- */

  const prefs = {
    get all() { return read(LS.prefs, {}); },
    get(k, fb) { const v = this.all[k]; return v == null ? fb : v; },
    set(k, v) { write(LS.prefs, { ...this.all, [k]: v }); },
  };

  const positions = {
    get(id) { return read(LS.pos + id, null); },
    set(id, t, dur) { write(LS.pos + id, { t: Math.floor(t), dur: Math.floor(dur || 0), at: Date.now() }); },
    clear(id) { write(LS.pos + id, null); },
    /** תוכניות שהתחלתם ולא סיימתם, מהאחרונה */
    resumable() {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k.startsWith(LS.pos)) continue;
          const p = read(k, null), e = byId(k.slice(LS.pos.length));
          if (e && e.visible && p && p.t > 20 && (!p.dur || p.t < p.dur - 30)) out.push({ episode: e, ...p });
        }
      } catch { /* */ }
      return out.sort((a, b) => b.at - a.at);
    },
  };

  const last = {
    get() { return read(LS.last, null); },
    set(id, t) { write(LS.last, { id, t: Math.floor(t || 0) }); },
  };

  const later = {
    list() { return read(LS.later, []); },
    has(id) { return this.list().includes(id); },
    toggle(id) { const l = this.list(); const i = l.indexOf(id); i >= 0 ? l.splice(i, 1) : l.unshift(id); write(LS.later, l); return i < 0; },
  };

  /* ---------- ניהול ---------- */

  const admin = {
    get hasOverride() { return !!read(LS.override, null); },
    saveOverride(data) { write(LS.override, data); },
    clearOverride() { write(LS.override, null); },
    /** הנתונים כפי שהם במקור (בלי הטיוטה המקומית) */
    async pullOrigin() {
      return normalize(state.source === 'cloudflare' ? await sb.pull(true) : await fetchJSON('data/episodes.json'));
    },
    export(data) {
      return JSON.stringify({ version: 1, updated: new Date().toISOString().slice(0, 10), seasons: data.seasons, episodes: data.episodes }, null, 2);
    },
    validate(raw) {
      const errors = [];
      if (!raw || typeof raw !== 'object') return ['הקובץ אינו אובייקט JSON'];
      if (!Array.isArray(raw.episodes)) errors.push('חסר מערך "episodes"');
      const ids = new Set(), slugs = new Set();
      (raw.episodes || []).forEach((e, i) => {
        const where = `תוכנית #${i + 1}${e?.title ? ` (${e.title})` : ''}`;
        if (!e || typeof e !== 'object') { errors.push(`${where}: לא אובייקט`); return; }
        if (!e.title) errors.push(`${where}: חסרה כותרת`);
        if (e.id && ids.has(e.id)) errors.push(`${where}: מזהה כפול "${e.id}"`);
        if (e.slug && slugs.has(e.slug)) errors.push(`${where}: כתובת כפולה "${e.slug}"`);
        ids.add(e.id); slugs.add(e.slug);
        if (e.date && !/^\d{4}-\d{2}-\d{2}/.test(String(e.date))) errors.push(`${where}: תאריך לא בפורמט YYYY-MM-DD`);
        if (e.tracks && !Array.isArray(e.tracks)) errors.push(`${where}: "tracks" חייב להיות מערך`);
      });
      return errors;
    },
    normalize,
    normEpisode,
  };

  window.RoshStore = {
    state, ready, load, sb, prefs, positions, last, later, admin,
    episodes, seasons, bySlug, byId, latest, featured, neighbors, songIndex, searchEpisodes, searchSongs,
    get site() { return state.site; },
    get data() { return state.data; },
  };

  load();
})();
