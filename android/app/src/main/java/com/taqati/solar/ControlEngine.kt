package com.taqati.solar

import org.json.JSONArray
import org.json.JSONObject

/**
 * محرّك التحكم بأولوية مصدر الخرج: الجدولة الزمنية والإدارة الذكية.
 * منطق نقي بلا اعتماد على Android حتى يُختبر باختبارات JVM.
 *
 * قواعد ثابتة:
 * - لا يُرسل أمر إلا لإعداد أولوية الخرج المحدد، وبأحد الخيارين اللذين اختارهما المستخدم.
 * - لا يُرسل أمر إذا تعذّرت قراءة الوضع الحالي أو كان غير معروف.
 * - لا يُعدّ التحويل ناجحاً حتى يعيد الجهاز الوضع المطلوب.
 * - الجدولة تنفّذ الأوقات فقط؛ الإدارة الذكية تقرر من القراءة الحية. نمط واحد فعّال في كل وقت.
 */

/**
 * قاعدة جدولة: من startMin إلى endMin (دقائق من منتصف الليل، وقد تعبر منتصف الليل) يكون الجهاز على key.
 * تتكرر في أيام الأسبوع days (0 = الأحد … 6 = السبت)، أو تُطبَّق مرة واحدة في تاريخ date (YYYY-MM-DD).
 */
data class Slot(val startMin: Int, val endMin: Int, val key: String, val days: Set<Int> = (0..6).toSet(), val date: String? = null)

data class CtlConfig(
    val mode: String,                 // manual | schedule | smart
    val fieldId: String,
    val gridKey: String, val gridLabel: String,     // للإدارة الذكية: الوضع الذي تغذّي فيه الشبكة البيت (مثل USB)
    val solarKey: String, val solarLabel: String,   // وللعودة: الألواح ثم البطارية (مثل SBU)
    val slots: List<Slot> = emptyList(),
    val defaultKey: String = solarKey,              // الوضع خارج كل القواعد
    val items: Map<String, String> = emptyMap(),    // كل أوضاع الجهاز: المفتاح ← الاسم
    val utcOffsetMin: Int = 180,      // سوريا: UTC+3 طوال السنة
    val low: Int = 45,                // الإدارة الذكية: التحويل للشبكة عند هذه النسبة أو أقل
    val target: Int = 65,             // والعودة عند بلوغ هذه النسبة
    val gapMin: Int = 30,             // أقل مدة بين تحويلين
    val pvMarginW: Int = 100,         // فائض الألواح فوق الحمل الذي يُعدّ تغطية كاملة
    val staleMin: Int = 15,
    val tzOffsetMs: Long = 0,
    val notify: Boolean = true,
    val device: Device? = null,
) {
    companion object {
        fun fromJson(o: JSONObject): CtlConfig = CtlConfig(
            mode = o.optString("mode", "manual"),
            fieldId = o.optString("fieldId"),
            gridKey = o.optString("gridKey"), gridLabel = o.optString("gridLabel"),
            solarKey = o.optString("solarKey"), solarLabel = o.optString("solarLabel"),
            slots = o.optJSONArray("slots")?.let { a ->
                (0 until a.length()).mapNotNull { i ->
                    val x = a.optJSONObject(i) ?: return@mapNotNull null
                    val d = x.optJSONArray("days")
                    Slot(x.optInt("startMin"), x.optInt("endMin"), x.optString("key"),
                        if (d == null) (0..6).toSet() else (0 until d.length()).map { d.optInt(it) }.toSet(),
                        x.optString("date").takeIf { it.length == 10 })
                }
            } ?: emptyList(),
            defaultKey = o.optString("defaultKey").ifEmpty { o.optString("solarKey") },
            items = o.optJSONObject("items")?.let { m -> m.keys().asSequence().associateWith { m.optString(it) } } ?: emptyMap(),
            utcOffsetMin = o.optInt("utcOffsetMin", 180),
            low = o.optInt("low", 45), target = o.optInt("target", 65), gapMin = o.optInt("gapMin", 30),
            pvMarginW = o.optInt("pvMarginW", 100),
            staleMin = o.optInt("staleMin", 15), tzOffsetMs = o.optLong("tzOffsetMs", 0),
            notify = o.optBoolean("notify", true),
            device = o.optJSONObject("device")?.let { Device(it.optString("pn"), it.optString("sn"), it.optString("devcode"), it.optString("devaddr", "1")) },
        )
    }

    val valid get() = fieldId.isNotEmpty() && device != null && when (mode) {
        "smart" -> gridKey.isNotEmpty() && solarKey.isNotEmpty() && gridKey != solarKey
        "schedule" -> slots.isNotEmpty() && defaultKey.isNotEmpty()
        else -> true
    }

    /** المفاتيح التي يعرفها المحرّك: أي وضع خارجها يُعدّ «غير مشمول» فلا يُغيَّر */
    val knownKeys get() = items.keys + setOf(gridKey, solarKey, defaultKey) + slots.map { it.key }
}

