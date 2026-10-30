// عميل خوادم WatchPower (منصة DessMonitor / ShineMonitor)
// التوقيع: sha1(salt + sha1(password) + actionString) عند الدخول،
// ثم sha1(salt + secret + token + actionString) لبقية الطلبات.

const COMPANY_KEY = 'bnrl_frRFjEz8Mkn';

export const PROFILES = {
  dess: { base: 'https://api.dessmonitor.com/public/', authAction: 'authSource', source: '1' },
  shine: { base: 'https://ios.shinemonitor.com/public/', authAction: 'auth', source: '0' },
};

const APP = { client: 'web', id: 'taqati-solar', version: '1.0.0' };

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export async function sha1(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// مطابق لـ quote_plus في بايثون حتى يطابق التوقيع ما يُرسل حرفياً
export function quotePlus(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

const ERROR_AR = {
  ERR_PASSWORD_VERIF_FAIL: 'اسم المستخدم أو كلمة المرور غير صحيحة',
  ERR_USR_NOT_FOUND: 'المستخدم غير موجود',
  ERR_NO_RECORD: 'لا توجد بيانات',
  ERR_NOT_FOUND_COMPANY_KEY: 'مفتاح الشركة غير معروف',
  ERR_TOKEN_EXPIRE: 'انتهت الجلسة',
  ERR_NO_AUTH: 'لا توجد صلاحية',
  ERR_DEV_OFFLINE: 'الجهاز غير متصل',
  ERR_UNSUPPORTED: 'هذا الإعداد لا يدعم قراءة قيمته الحالية',
  ERR_SYSTEM_EXCEPTION: 'لم يستطع خادم WatchPower قراءة هذه القيمة من الإنفرتر الآن',
  ERR_DEVICE_RESPONSE_TIMEOUT: 'الإنفرتر لم يرد في الوقت المحدد، حاول بعد قليل',
  ERR_FORMAT_ERROR: 'صيغة القيمة غير مقبولة',
  ERR_NOT_FOUND_DEVICE: 'الجهاز غير موجود في الحساب',
};

// الخادم يضيف أحياناً تفاصيل بعد الرمز مثل «ERR_UNSUPPORTED(cmd is null!!)»
export function errorAr(desc, code) {
  const key = String(desc || '').match(/^ERR_[A-Z_]+/)?.[0];
  if (ERROR_AR[desc] || (key && ERROR_AR[key])) return ERROR_AR[desc] || ERROR_AR[key];
  // رمز غير معروف: رسالة عربية مع الرمز للمساعدة في التشخيص بدل عرض الرمز الإنجليزي وحده
  if (key) return `رفض خادم WatchPower الطلب (${desc})`;
  return desc || `خطأ من الخادم (${code})`;
}

export class WatchPowerApi {
  constructor(session = {}) {
    this.profile = session.profile || 'dess';
    this.usr = session.usr || '';
    this.pwdHash = session.pwdHash || '';
    this.token = session.token || '';
    this.secret = session.secret || '';
    this.expire = session.expire || 0;
  }

  get session() {
    const { profile, usr, pwdHash, token, secret, expire } = this;
    return { profile, usr, pwdHash, token, secret, expire };
  }

  async login(usr, password) {
    return this.loginWithHash(usr, await sha1(password));
  }

  // الدخول ببصمة كلمة المرور (من النسخة الاحتياطية) دون معرفة كلمة المرور نفسها
  async loginWithHash(usr, pwdHash, preferred = 'dess') {
    this.usr = usr.trim();
    this.pwdHash = pwdHash;
    let lastErr;
    // بعض الحسابات تعمل على خادم DessMonitor وأخرى على ShineMonitor
    for (const profile of preferred === 'shine' ? ['shine', 'dess'] : ['dess', 'shine']) {
      this.profile = profile;
      try {
        await this.authenticate();
        return this.session;
      } catch (err) {
        lastErr = err;
        if (err.code === undefined) throw err; // خطأ شبكة: لا داعي لتجربة الخادم الآخر
      }
    }
    throw lastErr;
  }

  // عدة طلبات متزامنة (التحديث والتقارير والإعدادات) قد تكتشف انتهاء الجلسة معاً؛
  // نجعلها تنتظر دخولاً واحداً بدل أن يُبطل كل دخول رمز الآخر
  authenticate() {
    if (!this.authPromise) this.authPromise = this.doAuthenticate().finally(() => { this.authPromise = null; });
    return this.authPromise;
  }

  async doAuthenticate() {
    this.token = '';
    this.secret = '';
    const p = PROFILES[this.profile];
    const res = await this.request(p.authAction, {
      usr: this.usr,
      'company-key': COMPANY_KEY,
      source: p.source,
      _app_client_: APP.client,
      _app_id_: APP.id,
      _app_version_: APP.version,
    }, false);
    const dat = res.dat || {};
    if (!dat.token || !dat.secret) throw new ApiError('استجابة دخول غير صالحة', -1);
    this.token = dat.token;
    this.secret = dat.secret;
    this.expire = Date.now() + (Number(dat.expire) || 3600) * 1000;
  }

  async request(action, params = {}, retry = true) {
    const p = PROFILES[this.profile];
    const isAuth = action === p.authAction;
    if (!isAuth && (!this.token || Date.now() > this.expire - 120000)) await this.authenticate();

    const salt = String(Date.now());
    let actionStr = `&action=${action}`;
    for (const [k, v] of Object.entries(params)) actionStr += `&${k}=${quotePlus(v)}`;
    const sign = isAuth
      ? await sha1(salt + this.pwdHash + actionStr)
      : await sha1(salt + this.secret + this.token + actionStr);
    let url = `${p.base}?sign=${sign}&salt=${salt}`;
    if (!isAuth) url += `&token=${this.token}`;
    url += actionStr;

    let data;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      data = await resp.json();
    } catch (e) {
      throw new ApiError('تعذّر الاتصال بالخادم، تحقق من الإنترنت');
    } finally {
      clearTimeout(timer);
    }

    if (data.err && data.err !== 0) {
      // انتهاء الجلسة أو رفض التوقيع: نعيد الدخول مرة واحدة
      const sessionErr = /TOKEN|AUTH|SIGN|VERIF/.test(data.desc || '');
      if (!isAuth && retry && sessionErr) {
        await this.authenticate();
        return this.request(action, params, false);
      }
      const err = new ApiError(errorAr(data.desc, data.err), data.err);
      err.desc = data.desc || '';
      throw err;
    }
    return data;
  }

  // ---------- الأجهزة ----------
  async listDevices() {
    const devices = [];
    const seen = new Set();
    const add = (d) => {
      if (!d || !d.sn || seen.has(d.sn) || !d.pn) return;
      seen.add(d.sn);
      devices.push({
        pn: d.pn, sn: d.sn, devcode: d.devcode, devaddr: d.devaddr ?? 1,
        alias: d.devalias || d.alias || d.sn, status: d.status ?? 0, pid: d.pid,
      });
    };

    let plants = [];
    try {
      const r = await this.request('queryPlants', { pagesize: 50 });
      plants = r.dat?.plant || [];
    } catch (e) {
      if (e.code === undefined) throw e;
    }

    for (const plant of plants) {
      try {
        const r = await this.request('webQueryDeviceEs', { pid: plant.pid, page: 0, pagesize: 50 });
        (r.dat?.device || []).forEach(add);
      } catch (e) { /* نجرب طريقة المجمّعات */ }
      if (devices.length) continue;
      try {
        const r = await this.request('webQueryCollectorsEs', { pid: plant.pid, page: 0, pagesize: 50 });
        for (const c of r.dat?.collector || []) {
          const d = await this.request('queryCollectorDevices', { pn: c.pn });
          (d.dat?.dev || []).forEach((x) => add({ ...x, pn: x.pn || c.pn, pid: plant.pid }));
        }
      } catch (e) { /* تجاهل */ }
    }

    if (!devices.length) {
      try {
        const r = await this.request('webQueryDeviceEs', { page: 0, pagesize: 50 });
        (r.dat?.device || []).forEach(add);
      } catch (e) { /* تجاهل */ }
    }
    return devices;
  }

  devParams(dev) {
    return { pn: dev.pn, devcode: dev.devcode, devaddr: dev.devaddr, sn: dev.sn };
  }

  // آخر قراءة: مصفوفة من {title, val, unit}
  async lastData(dev) {
    const r = await this.request('queryDeviceLastData', { ...this.devParams(dev), i18n: 'en_US' });
    const dat = r.dat;
    if (Array.isArray(dat)) return dat;
    if (Array.isArray(dat?.data)) return dat.data;
    return [];
  }

  // سجل يوم كامل: يعيد {titles, rows}
  async dayHistory(dev, date) {
    const titles = [];
    const rows = [];
    for (let page = 0; page < 30; page++) {
      let r;
      try {
        r = await this.request('queryDeviceDataOneDayPaging', {
          ...this.devParams(dev), date, page, pagesize: 200, i18n: 'en_US',
        });
      } catch (e) {
        if (e.code === 12 || /NO_RECORD/.test(e.message)) break;
        throw e;
      }
      const dat = r.dat || {};
      if (!titles.length) (dat.title || []).forEach((t) => titles.push(t.title));
      const batch = dat.row || [];
      batch.forEach((row) => rows.push(row.field || []));
      if (!batch.length || rows.length >= (dat.total || 0)) break;
    }
    return { titles, rows };
  }

  // ---------- الإعدادات ----------
  async ctrlFields(dev) {
    const p = PROFILES[this.profile];
    const r = await this.request('queryDeviceCtrlField', { ...this.devParams(dev), i18n: 'en_US', source: p.source });
    return r.dat?.field || [];
  }

  async ctrlValue(dev, id) {
    const p = PROFILES[this.profile];
    const r = await this.request('queryDeviceCtrlValue', { ...this.devParams(dev), id, i18n: 'en_US', source: p.source });
    return r.dat || {};
  }

  // القيم الحالية لكل الإعدادات دفعة واحدة — مصدر احتياطي عندما تتعذّر قراءة إعداد بمفرده
  async parameters(dev) {
    const p = PROFILES[this.profile];
    const r = await this.request('queryDeviceParsEs', { ...this.devParams(dev), i18n: 'en_US', source: p.source });
    return r.dat?.parameter || [];
  }

  async setCtrl(dev, id, val) {
    const p = PROFILES[this.profile];
    return this.request('ctrlDevice', { ...this.devParams(dev), id, val, i18n: 'en_US', source: p.source });
  }
}
