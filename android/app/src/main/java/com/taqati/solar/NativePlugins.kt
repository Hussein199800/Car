package com.taqati.solar

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/** واجهة JavaScript للتخزين المشفّر. */
@CapacitorPlugin(name = "SecureStore")
class SecureStorePlugin : Plugin() {
    @PluginMethod
    fun get(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key مطلوب")
        call.resolve(JSObject().put("value", SecureStore.get(context, key)))
    }

    @PluginMethod
    fun set(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key مطلوب")
        SecureStore.put(context, key, call.getString("value"))
        call.resolve()
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key مطلوب")
        SecureStore.remove(context, key)
        call.resolve()
    }
}

/** تسليم المراقبة بين الواجهة (التطبيق مفتوح) والفحص في الخلفية (التطبيق مغلق). */
@CapacitorPlugin(name = "Monitor")
class MonitorPlugin : Plugin() {
    /** يحفظ الإعدادات وحالة التنبيهات الحالية ويجدول الفحص الدوري أو يلغيه. */
    @PluginMethod
    fun configure(call: PluginCall) {
        val config = call.getObject("config") ?: return call.reject("config مطلوب")
        val p = MonitorStore.prefs(context).edit().putString(MonitorStore.CONFIG, config.toString())
        call.getObject("flags")?.let { p.putString(MonitorStore.FLAGS, it.toString()) }
        p.apply()
        MonitorWorker.ensureChannel(context)
        MonitorWorker.schedule(context, config.optBoolean("enabled", false))
        call.resolve()
    }

    /** تستلم الواجهة ما حدث في الخلفية: التنبيهات والأعطال الجديدة وحالة التنبيهات الأخيرة. */
    @PluginMethod
    fun takeOver(call: PluginCall) {
        val p = MonitorStore.prefs(context)
        val events = synchronized(MonitorStore) {
            val ev = p.getString(MonitorStore.EVENTS, "{}") ?: "{}"
            p.edit().remove(MonitorStore.EVENTS).apply()
            JSONObject(ev)
        }
        val res = JSObject()
        res.put("alerts", events.optJSONArray("alerts") ?: org.json.JSONArray())
        res.put("faults", events.optJSONArray("faults") ?: org.json.JSONArray())
        res.put("flags", JSONObject(p.getString(MonitorStore.FLAGS, "{}") ?: "{}"))
        call.resolve(res)
    }
}

/** فتح إعدادات الهاتف والتطبيقات الرسمية لخطوات إعداد وحدة الواي فاي. */
@CapacitorPlugin(name = "DeviceTools")
class DeviceToolsPlugin : Plugin() {
    private fun start(intent: android.content.Intent): Boolean = try {
        activity.startActivity(intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: android.content.ActivityNotFoundException) {
        false
    }

    @PluginMethod
    fun openWifiSettings(call: PluginCall) {
        call.resolve(JSObject().put("opened", start(android.content.Intent(android.provider.Settings.ACTION_WIFI_SETTINGS))))
    }

    @PluginMethod
    fun openBluetoothSettings(call: PluginCall) {
        call.resolve(JSObject().put("opened", start(android.content.Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS))))
    }

    /** يفتح التطبيق إن كان مثبتاً، وإلا صفحته في المتجر. لا نقبل إلا تطبيقات WatchPower المعروفة. */
    @PluginMethod
    fun openApp(call: PluginCall) {
        val pkg = call.getString("package") ?: return call.reject("package مطلوب")
        if (pkg !in ALLOWED) return call.reject("تطبيق غير مسموح")
        context.packageManager.getLaunchIntentForPackage(pkg)?.let {
            if (start(it)) return call.resolve(JSObject().put("opened", "app"))
        }
        val market = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("market://details?id=$pkg"))
        if (start(market)) return call.resolve(JSObject().put("opened", "store"))
        val web = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://play.google.com/store/apps/details?id=$pkg"))
        call.resolve(JSObject().put("opened", if (start(web)) "web" else "none"))
    }

    companion object {
        val ALLOWED = setOf("wifiapp.volfw.watchpower", "bleapp.volfw.watchpower")
    }
}