/** حالة المحرّك المحفوظة بين التشغيلات. */
data class CtlState(
    val handledBoundary: Long = 0,    // موعد الجدولة الذي عولج (نُفّذ أو تُرك عمداً)
    val attempts: Int = 0,            // محاولات فاشلة لهذا الموعد
    val lastSwitchAt: Long = 0,       // آخر تحويل أرسله المحرّك
    val pauseUntil: Long = 0,         // تدخّل يدوي يوقف الإدارة الذكية مؤقتاً
    val coverRuns: Int = 0,           // تشغيلات متتالية تغطي فيها الألواح الحمل
    val lastCheckAt: Long = 0,
    val lastNote: String = "",
) {
    fun toJson(): JSONObject = JSONObject().put("handledBoundary", handledBoundary).put("attempts", attempts)
        .put("lastSwitchAt", lastSwitchAt).put("pauseUntil", pauseUntil).put("coverRuns", coverRuns)
        .put("lastCheckAt", lastCheckAt).put("lastNote", lastNote)

    companion object {
        fun fromJson(s: String?): CtlState = try {
            val o = JSONObject(s ?: "{}")
            CtlState(o.optLong("handledBoundary"), o.optInt("attempts"), o.optLong("lastSwitchAt"), o.optLong("pauseUntil"),
                o.optInt("coverRuns"), o.optLong("lastCheckAt"), o.optString("lastNote"))
        } catch (e: Exception) {
            CtlState()
        }
    }
}

/** قرار المحرّك: إرسال وضع أو لا شيء، مع السبب بالعربية. */
data class Decision(val key: String?, val reason: String, val boundary: Long = 0)

object ControlEngine {
    const val MAX_ATTEMPTS = 3
    const val MANUAL_PAUSE_MS = 2 * 3_600_000L
    private const val DAY = 86_400_000L

    // ---------- الوقت بتوقيت المنطقة المختارة (إزاحة ثابتة، بلا اعتماد على توقيت الهاتف أو الخادم) ----------
    fun localMin(now: Long, offsetMin: Int): Int = (Math.floorMod(now / 60_000 + offsetMin, 1440L)).toInt()

    fun inWindow(min: Int, start: Int, end: Int): Boolean =
        if (start < end) min in start until end else min >= start || min < end   // نافذة تعبر منتصف الليل

    /** رقم اليوم المحلي منذ 1970-01-01 */
    fun localDay(now: Long, offsetMin: Int): Long = Math.floorDiv(now + offsetMin * 60_000L, DAY)

    /** يوم الأسبوع المحلي: 0 = الأحد … 6 = السبت (1970-01-01 كان خميساً) */
    fun weekday(day: Long): Int = Math.floorMod(day + 4, 7L).toInt()

    fun dateOf(day: Long): String {
        // تحويل رقم اليوم إلى تاريخ ميلادي (خوارزمية civil_from_days)
        val z = day + 719468
        val era = Math.floorDiv(z, 146097L)
        val doe = z - era * 146097
        val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val d = doy - (153 * mp + 2) / 5 + 1
        val m = if (mp < 10) mp + 3 else mp - 9
        val y = yoe + era * 400 + if (m <= 2) 1 else 0
        return "%04d-%02d-%02d".format(y, m, d)
    }

    /** هل تبدأ القاعدة في هذا اليوم المحلي؟ */
    private fun startsOn(s: Slot, day: Long): Boolean = if (s.date != null) s.date == dateOf(day) else weekday(day) in s.days

    /** القاعدة الفعّالة الآن (الأولى في الترتيب إن تداخلت قاعدتان)، أو null خارج كل القواعد */
    fun activeSlot(now: Long, c: CtlConfig): Slot? {
        val day = localDay(now, c.utcOffsetMin)
        val m = localMin(now, c.utcOffsetMin)
        return c.slots.firstOrNull { s ->
            if (s.startMin == s.endMin) false
            else if (s.startMin < s.endMin) startsOn(s, day) && m >= s.startMin && m < s.endMin
            else (startsOn(s, day) && m >= s.startMin) || (startsOn(s, day - 1) && m < s.endMin)
        }
    }

    /** كل مواعيد البداية والنهاية حول now (أسبوع قبله وأسبوع بعده) */
    private fun boundaries(now: Long, c: CtlConfig): List<Long> {
        val d0 = localDay(now, c.utcOffsetMin)
        val off = c.utcOffsetMin * 60_000L
        val out = ArrayList<Long>()
        for (k in -8..8) {
            val day = d0 + k
            val base = day * DAY - off
            for (s in c.slots) {
                if (s.startMin == s.endMin || !startsOn(s, day)) continue
                out += base + s.startMin * 60_000L
                out += base + (if (s.endMin > s.startMin) s.endMin else s.endMin + 1440) * 60_000L
            }
        }
        return out
    }

