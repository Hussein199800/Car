package com.taqati.solar

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** آخر حالة معروضة في الأداة: من الواجهة وهي مفتوحة، أو من الفحص في الخلفية. */
data class WidgetState(
    val soc: Int?,
    val batW: Int?,
    val loadW: Int?,
    val pvW: Int?,
    val stale: Boolean,
    val at: Long,
) {
    fun toJson(): String = JSONObject()
        .put("soc", soc ?: JSONObject.NULL).put("batW", batW ?: JSONObject.NULL)
        .put("loadW", loadW ?: JSONObject.NULL).put("pvW", pvW ?: JSONObject.NULL)
        .put("stale", stale).put("at", at).toString()

    companion object {
        fun fromJson(s: String?): WidgetState? = try {
            val o = JSONObject(s ?: return null)
            fun int(k: String) = if (o.isNull(k)) null else o.optDouble(k).takeIf { !it.isNaN() }?.toInt()
            WidgetState(int("soc"), int("batW"), int("loadW"), int("pvW"), o.optBoolean("stale"), o.optLong("at"))
        } catch (e: Exception) {
            null
        }
    }
}

/** نصوص الأداة: منطق نقي يُختبر باختبارات JVM. الأرقام دائماً 0-9 كباقي التطبيق. */
object WidgetText {
    fun watts(w: Int?): String = when {
        w == null -> "—"
        kotlin.math.abs(w) >= 1000 -> String.format(Locale.US, "%.1f ك.واط", w / 1000.0)
        else -> "$w واط"
    }

    fun battery(s: WidgetState): String = when {
        s.stale -> "آخر قيمة مسجّلة"
        s.batW == null -> "البطارية"
        s.batW > 10 -> "تشحن ${watts(s.batW)}"
        s.batW < -10 -> "تُفرّغ ${watts(-s.batW)}"
        else -> "مستقرة"
    }

    fun time(s: WidgetState): String =
        (if (s.stale) "غير متصل · " else "") + "آخر قراءة " + SimpleDateFormat("HH:mm", Locale.US).format(Date(s.at))
}

class TaqatiWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        render(ctx, mgr, ids)
    }

    companion object {
        private const val KEY = "widget"

        // عزل اتجاه النسبة حتى لا تظهر «%67» في واجهة عربية
        private val LRI = Char(0x2066)
        private val PDI = Char(0x2069)

        /** يحفظ الحالة ويحدّث كل نسخ الأداة على الشاشة (إن وُجدت) */
        fun push(ctx: Context, s: WidgetState) {
            MonitorStore.prefs(ctx).edit().putString(KEY, s.toJson()).apply()
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, TaqatiWidget::class.java))
            if (ids.isNotEmpty()) render(ctx, mgr, ids)
        }

        private fun render(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
            val s = WidgetState.fromJson(MonitorStore.prefs(ctx).getString(KEY, null))
            val v = RemoteViews(ctx.packageName, R.layout.widget_taqati)
            if (s == null) {
                v.setTextViewText(R.id.w_soc, "طاقتي")
                v.setTextViewText(R.id.w_bat, "افتح التطبيق مرة لتظهر القراءات هنا")
            } else {
                v.setTextViewText(R.id.w_soc, s.soc?.let { "$LRI$it%$PDI" } ?: "—")
                v.setTextViewText(R.id.w_state, if (s.stale) "غير متصل" else "")
                v.setTextViewText(R.id.w_bat, WidgetText.battery(s))
                v.setTextViewText(R.id.w_load, "الحمل ${WidgetText.watts(s.loadW)}")
                v.setTextViewText(R.id.w_pv, "الألواح ${WidgetText.watts(s.pvW)}")
                v.setTextViewText(R.id.w_time, WidgetText.time(s))
            }
            val open = PendingIntent.getActivity(
                ctx, 1, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            v.setOnClickPendingIntent(R.id.w_root, open)
            mgr.updateAppWidget(ids, v)
        }
    }
}
