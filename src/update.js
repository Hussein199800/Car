// التحقق من التحديثات: آخر إصدار منشور في صفحة إصدارات GitHub للمستودع.
// التثبيت نفسه يتم في الطبقة الأصلية (Updater) بعد التحقق من الحزمة والتوقيع.
export const REPO = 'Hussein199800/Car';
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
export const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;

export function parseVer(s) {
  const m = String(s || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

export function isNewer(latest, current) {
  const a = parseVer(latest), b = parseVer(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// يعيد null إذا لم يُنشر أي إصدار بعد
export async function fetchLatest(fetchFn = fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let r;
  try {
    r = await fetchFn(LATEST, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal });
  } catch {
    throw new Error('تعذّر الاتصال بخادم التحديثات، تحقق من الإنترنت');
  } finally {
    clearTimeout(timer);
  }
  if (r.status === 404) return null;
  if (r.status === 403 || r.status === 429) throw new Error('خادم التحديثات مشغول، حاول بعد قليل');
  if (!r.ok) throw new Error('تعذّر التحقق من التحديثات');
  const rel = await r.json();
  const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name) && !/debug/i.test(a.name) && String(a.browser_download_url || '').startsWith(DOWNLOAD_PREFIX));
  const version = parseVer(rel.tag_name)?.join('.');
  if (!version || !apk) return null;
  return { version, notes: String(rel.body || '').slice(0, 4000), url: apk.browser_download_url, size: apk.size || 0, at: rel.published_at || null };
}
