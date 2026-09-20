/**
 * The shared profile of the music tools sites.
 *
 * Both sites are served from the same origin (shmuel-lamed.github.io), so the
 * Supabase session lives in one localStorage: whoever signed in on SongToNotes
 * is already signed in here, and the other way round. Ringtones are written to
 * the `ringtones` table, so the profile shows them on every device — while a
 * visitor without an account keeps the local history exactly as before.
 */
const SUPABASE_URL = "https://ydcfafijktzasrkkxyux.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hmcfter-RriY3pKrbZnJqg_2228WwCM";
const SUPABASE_MODULE = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/+esm";
const NOTES_SITE = "https://shmuel-lamed.github.io/SongToNotes/";
const RINGTONE_HISTORY_KEY = "music-tools.ringtone-history.v1";

const $ = (selector) => document.querySelector(selector);
const dateFormat = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

function readLocal() {
  try {
    const value = JSON.parse(localStorage.getItem(RINGTONE_HISTORY_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => item && typeof item.id === "string" && typeof item.title === "string")
      .slice(0, 50);
  } catch {
    return [];
  }
}

function writeLocal(items) {
  try {
    localStorage.setItem(RINGTONE_HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
  } catch {
    // Storage blocked; the copy in the profile is the one that matters.
  }
}

const toRow = (item, userId) => ({
  user_id: userId,
  client_id: item.id,
  title: item.title,
  source_name: item.sourceName || null,
  start_seconds: item.startSeconds,
  duration_seconds: item.durationSeconds,
  created_at: item.createdAt,
});

const fromRow = (row) => ({
  id: row.client_id,
  title: row.title,
  sourceName: row.source_name || "",
  startSeconds: row.start_seconds,
  durationSeconds: row.duration_seconds,
  createdAt: row.created_at,
});

// The profile is a bonus on top of the ringtone editor: if the library cannot
// be fetched the page keeps working, only without an account.
let supabase = null;
try {
  const { createClient } = await import(SUPABASE_MODULE);
  supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
} catch (error) {
  console.warn("הפרופיל אינו זמין כרגע", error);
}

let user = null;
let profile = null;
let ringtones = readLocal();
let notes = [];
let tab = "ringtones";
let loading = false;
let message = "";

const button = $("#profileButton");
const overlay = $("#profileOverlay");
const panel = $("#profilePanel");
const list = $("#profileList");
const messageBox = $("#profileMessage");

function setMessage(text) {
  message = text;
  messageBox.textContent = text;
  messageBox.classList.toggle("hidden", !text);
}

function avatarInto(element, size) {
  element.textContent = "";
  element.classList.toggle("has-photo", Boolean(profile?.avatar_url));
  if (profile?.avatar_url) {
    const image = document.createElement("img");
    image.src = profile.avatar_url;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    element.append(image);
    return;
  }
  const initial = (profile?.full_name || user?.email || "").trim().charAt(0).toUpperCase();
  element.textContent = initial || "♪";
  element.style.fontSize = size;
}

function renderButton() {
  avatarInto($("#profileAvatar"), "15px");
  const name = user
    ? profile?.full_name?.split(" ")[0] || "הפרופיל שלי"
    : "התחברות";
  $("#profileButtonName").textContent = name;
  $("#profileButtonNote").textContent = user ? "ההיסטוריה שלי" : "לשמירת הצלצולים";
  $("#profileButton")?.setAttribute(
    "aria-label",
    user ? `פרופיל — ${profile?.full_name || "משתמש מחובר"}` : "התחברות לפרופיל",
  );
}

function renderAccount() {
  $("#profileSignedOut").classList.toggle("hidden", Boolean(user));
  $("#profileSignedIn").classList.toggle("hidden", !user);
  $("#profileSignOut").classList.toggle("hidden", !user);
  if (!user) return;
  avatarInto($("#profileCardAvatar"), "22px");
  $("#profileCardName").textContent = profile?.full_name || "החשבון שלי";
  $("#profileCardEmail").textContent = user.email || "";
  const input = $("#profileNameInput");
  if (document.activeElement !== input) input.value = profile?.full_name || "";
  $("#profileNameSave").disabled = !input.value.trim() || input.value.trim() === profile?.full_name;
}

function historyRow({ icon, ringtone, title, detail, href, onDelete }) {
  const article = document.createElement("article");
  article.className = "profile-item";

  const open = document.createElement(href ? "a" : "div");
  open.className = "profile-item-open";
  if (href) open.href = href;

  const mark = document.createElement("span");
  mark.className = ringtone ? "profile-item-mark ringtone" : "profile-item-mark";
  mark.textContent = icon;
  mark.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  const name = document.createElement("b");
  name.textContent = title;
  const small = document.createElement("small");
  small.textContent = detail;
  text.append(name, small);
  open.append(mark, text);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "profile-item-delete";
  remove.textContent = "🗑";
  remove.setAttribute("aria-label", `מחיקת ${title}`);
  remove.onclick = () => {
    if (!window.confirm(`למחוק את „${title}” מההיסטוריה?`)) return;
    onDelete();
  };

  article.append(open, remove);
  return article;
}

function emptyNote(text) {
  const paragraph = document.createElement("p");
  paragraph.className = "profile-empty";
  paragraph.textContent = text;
  return paragraph;
}

function renderList() {
  $("#profileRingtoneCount").textContent = String(ringtones.length);
  $("#profileNoteCount").textContent = String(notes.length);
  document.querySelectorAll("[data-tab]").forEach((element) => {
    const active = element.dataset.tab === tab;
    element.classList.toggle("active", active);
    element.setAttribute("aria-selected", String(active));
    // Roving tab stop: the tablist itself is one stop, the arrows move inside.
    element.tabIndex = active ? 0 : -1;
  });
  list.setAttribute("aria-labelledby", `profileTab-${tab}`);

  list.textContent = "";
  if (loading) {
    list.append(emptyNote("טוען את ההיסטוריה…"));
    return;
  }

  if (tab === "ringtones") {
    if (ringtones.length === 0) {
      list.append(emptyNote("עדיין אין צלצולים שמורים. כל צלצול שתוריד יופיע כאן אוטומטית."));
      return;
    }
    ringtones.forEach((item) => {
      list.append(historyRow({
        icon: "♪",
        ringtone: true,
        title: item.title,
        detail: `${formatDate(item.createdAt)} · ${Math.round(item.durationSeconds)} שניות`,
        onDelete: () => void removeRingtone(item.id),
      }));
    });
    return;
  }

  if (!user) {
    list.append(emptyNote("התחבר כדי לראות כאן את התווים ששמרת באתר התווים."));
    return;
  }
  if (notes.length === 0) {
    list.append(emptyNote("עדיין אין תווים שמורים. כל שיר שתמיר באתר התווים יופיע כאן."));
    return;
  }
  notes.forEach((item) => {
    list.append(historyRow({
      icon: "♫",
      title: item.title,
      detail: `${formatDate(item.created_at)} · ${item.note_count} תווים`,
      href: NOTES_SITE,
      onDelete: () => void removeNote(item.id),
    }));
  });
}

function render() {
  renderButton();
  renderAccount();
  renderList();
}

async function loadProfile(nextUser) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .eq("id", nextUser.id)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    profile = data;
    return;
  }
  const fallback = {
    id: nextUser.id,
    full_name: nextUser.user_metadata?.full_name ?? nextUser.user_metadata?.name ?? null,
    avatar_url: nextUser.user_metadata?.avatar_url ?? null,
  };
  const { data: created, error: createError } = await supabase
    .from("profiles")
    .upsert(fallback)
    .select("id, full_name, avatar_url")
    .single();
  if (createError) throw createError;
  profile = created;
}

