package com.taqati.solar

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * تقييم القراءة واتخاذ قرار التنبيه — نسخة Kotlin من checkAlerts في main.js.
 * منطق نقي بلا اعتماد على Android حتى يُختبر باختبارات JVM.
 */

data class Snapshot(
    val tsRaw: Long?,
    val soc: Double?,
    val gridV: Double?,
    val gridRatedV: Double?,
    val loadPct: Double?,
    val outW: Double?,
    val batW: Double?,
    val mode: String?,
    val fault: String?,
    val batTemp: Double? = null,
    val invTemp: Double? = null,
)

data class MonitorConfig(
    val sn: String,
    val staleMin: Int = 15,
    val tzOffsetMs: Long = 0,
    val lowSoc: Int = 30,
    val overloadPct: Int = 80,
    val alertGrid: Boolean = true,
    val alertOffline: Boolean = true,
    val alertFull: Boolean = true,
    val notify: Boolean = true,
    val alertTemp: Boolean = true,
    val tempBat: Int = 50,
    val tempInv: Int = 75,
    val invLabel: String = "الإنفرتر",
    val gridLabel: String = "كهرباء الشبكة",
) {
    companion object {
        fun fromJson(o: JSONObject) = MonitorConfig(
            sn = o.optString("sn"),
            staleMin = o.optInt("staleMin", 15),
            tzOffsetMs = o.optLong("tzOffsetMs", 0),
            lowSoc = o.optInt("lowSoc", 30),
            overloadPct = o.optInt("overloadPct", 80),
            alertGrid = o.optBoolean("alertGrid", true),
            alertOffline = o.optBoolean("alertOffline", true),
            alertFull = o.optBoolean("alertFull", true),
            notify = o.optBoolean("notify", true),
            alertTemp = o.optBoolean("alertTemp", true),
            tempBat = o.optInt("tempBat", 50),
            tempInv = o.optInt("tempInv", 75),
            invLabel = o.optString("invLabel", "الإنفرتر"),
            gridLabel = o.optString("gridLabel", "كهرباء الشبكة"),
        )
    }
}

/** نص بصيغة التطبيق: «الرافع» و«الكهرباء الوطنية» تُحوّلان عند العرض حسب اختيار المستخدم. */
data class Event(val title: String, val body: String, val kind: String) {
    fun toJson(at: Long): JSONObject = JSONObject().put("title", title).put("body", body).put("kind", kind).put("at", at)
}

data class Outcome(val alerts: List<Event>, val faults: List<Event>, val flags: JSONObject)

object AlertEvaluator {
    private fun num(v: String?): Double? {
        if (v == null || v.isBlank() || v.trim().all { it == '-' }) return null
        return v.replace(Regex("[^0-9.\\-]"), "").toDoubleOrNull()
    }

    private fun find(points: List<Point>, vararg patterns: Regex): String? {
        for (re in patterns) for (p in points) if (re.containsMatchIn(p.title.trim().lowercase())) return p.value
        return null
    }

