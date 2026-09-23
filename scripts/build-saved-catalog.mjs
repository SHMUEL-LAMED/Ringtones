/* מרענן את העותק השמור באתר (data/episodes.json) מהקטלוג החי. כשה־Worker איטי או לא
   זמין, הדף מציג את העותק הזה (RoshStore.load) — ובלי הריענון הוא נשאר כמו שנכתב במאגר,
   בלי העטיפות, התיאורים והתיקונים שנעשו מאז בניהול. רץ בכל פריסה ופעם ביום
   (.github/workflows/pages.yml) ומשנה רק את מה שמתפרסם, לא את המאגר. אם השרת לא
   עונה — העותק שבמאגר נשאר כמו שהוא. */
import { writeFileSync } from 'node:fs';
import { fromLive, loadCatalog } from './catalog.mjs';

const catalog = await loadCatalog();
if (!fromLive) {
  console.warn('data/episodes.json: live catalog unavailable, keeping the copy in the repo');
} else {
  const saved = { ...catalog, updated: new Date().toISOString().slice(0, 10) };
  writeFileSync('data/episodes.json', `${JSON.stringify(saved, null, 2)}\n`);
  console.log(`data/episodes.json: ${catalog.episodes.length} episodes from the live catalog`);
}