    /** آخر موعد حلّ قبل now أو عنده (0 إن لم توجد قواعد) */
    fun lastBoundary(now: Long, c: CtlConfig): Long = boundaries(now, c).filter { it <= now }.maxOrNull() ?: 0

    /** الموعد التالي بعد now (0 إن لم توجد قواعد) */
    fun nextBoundary(now: Long, c: CtlConfig): Long = boundaries(now, c).filter { it > now }.minOrNull() ?: 0

    fun desiredKey(now: Long, c: CtlConfig): String = activeSlot(now, c)?.key ?: c.defaultKey

    fun labelOf(key: String?, c: CtlConfig): String = when (key) {
        null -> "غير مقروء"
        in c.items -> c.items.getValue(key)
        c.gridKey -> c.gridLabel
        c.solarKey -> c.solarLabel
        else -> key
    }

    /**
     * الجدولة: الوضع المطلوب الآن حسب الوقت. يُنفَّذ مرة لكل موعد؛ إن فات الموعد (هاتف مطفأ أو بلا إنترنت)
     * يُنفَّذ عند أول تشغيل ما دمنا داخل الفترة نفسها، ولا يُنفَّذ موعد انتهت فترته.
     * إن غيّر المستخدم الوضع يدوياً بعد تنفيذ الموعد، يُحترم اختياره حتى الموعد التالي.
     */
    fun decideSchedule(now: Long, cur: String?, st: CtlState, c: CtlConfig): Decision {
        if (c.slots.isEmpty()) return Decision(null, "لا توجد قواعد في الجدول")
        val b = lastBoundary(now, c)
        val next = nextBoundary(now, c)
        if (st.handledBoundary == b) return Decision(null, "تم التعامل مع موعد ${hhmm(b, c)}" + if (next > 0) "؛ الموعد التالي ${hhmm(next, c)}" else "", b)
        val want = desiredKey(now, c)
        if (cur == null) return Decision(null, "تعذّرت قراءة الوضع الحالي، فلم يُرسل شيء", b)
        if (cur == want) return Decision(null, "الوضع ${labelOf(cur, c)} مطابق للجدول", b)
        if (cur !in c.knownKeys) return Decision(null, "الجهاز على وضع غير معروف للتطبيق ($cur)، فلم يُغيَّر", b)
        val late = if (b > 0) (now - b) / 60_000 else 0
        val why = if (activeSlot(now, c) != null) "قاعدة ${hhmm(b, c)}" else "انتهاء القاعدة ${hhmm(b, c)}"
        return Decision(want, why + if (late >= 5) " (متأخر $late دقيقة)" else "", b)
    }

    /**
     * الإدارة الذكية: من القراءة الحية فقط، بحدّين مختلفين للتحويل والعودة ومدة انتظار بين تحويلين.
     * لا قرار على قراءة قديمة أو ناقصة، ولا أوامر أثناء انقطاع الشبكة.
     */
    fun decideSmart(now: Long, cur: String?, snap: Snapshot?, ageMs: Long?, st: CtlState, c: CtlConfig): Pair<Decision, Int> {
        var cover = st.coverRuns
        fun none(r: String) = Decision(null, r) to cover
        if (snap == null || ageMs == null) return none("لا توجد قراءة من الجهاز")
        if (ageMs > c.staleMin * 60_000L) return none("آخر قراءة عمرها ${ageMs / 60_000} دقيقة؛ لا قرار على قراءة قديمة")
        val soc = snap.soc ?: return none("نسبة البطارية غير مقروءة")
        val pv = snap.pvW ?: return none("قدرة الألواح غير مقروءة")
        val load = snap.outW ?: return none("حمل البيت غير مقروء")
        val gridOn = snap.gridV != null && snap.gridV >= 0.4 * (snap.gridRatedV ?: 230.0)
        cover = if (pv >= load + c.pvMarginW) cover + 1 else 0
        if (now < st.pauseUntil) return none("موقوفة بعد تدخّل يدوي حتى ${hhmm(st.pauseUntil, c)}")
        if (!gridOn) return none("الشبكة مقطوعة؛ يتصرف الإنفرتر بحمايته")
        if (cur == null) return none("تعذّرت قراءة الوضع الحالي")
        if (cur != c.gridKey && cur != c.solarKey) return none("الجهاز على وضع غير مشمول ($cur)")
        if (now - st.lastSwitchAt < c.gapMin * 60_000L) return none("انتظار ${c.gapMin} دقيقة بين تحويلين")
        val s = soc.toInt()
        if (cur == c.solarKey && soc <= c.low && pv < load) {
            return Decision(c.gridKey, "البطارية $s% وصلت الحد ${c.low}% والألواح (${pv.toInt()} واط) لا تغطي الحمل (${load.toInt()} واط)") to cover
        }
        if (cur == c.gridKey && soc >= c.target) return Decision(c.solarKey, "البطارية بلغت $s% (المستهدف ${c.target}%)") to cover
        if (cur == c.gridKey && cover >= 2 && soc > c.low) {
            return Decision(c.solarKey, "الألواح (${pv.toInt()} واط) تغطي الحمل (${load.toInt()} واط) في قراءتين متتاليتين") to cover
        }
        return none("لا حاجة لتحويل: البطارية $s%، الألواح ${pv.toInt()} واط، الحمل ${load.toInt()} واط")
    }

