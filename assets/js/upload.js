/* העלאה ישירה ל-R2 של אתר הסקר; הרשאת מנהל נבדקת ב-Worker.
   קובץ קטן עולה בבקשה אחת; קובץ גדול (הקלטה של שעה וחצי, 70–150MB) עולה
   בחלקים של 20MB, כך שאין מגבלת גודל מעשית, וחלק שנכשל מנוסה שוב. */
(function () {
  'use strict';
  const SMALL = 40 * 1024 * 1024;
  const MAX = { audio: 1024 * 1024 * 1024, cover: 15 * 1024 * 1024 };

  function types(kind) {
    return kind === 'audio'
      ? { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac' }
      : { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  }

  /** בקשת XHR אחת עם דיווח התקדמות */
  function send(method, url, token, body, contentType, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (contentType) xhr.setRequestHeader('Content-Type', contentType);
      if (onProgress) xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded); };
      xhr.onerror = () => reject(new Error('החיבור נקטע.'));
      xhr.onload = () => {
        let json = {}; try { json = JSON.parse(xhr.responseText); } catch { /* server error */ }
        if (xhr.status < 200 || xhr.status >= 300) return reject(Object.assign(new Error(json.error || `ההעלאה נכשלה (${xhr.status}).`), { status: xhr.status }));
        resolve(json);
      };
      xhr.send(body);
    });
  }

  window.RoshUpload = async function (file, episodeId, kind, progress = () => {}) {
    const cf = window.RoshStore.sb;
    if (!await cf.isAdmin()) throw new Error('יש להתחבר עם חשבון מנהל כדי להעלות קבצים.');
    kind = kind === 'cover' ? 'cover' : 'audio';
    const ext = file.name.split('.').pop().toLowerCase();
    const contentType = types(kind)[ext] || (file.type && Object.values(types(kind)).includes(file.type) ? file.type : '');
    if (!contentType) throw new Error('סוג הקובץ אינו נתמך.');
    if (!file.size) throw new Error('הקובץ ריק.');
    if (file.size > MAX[kind]) throw new Error(kind === 'audio' ? 'אפשר להעלות הקלטה של עד 1GB.' : 'אפשר להעלות תמונה של עד 15MB.');
    const token = cf.session.token;
    const q = `episode=${encodeURIComponent(episodeId)}&kind=${kind}`;
    progress(0);

    if (file.size <= SMALL) {
      const r = await send('POST', cf.base(`/api/program/upload?${q}`), token, file, contentType, (n) => progress(Math.round(n / file.size * 100)));
      progress(100);
      return r.url;
    }

    // העלאה בחלקים
    const start = await cf.call(`/api/program/upload/start?${q}`, { method: 'POST', body: { contentType, size: file.size, name: file.name } });
    const size = start.partSize || 20 * 1024 * 1024;
    const count = Math.ceil(file.size / size);
    const parts = [];
    let done = 0;
    try {
      for (let i = 0; i < count; i++) {
        const chunk = file.slice(i * size, Math.min(file.size, (i + 1) * size));
        const url = cf.base(`/api/program/upload/part?key=${encodeURIComponent(start.key)}&uploadId=${encodeURIComponent(start.uploadId)}&part=${i + 1}`);
        let r, attempt = 0;
        for (;;) {
          try { r = await send('PUT', url, token, chunk, 'application/octet-stream', (n) => progress(Math.min(99, Math.round((done + n) / file.size * 100)))); break; }
          catch (err) { if (++attempt >= 3 || err.status === 403) throw err; await new Promise((res) => setTimeout(res, 1500 * attempt)); }
        }
        parts.push({ part: i + 1, etag: r.etag });
        done += chunk.size;
        progress(Math.min(99, Math.round(done / file.size * 100)));
      }
      const r = await cf.call('/api/program/upload/complete', { method: 'POST', body: { key: start.key, uploadId: start.uploadId, parts } });
      progress(100);
      return r.url;
    } catch (err) {
      cf.call('/api/program/upload/abort', { method: 'POST', body: { key: start.key, uploadId: start.uploadId } }).catch(() => {});
      throw new Error(`${err.message} בחרו שוב את הקובץ כדי לנסות מחדש.`);
    }
  };
})();
