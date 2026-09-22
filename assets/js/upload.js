/* Chunked TUS upload; administrator permissions are enforced by Storage RLS. */
(function () {
  'use strict';
  window.RoshUpload = async function (file, episodeId, kind, progress) {
    const sb = window.RoshStore.sb;
    if (!await sb.isAdmin()) throw new Error('יש להתחבר עם חשבון מנהל כדי להעלות קבצים.');
    const types = kind === 'audio'
      ? { mp3:'audio/mpeg', m4a:'audio/mp4', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/aac' }
      : { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp' };
    const ext = file.name.split('.').pop().toLowerCase();
    if (!types[ext]) throw new Error('סוג הקובץ אינו נתמך.');
    if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('אפשר להעלות עד 50MB לקובץ. לקובץ גדול יותר הדביקו קישור שיתוף מ־Google Drive.');
    const fingerprint = [sb.cfg.url, sb.user.id, episodeId, kind, file.name, file.size, file.lastModified].join('|');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
    const key = 'rosh:upload:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
    const base = sb.cfg.url.replace(/\/$/, '');
    const endpoint = base + '/storage/v1/upload/resumable';
    const headers = () => ({ Authorization: 'Bearer ' + sb.session.access_token, apikey: sb.cfg.anonKey, 'Tus-Resumable':'1.0.0' });
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key)); } catch { /* private mode */ }
    if (saved && (!saved.url.startsWith(endpoint + '/') || !saved.path.startsWith('episodes/'))) saved = null;
    let offset = 0;
    if (saved) {
      const r = await fetch(saved.url, { method:'HEAD', headers:headers() });
      if (r.ok) offset = Number(r.headers.get('Upload-Offset'));
      else if (r.status === 404 || r.status === 410) saved = null;
      else throw new Error('לא ניתן לחדש את ההעלאה כרגע. נסו שוב.');
    }
    if (!saved) {
      const path = `episodes/${encodeURIComponent(episodeId)}/${crypto.randomUUID()}.${ext}`;
      const meta = { bucketName:'rosh-media', objectName:path, contentType:types[ext], cacheControl:'3600' };
      const r = await fetch(endpoint, { method:'POST', headers:{...headers(), 'Upload-Length':String(file.size), 'Upload-Metadata':Object.entries(meta).map(([k,v]) => `${k} ${btoa(v)}`).join(',')} });
      if (!r.ok) throw new Error(`העלאת הקובץ לא התחילה (${r.status}). בדקו הרשאה ומכסת אחסון.`);
      const location = r.headers.get('Location');
      if (!location) throw new Error('השרת לא החזיר כתובת להמשך ההעלאה.');
      const url = new URL(location, endpoint).href;
      if (!url.startsWith(endpoint + '/')) throw new Error('כתובת העלאה לא תקינה.');
      saved = {path,url};
      try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* upload still works */ }
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > file.size) throw new Error('מיקום העלאה לא תקין.');
    progress(Math.round(offset / file.size * 100));
    while (offset < file.size) {
      await sb.refresh();
      const end = Math.min(file.size, offset + 6 * 1024 * 1024);
      const r = await fetch(saved.url, { method:'PATCH', headers:{...headers(), 'Content-Type':'application/offset+octet-stream', 'Upload-Offset':String(offset)}, body:file.slice(offset,end) });
      if (!r.ok) throw new Error(`ההעלאה נעצרה (${r.status}). בחרו שוב את אותו קובץ כדי לחדש.`);
      const next = Number(r.headers.get('Upload-Offset'));
      if (next !== end) throw new Error('השרת לא אישר את חלק הקובץ. בחרו שוב את הקובץ לחידוש.');
      offset = next;
      progress(Math.round(offset / file.size * 100));
    }
    try { localStorage.removeItem(key); } catch { /* private mode */ }
    return base + '/storage/v1/object/public/rosh-media/' + saved.path;
  };
})();
