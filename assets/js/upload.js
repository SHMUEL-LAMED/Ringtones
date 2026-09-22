/* העלאה ישירה ל-R2 של אתר הסקר; הרשאת מנהל נבדקת ב-Worker. */
(function () {
  'use strict';
  window.RoshUpload = async function (file, episodeId, kind, progress) {
    const cf = window.RoshStore.sb;
    if (!await cf.isAdmin()) throw new Error('יש להתחבר עם חשבון מנהל כדי להעלות קבצים.');
    const types = kind === 'audio'
      ? { mp3:'audio/mpeg', m4a:'audio/mp4', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/aac' }
      : { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp' };
    const ext = file.name.split('.').pop().toLowerCase();
    const contentType = types[ext];
    if (!contentType) throw new Error('סוג הקובץ אינו נתמך.');
    if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('אפשר להעלות עד 50MB לקובץ. לקובץ גדול יותר הדביקו קישור שיתוף מ־Google Drive.');
    const url = cf.base(`/api/program/upload?episode=${encodeURIComponent(episodeId)}&kind=${kind === 'cover' ? 'cover' : 'audio'}`);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', `Bearer ${cf.session.token}`);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
      xhr.onerror = () => reject(new Error('החיבור נקטע. בחרו שוב את הקובץ כדי לנסות מחדש.'));
      xhr.onload = () => {
        let body = {}; try { body = JSON.parse(xhr.responseText); } catch { /* server error */ }
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(body.error || `ההעלאה נכשלה (${xhr.status}).`));
        progress(100); resolve(body.url);
      };
      progress(0); xhr.send(file);
    });
  };
})();