    /** "2026-10-28 19:17:29" بتوقيت الهاتف المحلي، كما يفعل parseTs في model.js */
    fun parseTs(s: String?): Long? {
        val m = Regex("(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2})(?::(\\d{2}))?").find(s ?: return null) ?: return null
        val g = m.groupValues
        return Calendar.getInstance().apply {
            clear()
            set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].ifEmpty { "0" }.toInt())
        }.timeInMillis
    }

    fun snapshot(points: List<Point>): Snapshot {
        val batV = num(find(points, Regex("^battery voltage$")))
        val chg = num(find(points, Regex("^battery charging current")))
        val dis = num(find(points, Regex("^battery discharg.* current")))
        val modeRaw = find(points, Regex("^working state$"), Regex("^work mode$"), Regex("^operating mode$"), Regex("^mode$"), Regex("^model$"))
        val fault = find(points, Regex("^inverter fault"), Regex("^fault code"), Regex("^fault$"))
        // الحرارة كما في extract في model.js: نتجاهل الصفر والقيم غير المنطقية
        val temps = points.mapNotNull { p ->
            val t = p.title.trim().lowercase()
            if (!t.contains("temp")) return@mapNotNull null
            num(p.value)?.takeIf { it > 0 && it < 150 }?.let { (t.contains("bat")) to it }
        }
        return Snapshot(
            tsRaw = parseTs(find(points, Regex("^timestamp$"), Regex("^time$"), Regex("^date$"))),
            soc = num(find(points, Regex("^battery capacity"), Regex("^soc$"), Regex("state of charge"))),
            gridV = num(find(points, Regex("^grid voltage"), Regex("^ac input voltage"))),
            gridRatedV = num(find(points, Regex("^grid rating voltage"), Regex("^ac output rating voltage"))),
            loadPct = num(find(points, Regex("^output load percent"), Regex("^load percent"))),
            outW = num(find(points, Regex("^ac output active power"), Regex("^output active power"))),
            batW = if (batV != null && (chg != null || dis != null)) batV * ((chg ?: 0.0) - (dis ?: 0.0)) else null,
            mode = modeRaw?.takeIf { it.contains("mode", ignoreCase = true) },
            fault = fault?.takeUnless { it.isBlank() || it.trim().all { c -> c == '-' } || it.trim().all { c -> c == '0' } },
            batTemp = temps.filter { it.first }.maxOfOrNull { it.second },
            invTemp = temps.filter { !it.first }.maxOfOrNull { it.second },
        )
    }

    fun evaluate(s: Snapshot, cfg: MonitorConfig, flagsIn: JSONObject, now: Long): Outcome {
        val flags = JSONObject(flagsIn.toString())
        val alerts = mutableListOf<Event>()
        val faults = mutableListOf<Event>()
        val ts = s.tsRaw?.plus(cfg.tzOffsetMs)
        val stale = ts != null && now - ts > cfg.staleMin * 60_000L
        fun was(key: String) = flags.opt(key).let { it == true || it == "silent" }

        // في الخلفية لا يوجد «أول قراءة» غامضة: الواجهة سلّمت الحالة الأخيرة قبل الإغلاق
        if (stale && flags.opt("offline") != true) {
            flags.put("offline", true)
            faults += Event("انقطع اتصال الرافع", "لم تصل قراءات جديدة", "offline")
            if (cfg.alertOffline) alerts += Event("الرافع غير متصل", "لم تصل قراءات جديدة منذ ${minutesAgo(now - (ts ?: now))}. قد يكون الرافع مطفأً أو مفصولاً.", "bad")
        } else if (!stale && was("offline")) {
            if (flags.opt("offline") == true) {
                faults += Event("عاد اتصال الرافع", "وصلت قراءة جديدة", "online")
                if (cfg.alertOffline) alerts += Event("عاد اتصال الرافع", "وصلت قراءات جديدة من الجهاز", "ok")
            }
            flags.put("offline", false)
        }
        if (stale) return Outcome(alerts, faults, flags)

        val fault = s.fault ?: s.mode?.takeIf { it.contains("fault", ignoreCase = true) }
        // optString تعيد النص "null" لقيمة JSON الفارغة، فنفحص isNull أولاً
        val prevFault = if (flags.isNull("faultCode")) null else flags.optString("faultCode").ifEmpty { null }
        if (fault != prevFault) {
            if (fault != null) {
                faults += Event("عطل في الإنفرتر", "الرمز/الحالة: $fault", "fault")
                alerts += Event("عطل في الإنفرتر", "أبلغ الجهاز عن عطل: $fault", "bad")
            } else if (prevFault != null) {
                faults += Event("زال العطل", "العطل السابق: $prevFault", "online")
            }
            flags.put("faultCode", fault ?: JSONObject.NULL)
        }

        fun edge(key: String, active: Boolean, onRaise: () -> Unit, onClear: (() -> Unit)? = null) {
            val prev = flags.optBoolean(key, false)
            if (active && !prev) onRaise()
            if (!active && prev) onClear?.invoke()
            flags.put(key, active)
        }

        // هامش رجوع (hysteresis) مطابق لـ main.js: لا يُعاد التسليح إلا بعد ابتعاد واضح عن الحد
        fun hold(key: String, on: Boolean, stillOn: Boolean) = if (flags.opt(key) == true) stillOn else on

        s.soc?.let { soc ->
            edge("lowSoc", hold("lowSoc", soc <= cfg.lowSoc && (s.batW ?: 0.0) <= 0, soc < cfg.lowSoc + 5), {
                alerts += Event("البطارية منخفضة", "نسبة الشحن ${soc.toInt()}% — يُنصح بتقليل الأحمال.", "bad")
            })
            if (cfg.alertFull) edge("full", hold("full", soc >= 100, soc >= 95), { alerts += Event("البطارية ممتلئة", "وصل الشحن إلى 100% — وقت مناسب لتشغيل الأحمال الكبيرة", "ok") })
        }
        s.loadPct?.let { pct ->
            edge("overload", hold("overload", pct >= cfg.overloadPct, pct >= cfg.overloadPct - 10), {
                alerts += Event("حمل زائد", "الحمل وصل إلى ${pct.toInt()}%", "bad")
                faults += Event("حمل زائد", "${pct.toInt()}%", "warn")
            })
        }
        if (cfg.alertTemp) {
            s.batTemp?.let { t ->
                edge("hotBat", hold("hotBat", t >= cfg.tempBat, t > cfg.tempBat - 5), {
                    alerts += Event("حرارة البطارية مرتفعة", "${t.toInt()}° — الحد ${cfg.tempBat}°. خفّف الحمل وتأكد من تهوية مكان البطارية.", "bad")
                    faults += Event("حرارة البطارية مرتفعة", "${t.toInt()}°", "warn")
                })
            }
            s.invTemp?.let { t ->
                edge("hotInv", hold("hotInv", t >= cfg.tempInv, t > cfg.tempInv - 5), {
                    alerts += Event("حرارة الرافع مرتفعة", "${t.toInt()}° — الحد ${cfg.tempInv}°. خفّف الحمل وتأكد أن فتحات التهوية والمراوح تعمل.", "bad")
                    faults += Event("حرارة الرافع مرتفعة", "${t.toInt()}°", "warn")
                })
            }
        }
        if (cfg.alertGrid && s.gridV != null) {
            val gridOn = s.gridV >= 0.4 * (s.gridRatedV ?: 230.0)
            edge("gridOff", !gridOn, {
                alerts += Event("انقطعت الكهرباء الوطنية", "المنظومة تعمل على البطارية${s.soc?.let { " (${it.toInt()}%)" } ?: ""}", "warn")
                faults += Event("انقطاع الكهرباء الوطنية", "جهد الشبكة ${s.gridV.toInt()} فولت", "grid")
            }, {
                alerts += Event("عادت الكهرباء الوطنية", "الجهد ${s.gridV.toInt()} فولت", "ok")
                faults += Event("عودة الكهرباء الوطنية", "جهد الشبكة ${s.gridV.toInt()} فولت", "online")
            })
        }
        return Outcome(alerts, faults, flags)
    }

    /** صيغة العدد العربية كما في countAr في model.js: دقيقة، دقيقتين، 3 دقائق، 11 دقيقة */
    fun countAr(n: Long, forms: List<String>): String = when {
        n == 1L -> forms[0]
        n == 2L -> forms[1]
        n in 3..10 -> "$n ${forms[2]}"
        else -> "$n ${forms[3]}"
    }

    private val MIN = listOf("دقيقة", "دقيقتين", "دقائق", "دقيقة")
    private val HOUR = listOf("ساعة", "ساعتين", "ساعات", "ساعة")
    private val DAY = listOf("يوم", "يومين", "أيام", "يوماً")

    fun minutesAgo(ms: Long): String {
        val m = Math.round(ms / 60_000.0)
        if (m < 60) return countAr(maxOf(m, 1), MIN)
        val h = m / 60
        if (h < 24) return countAr(h, HOUR) + if (m % 60 != 0L) " و" + countAr(m % 60, MIN) else ""
        return countAr(h / 24, DAY)
    }

    /** نص الإشعار بالمصطلحات التي اختارها المستخدم */
    fun localize(text: String, cfg: MonitorConfig): String =
        text.replace("الكهرباء الوطنية", cfg.gridLabel).replace("الرافع", cfg.invLabel).replace("الإنفرتر", cfg.invLabel)

    fun appendCapped(arr: JSONArray, items: List<JSONObject>, cap: Int): JSONArray {
        val out = JSONArray()
        val all = (0 until arr.length()).map { arr.getJSONObject(it) } + items
        all.takeLast(cap).forEach { out.put(it) }
        return out
    }
}
