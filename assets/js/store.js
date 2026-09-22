/* שכבת הנתונים של ראש בראש.
   מקורות אפשריים (site.json → storage.provider):
     "json"     — קובץ data/episodes.json במאגר (ברירת מחדל, בלי שרת).
     "supabase" — טבלאות ב־Supabase; קריאה ציבורית, כתיבה למשתמש מחובר.
   בכל מצב, אזור הניהול יכול לשמור "טיוטה מקומית" בדפדפן שמופיעה באתר
   רק במכשיר הזה — כדי לבדוק לפני שמפרסמים. */
(function () {
  'use strict';

  const LS = {
    override: 'rosh:override',      // טיוטה מקומית של כל הנתונים
    pos: 'rosh:pos:',               // מיקום האזנה לכל תוכנית
    last: 'rosh:last',              // התוכנית האחרונה שנוגנה
    later: 'rosh:later',            // "לאחר כך"
    sb: 'rosh:sb:session',          // סשן Supabase
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

  /* ---------- Supabase (REST בלבד, בלי ספרייה) ---------- */

  const sb = {
    get cfg() { return state.site?.storage?.supabase || null; },
    get configured() { const c = this.cfg; return !!(c && c.url && c.anonKey); },
    get session() { return read(LS.sb, null); },
    set session(v) { write(LS.sb, v); },
    get user() { return this.session?.user || null; },
    headers(auth = true) {
      const h = { apikey: this.cfg.anonKey, 'Content-Type': 'application/json' };
      const s = this.session;
      h.Authorization = `Bearer ${auth && s?.access_token ? s.access_token : this.cfg.anonKey}`;
      return h;
    },
    base(path) { return `${this.cfg.url.replace(/\/$/, '')}${path}`; },
    async signIn(email, password) {
      const r = await fetch(this.base('/auth/v1/token?grant_type=password'), {
        method: 'POST', headers: this.headers(false), body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'ההתחברות נכשלה');
      this.session = { ...j, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
      return this.user;
    },
    async refresh() {
      const s = this.session;
      if (!s?.refresh_token) return null;
      if (s.expires_at && s.expires_at - Date.now() > 60_000) return s;
      const r = await fetch(this.base('/auth/v1/token?grant_type=refresh_token'), {
        method: 'POST', headers: this.headers(false), body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      if (!r.ok) { this.session = null; return null; }
      const j = await r.json();
      this.session = { ...j, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
      return this.session;
    },
    signOut() { this.session = null; },
    /** התחברות עם Google: מעבר לדף ההרשאה של Supabase וחזרה לכאן עם הטוקן ב-hash */
    signInWithGoogle(returnTo = location.href.split('#')[0]) {
      location.href = this.base(`/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(returnTo)}`);
    },
    /** קליטת הטוקן מה-hash אחרי חזרה מ-Google. מחזיר את המשתמש או null. */
    async handleRedirect() {
      if (!this.configured || !location.hash.includes('access_token=')) return null;
      const h = new URLSearchParams(location.hash.slice(1));
      const access_token = h.get('access_token'), refresh_token = h.get('refresh_token');
      if (!access_token) return null;
      history.replaceState(null, '', location.pathname + location.search);
      const r = await fetch(this.base('/auth/v1/user'), { headers: { apikey: this.cfg.anonKey, Authorization: `Bearer ${access_token}` } });
      if (!r.ok) return null;
      const user = await r.json();
      this.session = { access_token, refresh_token, expires_at: Date.now() + Number(h.get('expires_in') || 3600) * 1000, user };
      return user;
    },
    /** auth=true מושך גם תוכניות מוסתרות (למנהל מחובר) */
    async pull(auth = false) {
      if (auth) await this.refresh();
      const t = this.cfg.table || 'rosh_episodes', st = this.cfg.settingsTable || 'rosh_settings';
      const [er, sr] = await Promise.all([
        fetch(this.base(`/rest/v1/${t}?select=id,data&order=date.desc.nullslast,number.desc.nullslast`), { headers: this.headers(auth) }),
        fetch(this.base(`/rest/v1/${st}?select=key,value`), { headers: this.headers(auth) }),
      ]);
      if (!er.ok) throw new Error(`Supabase: ${er.status}`);
      const rows = await er.json();
      const settings = sr.ok ? await sr.json() : [];
      const seasons = settings.find((s) => s.key === 'seasons')?.value || [];
      return { version: 1, seasons, episodes: rows.map((r) => ({ ...r.data, id: r.id })) };
    },
    async push(data, { removedIds = [] } = {}) {
      await this.refresh();
      if (!this.user) throw new Error('צריך להתחבר כדי לפרסם');
      const t = this.cfg.table || 'rosh_episodes', st = this.cfg.settingsTable || 'rosh_settings';
      const rows = data.episodes.map((e) => ({ id: e.id, data: e, visible: e.visible, date: e.date || null, number: e.number, updated_at: new Date().toISOString() }));
      const r = await fetch(this.base(`/rest/v1/${t}?on_conflict=id`), {
        method: 'POST', headers: { ...this.headers(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
      });
      if (!r.ok) throw new Error(`שמירת התוכניות נכשלה (${r.status}): ${await r.text()}`);
      if (removedIds.length) {
        const d = await fetch(this.base(`/rest/v1/${t}?id=in.(${removedIds.map(encodeURIComponent).join(',')})`), { method: 'DELETE', headers: this.headers() });
        if (!d.ok) throw new Error(`מחיקה נכשלה (${d.status})`);
      }
      const s = await fetch(this.base(`/rest/v1/${st}?on_conflict=key`), {
        method: 'POST', headers: { ...this.headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ key: 'seasons', value: data.seasons }]),
      });
      if (!s.ok) throw new Error(`שמירת העונות נכשלה (${s.status})`);
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
    catch (e) { state.site = { name: 'ראש בראש', tagline: 'מצעד המוזיקה הגדול', storage: { provider: 'json' } }; }
    state.source = state.site.storage?.provider === 'supabase' && sb.configured ? 'supabase' : 'json';
    if (state.source === 'supabase') { try { state.authRedirect = await sb.handleRedirect(); } catch { state.authRedirect = null; } }

    const override = ignoreOverride ? null : read(LS.override, null);
    if (override) {
      state.data = normalize(override);
      state.loadedFrom = 'override';
    } else {
      try {
        const raw = state.source === 'supabase' ? await sb.pull() : await fetchJSON('data/episodes.json');
        state.data = normalize(raw);
        state.loadedFrom = state.source;
      } catch (e) {
        state.error = e;
        // נפילה חזרה לקובץ המקומי אם Supabase לא זמין
        if (state.source === 'supabase') {
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
      return normalize(state.source === 'supabase' ? await sb.pull(true) : await fetchJSON('data/episodes.json'));
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