/**
 * Loads both lists and reports which of them failed, so that one table being
 * unreachable — or not migrated yet — never blanks out the other tab.
 */
async function loadHistory() {
  const local = readLocal();
  if (!user) {
    ringtones = local;
    notes = [];
    return { notesFailed: false, ringtonesFailed: false };
  }

  const [savedRingtones, savedNotes] = await Promise.all([
    supabase
      .from("ringtones")
      .select("client_id, title, source_name, start_seconds, duration_seconds, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("transcriptions")
      .select("id, title, note_count, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  const notesFailed = Boolean(savedNotes.error);
  if (notesFailed) console.warn("התווים לא נטענו", savedNotes.error);
  notes = notesFailed ? [] : savedNotes.data ?? [];

  if (savedRingtones.error) {
    console.warn("הצלצולים לא נטענו", savedRingtones.error);
    ringtones = local;
    return { notesFailed, ringtonesFailed: true };
  }

  // Ringtones this device made before signing in join the profile now.
  const cloud = (savedRingtones.data ?? []).map(fromRow);
  const known = new Set(cloud.map((item) => item.id));
  const missing = local.filter((item) => !known.has(item.id));
  if (missing.length > 0) {
    const { error } = await supabase
      .from("ringtones")
      .upsert(missing.map((item) => toRow(item, user.id)), { onConflict: "user_id,client_id" });
    if (error) console.warn("צלצולים מקומיים לא הועלו לפרופיל", error);
  }

  ringtones = [...cloud, ...missing].sort((a, b) =>
    String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
  );
  return { notesFailed, ringtonesFailed: false };
}

async function refresh() {
  loading = true;
  render();
  try {
    const { notesFailed, ringtonesFailed } = await loadHistory();
    setMessage(
      ringtonesFailed && notesFailed
        ? "לא הצלחנו לטעון את ההיסטוריה מהפרופיל. מוצגים הצלצולים מהמכשיר הזה."
        : ringtonesFailed
          ? "לא הצלחנו לטעון את הצלצולים מהפרופיל. מוצגים הצלצולים מהמכשיר הזה."
          : notesFailed
            ? "לא הצלחנו לטעון את התווים מהפרופיל."
            : "",
    );
  } catch (error) {
    console.warn("ההיסטוריה לא נטענה", error);
    ringtones = readLocal();
    notes = [];
    setMessage("לא הצלחנו לטעון את ההיסטוריה מהפרופיל. מוצגים הצלצולים מהמכשיר הזה.");
  } finally {
    loading = false;
    render();
  }
}

async function saveRingtone(item) {
  if (!supabase || !user) return;
  const { error } = await supabase
    .from("ringtones")
    .upsert(toRow(item, user.id), { onConflict: "user_id,client_id" });
  if (error) console.warn("הצלצול לא נשמר בפרופיל", error);
}

async function removeRingtone(id) {
  writeLocal(readLocal().filter((item) => item.id !== id));
  ringtones = ringtones.filter((item) => item.id !== id);
  render();
  if (!supabase || !user) return;
  const { error } = await supabase
    .from("ringtones")
    .delete()
    .eq("user_id", user.id)
    .eq("client_id", id);
  if (error) setMessage("לא הצלחנו למחוק את הצלצול מהפרופיל.");
}

async function removeNote(id) {
  notes = notes.filter((item) => item.id !== id);
  render();
  // Signing out while the panel is open leaves the list on screen, so the
  // delete has to survive having no session to delete through.
  if (!supabase || !user) return;
  const { error } = await supabase
    .from("transcriptions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) setMessage("לא הצלחנו למחוק את היצירה.");
}

let lastFocused = null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

const isOpen = () => !overlay.classList.contains("hidden");

/** The visible tab stops of the panel, in document order. */
function focusStops() {
  return Array.from(panel.querySelectorAll(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null,
  );
}

function openPanel() {
  lastFocused = document.activeElement;
  overlay.classList.remove("hidden");
  button.setAttribute("aria-expanded", "true");
  setMessage(message);
  render();
  panel.querySelector("button, a, input")?.focus();
  if (user) void refresh();
}

function closePanel() {
  overlay.classList.add("hidden");
  button.setAttribute("aria-expanded", "false");
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
}

// A ringtone is saved the moment it is downloaded, whether the panel is open
// or not, so the history is never missing the download that just happened.
document.addEventListener("ringtone-created", (event) => {
  const item = event.detail;
  ringtones = [item, ...ringtones.filter((entry) => entry.id !== item.id)].slice(0, 50);
  renderList();
  void saveRingtone(item);
});

button.classList.remove("hidden");
button.onclick = () => (isOpen() ? closePanel() : openPanel());
$("#profileClose").onclick = closePanel;
overlay.onmousedown = (event) => { if (event.target === overlay) closePanel(); };
// The panel declares `aria-modal`, so Tab has to stay inside it.
document.addEventListener("keydown", (event) => {
  if (!isOpen()) return;
  if (event.key === "Escape") {
    closePanel();
    return;
  }
  if (event.key !== "Tab") return;
  const stops = focusStops();
  if (stops.length === 0) return;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!panel.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
});
const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
tabButtons.forEach((element, index) => {
  element.onclick = () => { tab = element.dataset.tab; renderList(); };
  // The page is right-to-left, so the left arrow is the one that moves on.
  element.onkeydown = (event) => {
    const forward = event.key === "ArrowLeft";
    const back = event.key === "ArrowRight";
    if (!forward && !back && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabButtons.length - 1
        : (index + (forward ? 1 : -1) + tabButtons.length) % tabButtons.length;
    tabButtons[next].focus();
  };
});

$("#profileSignIn").onclick = async () => {
  if (!supabase) return;
  setMessage("");
  const redirectTo = new URL(".", window.location.href).toString();
  const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  if (error) setMessage("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב.");
};

$("#profileSignOut").onclick = async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) setMessage("לא הצלחנו לצאת מהחשבון. נסה שוב.");
};

$("#profileNameInput").oninput = () => {
  const value = $("#profileNameInput").value.trim();
  $("#profileNameSave").disabled = !value || value === profile?.full_name;
};

$("#profileNameSave").onclick = async () => {
  const fullName = $("#profileNameInput").value.trim().slice(0, 80);
  if (!supabase || !user || !fullName) return;
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", user.id)
    .select("id, full_name, avatar_url")
    .single();
  if (error) {
    setMessage("לא הצלחנו לשמור את השם.");
    return;
  }
  profile = data;
  setMessage("השם נשמר.");
  render();
};

async function applySession(session) {
  user = session?.user ?? null;
  profile = null;
  if (user) {
    try {
      await loadProfile(user);
    } catch (error) {
      console.warn("הפרופיל לא נטען", error);
    }
  }
  render();
  if (user) await refresh();
  else { ringtones = readLocal(); renderList(); }
}

if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    // Supabase asks that its own calls are not made inside this callback.
    window.setTimeout(() => void applySession(session), 0);
  });
  try {
    const { data } = await supabase.auth.getSession();
    await applySession(data.session);
  } catch (error) {
    console.warn("מצב ההתחברות לא נטען", error);
    render();
  }
} else {
  $("#profileSignIn").disabled = true;
  setMessage("ההתחברות אינה זמינה כרגע. הצלצולים נשמרים במכשיר הזה בלבד.");
  render();
}
