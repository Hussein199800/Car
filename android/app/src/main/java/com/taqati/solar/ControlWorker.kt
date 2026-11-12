package com.taqati.solar

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * ينفّذ الجدولة والإدارة الذكية من الهاتف، والتطبيق مفتوح أو مغلق.
 * يُشغَّل: عند موعد الجدولة (منبّه أندرويد)، وكل 15 دقيقة تقريباً (للإدارة الذكية ولتدارك موعد فات)، وعند تشغيل الهاتف.
 * يحتاج إنترنت؛ إن لم يتوفر ينتظر أندرويد عودته ثم يُعاد تقييم الوقت (لا يُنفَّذ موعد انتهت فترته).
 */
class ControlWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        synchronized(LOCK) {
            val p = ControlStore.prefs(ctx)
            val cfgJson = p.getString(ControlStore.CONFIG, null) ?: return Result.success()
            val cfg = CtlConfig.fromJson(JSONObject(cfgJson))
            if (cfg.mode == "manual" || !cfg.valid) return Result.success()
            val session = Session.fromJson(SecureStore.get(ctx, "session")) ?: return Result.success()
            val client = WatchPowerClient(session)
            val dev = cfg.device!!
            val api = object : CtlApi {
                override fun readMode(): String? = ControlStore.match(client.ctrlValue(dev, cfg.fieldId), cfg)
                override fun send(key: String) { client.setCtrl(dev, cfg.fieldId, key) }
                override fun snapshot(): Pair<Snapshot, Long>? {
                    val points = client.lastData(dev)
                    if (points.isEmpty()) return null
                    val snap = AlertEvaluator.snapshot(points)
                    val ts = snap.tsRaw?.plus(cfg.tzOffsetMs) ?: return null
                    return snap to (System.currentTimeMillis() - ts)
                }
            }
            val st = CtlState.fromJson(p.getString(ControlStore.STATE, null))
            val res = try {
                ControlRunner.run(System.currentTimeMillis(), cfg, st, api, clock = System::currentTimeMillis)
            } finally {
                if (client.sessionChanged) SecureStore.put(ctx, "session", client.session.toJson())
            }
            p.edit().putString(ControlStore.STATE, res.state.toJson().toString()).apply()
            if (res.status != "none") {
                val entry = JSONObject().put("at", System.currentTimeMillis()).put("by", cfg.mode)
                    .put("from", ControlEngine.labelOf(res.from, cfg)).put("to", ControlEngine.labelOf(res.to, cfg))
                    .put("status", res.status).put("reason", res.decision.reason).put("error", res.error ?: JSONObject.NULL)
                ControlStore.log(ctx, entry)
                if (cfg.notify) {
                    val title = when (res.status) {
                        "confirmed" -> "تحوّل الإنفرتر إلى ${entry.optString("to")}"
                        "unconfirmed" -> "أُرسل التحويل ولم يتأكد"
                        else -> "تعذّر تحويل الإنفرتر"
                    }
                    val by = if (cfg.mode == "schedule") "الجدولة" else "الإدارة الذكية"
                    MonitorWorker.notify(ctx, title, "$by: ${res.decision.reason}" + (res.error?.let { " · $it" } ?: ""))
                }
            }
            ControlScheduler.armAlarm(ctx, cfg)
        }
        return Result.success()
    }

    companion object {
        private val LOCK = Any()
    }
}

/** إعدادات المحرّك وحالته وسجله (ليست بيانات سرية). */
object ControlStore {
    const val CONFIG = "ctl_config"
    const val STATE = "ctl_state"
    const val LOG = "ctl_log"

    fun prefs(ctx: Context) = ctx.getSharedPreferences("taqati_control", Context.MODE_PRIVATE)

    /** يطابق قيمة الجهاز مع أحد الخيارين بالمفتاح أو بالنص؛ غير ذلك يُعاد كما هو (وضع غير مشمول) */
    fun match(v: String?, c: CtlConfig): String? {
        val s = v?.trim() ?: return null
        if (s.isEmpty() || s.all { it == '-' }) return null
        c.items.entries.firstOrNull { it.key.equals(s, true) || it.value.equals(s, true) }?.let { return it.key }
        return when {
            s.equals(c.gridKey, true) || s.equals(c.gridLabel, true) -> c.gridKey
            s.equals(c.solarKey, true) || s.equals(c.solarLabel, true) -> c.solarKey
            else -> s
        }
    }

    @Synchronized
    fun log(ctx: Context, entry: JSONObject) {
        val p = prefs(ctx)
        val arr = JSONArray(p.getString(LOG, "[]") ?: "[]")
        p.edit().putString(LOG, ControlEngine.appendLog(arr, entry).toString()).apply()
    }
}

object ControlScheduler {
    private const val PERIODIC = "taqati-control"
    private const val NOW = "taqati-control-now"

    /** يطبّق الإعدادات: فحص دوري ومنبّه الموعد التالي، أو إلغاؤهما في التحكم اليدوي */
    fun apply(ctx: Context) {
        val cfg = ControlStore.prefs(ctx).getString(ControlStore.CONFIG, null)?.let { CtlConfig.fromJson(JSONObject(it)) }
        val wm = WorkManager.getInstance(ctx)
        if (cfg == null || cfg.mode == "manual" || !cfg.valid) {
            wm.cancelUniqueWork(PERIODIC)
            cancelAlarm(ctx)
            return
        }
        val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        wm.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<ControlWorker>(15, TimeUnit.MINUTES).setConstraints(net).build())
        armAlarm(ctx, cfg)
    }

    fun runNow(ctx: Context) {
        val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<ControlWorker>().setConstraints(net).build())
    }

    private fun pending(ctx: Context) = PendingIntent.getBroadcast(ctx, 7, Intent(ctx, ControlAlarmReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    fun canExact(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || ctx.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    fun ignoringBattery(ctx: Context): Boolean =
        ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName)

    /** منبّه عند موعد الجدولة التالي: دقيق إن سمح المستخدم، وإلا تقريبي (قد يتأخر دقائق) */
    fun armAlarm(ctx: Context, cfg: CtlConfig) {
        if (cfg.mode != "schedule") { cancelAlarm(ctx); return }
        val next = ControlEngine.nextBoundary(System.currentTimeMillis(), cfg)
        if (next == 0L) { cancelAlarm(ctx); return }
        val at = next + 20_000   // بعد الموعد بثوانٍ
        val am = ctx.getSystemService(AlarmManager::class.java)
        if (canExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx))
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx))
        ControlStore.prefs(ctx).edit().putLong("next_at", at).apply()
    }

    private fun cancelAlarm(ctx: Context) {
        ctx.getSystemService(AlarmManager::class.java).cancel(pending(ctx))
        ControlStore.prefs(ctx).edit().remove("next_at").apply()
    }
}

class ControlAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) = ControlScheduler.runNow(ctx)
}

/** بعد تشغيل الهاتف أو تحديث التطبيق أو تغيّر إذن المنبّهات الدقيقة: نعيد ضبط المنبّه ونتدارك ما فات */
class ControlBootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        // نقبل أحداث النظام هذه فقط، حتى لا يطلب تطبيق آخر تشغيل المحرّك
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED")) return
        ControlScheduler.apply(ctx)
        ControlScheduler.runNow(ctx)
    }
}
