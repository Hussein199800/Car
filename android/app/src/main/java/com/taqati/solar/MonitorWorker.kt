package com.taqati.solar

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * يفحص الرافع كل 15 دقيقة تقريباً والتطبيق مغلق أو في الخلفية، ويرسل الإشعارات.
 * أثناء فتح التطبيق تتولى الواجهة المراقبة كل بضع ثوانٍ، فلا يعمل هذا الفحص حتى لا تتكرر التنبيهات.
 */
class MonitorWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val ctx = applicationContext
        if (MainActivity.inForeground) return Result.success()
        val prefs = MonitorStore.prefs(ctx)
        val cfgJson = prefs.getString(MonitorStore.CONFIG, null) ?: return Result.success()
        val cfgObj = JSONObject(cfgJson)
        if (!cfgObj.optBoolean("enabled", false)) return Result.success()
        val cfg = MonitorConfig.fromJson(cfgObj)
        val dev = cfgObj.optJSONObject("device")?.let {
            Device(it.optString("pn"), it.optString("sn"), it.optString("devcode"), it.optString("devaddr", "1"))
        } ?: return Result.success()
        val session = Session.fromJson(SecureStore.get(ctx, "session")) ?: return Result.success()

        val client = WatchPowerClient(session)
        val points = try {
            client.lastData(dev)
        } catch (e: Exception) {
            // نسجّل تعذّر الاتصال مرة واحدة بعد 3 محاولات فاشلة متتالية، ولا نكرّر المحاولة فوراً حتى لا نستنزف البطارية
            val fails = prefs.getInt(MonitorStore.FAILS, 0) + 1
            prefs.edit().putInt(MonitorStore.FAILS, fails).apply()
            if (fails == 3) MonitorStore.queue(ctx, emptyList(), listOf(Event("تعذّر الاتصال بالخادم", e.message ?: "", "comm")))
            return Result.success()
        } finally {
            if (client.sessionChanged) SecureStore.put(ctx, "session", client.session.toJson())
        }
        prefs.edit().putInt(MonitorStore.FAILS, 0).apply()
        if (points.isEmpty()) return Result.success()

        val flags = JSONObject(prefs.getString(MonitorStore.FLAGS, "{}") ?: "{}")
        val out = AlertEvaluator.evaluate(AlertEvaluator.snapshot(points), cfg, flags, System.currentTimeMillis())
        prefs.edit().putString(MonitorStore.FLAGS, out.flags.toString()).apply()
        MonitorStore.queue(ctx, out.alerts, out.faults)
        if (cfg.notify) out.alerts.forEach { notify(ctx, AlertEvaluator.localize(it.title, cfg), AlertEvaluator.localize(it.body, cfg)) }
        return Result.success()
    }

    companion object {
        private const val WORK = "taqati-monitor"
        const val CHANNEL = "taqati_alerts"

        fun schedule(ctx: Context, enabled: Boolean) {
            val wm = WorkManager.getInstance(ctx)
            if (!enabled) {
                wm.cancelUniqueWork(WORK)
                return
            }
            val req = PeriodicWorkRequestBuilder<MonitorWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, req)
        }

        fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val ch = NotificationChannel(CHANNEL, "تنبيهات المنظومة", NotificationManager.IMPORTANCE_HIGH)
                ch.description = "انقطاع الكهرباء والرافع وانخفاض البطارية والأعطال"
                ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
            }
        }

        fun notify(ctx: Context, title: String, body: String) {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) return
            ensureChannel(ctx)
            val open = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_sun)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            NotificationManagerCompat.from(ctx).notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), n)
        }
    }
}

/** حالة المراقبة المشتركة بين الواجهة والفحص في الخلفية (ليست بيانات سرية). */
object MonitorStore {
    const val CONFIG = "config"
    const val FLAGS = "flags"
    const val EVENTS = "events"
    const val FAILS = "fails"

    fun prefs(ctx: Context) = ctx.getSharedPreferences("taqati_monitor", Context.MODE_PRIVATE)

    @Synchronized
    fun queue(ctx: Context, alerts: List<Event>, faults: List<Event>) {
        if (alerts.isEmpty() && faults.isEmpty()) return
        val p = prefs(ctx)
        val now = System.currentTimeMillis()
        val ev = JSONObject(p.getString(EVENTS, "{}") ?: "{}")
        ev.put("alerts", AlertEvaluator.appendCapped(ev.optJSONArray("alerts") ?: JSONArray(), alerts.map { it.toJson(now) }, 100))
        ev.put("faults", AlertEvaluator.appendCapped(ev.optJSONArray("faults") ?: JSONArray(), faults.map { it.toJson(now) }, 100))
        p.edit().putString(EVENTS, ev.toString()).apply()
    }
}
