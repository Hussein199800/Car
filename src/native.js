// الجسر إلى الطبقة الأصلية (Kotlin): التخزين المشفّر والمراقبة في الخلفية.
// في المتصفح (للتطوير والوضع التجريبي) نستخدم localStorage بديلاً.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { store } from './data.js';

export const isNative = Capacitor.isNativePlatform();
const SecureStore = isNative ? registerPlugin('SecureStore') : null;
const Monitor = isNative ? registerPlugin('Monitor') : null;
const DeviceTools = isNative ? registerPlugin('DeviceTools') : null;

export const secure = {
  async get(key) {
    if (!isNative) return store.get(key, null);
    const { value } = await SecureStore.get({ key });
    try { return value ? JSON.parse(value) : null; } catch { return null; }
  },
  async set(key, val) {
    if (!isNative) return store.set(key, val);
    await SecureStore.set({ key, value: JSON.stringify(val) });
  },
  async del(key) {
    if (!isNative) return store.del(key);
    await SecureStore.remove({ key });
  },
};

// نقل الجلسة القديمة من التخزين العادي إلى المشفّر مرة واحدة بعد التحديث
export async function migrateSession() {
  if (!isNative) return;
  const old = store.get('session', null);
  if (old) {
    await secure.set('session', old);
    store.del('session');
  }
}

export const monitor = {
  async configure(config, flags) {
    if (!isNative) return;
    await Monitor.configure({ config, flags });
  },
  async takeOver() {
    if (!isNative) return { alerts: [], faults: [], flags: {} };
    return Monitor.takeOver();
  },
};

export const APPS = { wifi: 'wifiapp.volfw.watchpower', ble: 'bleapp.volfw.watchpower' };

// في المتصفح نفتح صفحة المتجر بدل التطبيق، وإعدادات الهاتف غير متاحة
export const deviceTools = {
  async openApp(pkg) {
    if (!isNative) { window.open(`https://play.google.com/store/apps/details?id=${pkg}`, '_blank', 'noopener'); return 'web'; }
    return (await DeviceTools.openApp({ package: pkg })).opened;
  },
  async openWifiSettings() {
    if (!isNative) return false;
    return (await DeviceTools.openWifiSettings()).opened;
  },
  async openBluetoothSettings() {
    if (!isNative) return false;
    return (await DeviceTools.openBluetoothSettings()).opened;
  },
};