    fun hhmm(t: Long, c: CtlConfig): String {
        val m = localMin(t, c.utcOffsetMin)
        val h = m / 60
        return "${if (h % 12 == 0) 12 else h % 12}:${"%02d".format(m % 60)} ${if (h < 12) "ص" else "م"}"
    }

    fun appendLog(log: JSONArray, entry: JSONObject, max: Int = 100): JSONArray {
        val out = JSONArray().put(entry)
        for (i in 0 until minOf(log.length(), max - 1)) out.put(log.get(i))
        return out
    }
}

/** ما يحتاجه المنفّذ من الخادم؛ واجهة حتى يُختبر بخادم وهمي. */
interface CtlApi {
    fun readMode(): String?
    fun send(key: String)
    /** آخر قراءة حية وعمرها بالمللي ثانية */
    fun snapshot(): Pair<Snapshot, Long>?
}

data class RunResult(val decision: Decision, val status: String, val from: String?, val to: String?, val error: String? = null, val state: CtlState)

object ControlRunner {
    /** يقرر وينفّذ ويتحقق. status: none | confirmed | unconfirmed | rejected | error */
    fun run(now: Long, c: CtlConfig, st0: CtlState, api: CtlApi, sleep: (Long) -> Unit = { Thread.sleep(it) }, clock: () -> Long = { now }): RunResult {
        var st = st0.copy(lastCheckAt = now)
        val cur = try { api.readMode() } catch (e: Exception) { null }
        val decision: Decision = when (c.mode) {
            "schedule" -> ControlEngine.decideSchedule(now, cur, st, c)
            "smart" -> {
                val snap = try { api.snapshot() } catch (e: Exception) { null }
                val (d, cover) = ControlEngine.decideSmart(now, cur, snap?.first, snap?.second, st, c)
                st = st.copy(coverRuns = cover)
                d
            }
            else -> Decision(null, "التحكم يدوي")
        }
        // الجدولة: الموعد المطابق أصلاً يُعدّ معالجاً
        if (c.mode == "schedule" && decision.key == null && cur != null && cur == ControlEngine.desiredKey(now, c) && st.handledBoundary != decision.boundary) {
            st = st.copy(handledBoundary = decision.boundary, attempts = 0)
        }
        if (decision.key == null) return RunResult(decision, "none", cur, null, state = st.copy(lastNote = decision.reason))

        val target = decision.key
        try {
            api.send(target)
        } catch (e: Exception) {
            return finish(c, st, decision, "rejected", cur, target, e.message ?: "رفض الجهاز الأمر", clock())
        }
        var after: String? = null
        var err: String? = null
        repeat(4) {
            sleep(4_000)
            try {
                after = api.readMode(); err = null
            } catch (e: Exception) {
                err = e.message
            }
            if (after == target) return finish(c, st, decision, "confirmed", cur, target, null, clock())
        }
        return finish(c, st, decision, "unconfirmed", cur, target, err ?: "الجهاز ما زال يعيد ${ControlEngine.labelOf(after, c)}", clock())
    }

    private fun finish(c: CtlConfig, st: CtlState, d: Decision, status: String, from: String?, to: String, error: String?, at: Long): RunResult {
        val ok = status == "confirmed"
        var s = st.copy(lastSwitchAt = at, lastNote = d.reason)
        if (c.mode == "schedule") {
            val attempts = if (ok) 0 else st.attempts + 1
            // نجح، أو استُنفدت المحاولات: لا نعيد المحاولة لهذا الموعد
            s = s.copy(attempts = if (ok || attempts >= ControlEngine.MAX_ATTEMPTS) 0 else attempts,
                handledBoundary = if (ok || attempts >= ControlEngine.MAX_ATTEMPTS) d.boundary else st.handledBoundary)
        }
        return RunResult(d, status, from, to, error, s)
    }
}
