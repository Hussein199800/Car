package com.taqati.solar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ControlEngineTest {
    private val dev = Device("PN", "SN", "2451", "1")
    private val items = mapOf("0" to "Utility first", "1" to "Solar first", "2" to "SBU")

    /** لحظة بتوقيت سوريا (UTC+3): التاريخ والساعة */
    private fun syria(date: String, h: Int, m: Int = 0): Long {
        val (y, mo, d) = date.split("-").map { it.toInt() }
        val days = java.time.LocalDate.of(y, mo, d).toEpochDay()
        return days * 86_400_000L + (h * 60 + m) * 60_000L - 3 * 3_600_000L
    }

    private fun cfg(mode: String = "schedule", slots: List<Slot> = listOf(Slot(17 * 60, 22 * 60, "0"))) = CtlConfig(
        mode = mode, fieldId = "out", gridKey = "0", gridLabel = "Utility first", solarKey = "2", solarLabel = "SBU",
        slots = slots, defaultKey = "2", items = items, device = dev,
    )

    // 2026-11-14 سبت، 2026-11-15 أحد
    @Test
    fun weekdayAndDateFromSyrianLocalTime() {
        val t = syria("2026-11-14", 0, 30)   // بعد منتصف الليل بتوقيت سوريا، وما زال 13 بتوقيت UTC
        val day = ControlEngine.localDay(t, 180)
        assertEquals("2026-11-14", ControlEngine.dateOf(day))
        assertEquals(6, ControlEngine.weekday(day))
        assertEquals(30, ControlEngine.localMin(t, 180))
    }

    @Test
    fun windowsDaysAndOneOffRules() {
        val c = cfg(slots = listOf(
            Slot(15 * 60, 17 * 60, "0", days = setOf(6)),            // السبت ساعتان من 3 م
            Slot(19 * 60, 23 * 60, "0", days = setOf(0)),            // الأحد أربع ساعات من 7 م
            Slot(22 * 60, 2 * 60, "1", days = setOf(1)),             // الاثنين يعبر منتصف الليل
            Slot(9 * 60, 11 * 60, "0", days = emptySet(), date = "2026-11-18"), // مرة واحدة
        ))
        assertEquals("0", ControlEngine.desiredKey(syria("2026-11-14", 15, 30), c))
        assertEquals("2", ControlEngine.desiredKey(syria("2026-11-14", 17, 0), c))   // النهاية غير مشمولة
        assertEquals("2", ControlEngine.desiredKey(syria("2026-11-15", 15, 30), c))  // الأحد لا قاعدة في 3 م
        assertEquals("0", ControlEngine.desiredKey(syria("2026-11-15", 22, 59), c))
        assertEquals("1", ControlEngine.desiredKey(syria("2026-11-16", 23, 0), c))
        assertEquals("1", ControlEngine.desiredKey(syria("2026-11-17", 1, 30), c))   // بعد منتصف ليل الاثنين
        assertEquals("2", ControlEngine.desiredKey(syria("2026-11-18", 1, 30), c))   // ليلة الثلاثاء ليست مشمولة
        assertEquals("0", ControlEngine.desiredKey(syria("2026-11-18", 10, 0), c))   // القاعدة لمرة واحدة
        assertEquals("2", ControlEngine.desiredKey(syria("2026-11-25", 10, 0), c))   // ولا تتكرر
        assertEquals(syria("2026-11-14", 17, 0), ControlEngine.lastBoundary(syria("2026-11-14", 18, 0), c))
        assertEquals(syria("2026-11-15", 19, 0), ControlEngine.nextBoundary(syria("2026-11-14", 18, 0), c))
        assertEquals(syria("2026-11-17", 2, 0), ControlEngine.nextBoundary(syria("2026-11-17", 1, 0), c))
        assertEquals(0L, ControlEngine.nextBoundary(0, cfg(slots = emptyList())))
    }

    @Test
    fun scheduleCatchesUpInsideWindowButNotAfterIt() {
        val c = cfg()
        // الهاتف عاد 6:30 م: ما زلنا في الفترة، فيُنفَّذ مع ذكر التأخير
        val d = ControlEngine.decideSchedule(syria("2026-11-14", 18, 30), "2", CtlState(), c)
        assertEquals("0", d.key)
        assertTrue(d.reason.contains("متأخر 90"))
        assertEquals(syria("2026-11-14", 17, 0), d.boundary)
        // عاد 11 م: الفترة انتهت، والمطلوب الآن SBU وهو الحالي فلا شيء
        assertNull(ControlEngine.decideSchedule(syria("2026-11-14", 23, 0), "2", CtlState(), c).key)
        // الموعد عولج: تغيير يدوي بعده يُحترم حتى الموعد التالي
        val st = CtlState(handledBoundary = syria("2026-11-14", 17, 0))
        assertNull(ControlEngine.decideSchedule(syria("2026-11-14", 19, 0), "2", st, c).key)
        assertEquals("2", ControlEngine.decideSchedule(syria("2026-11-14", 22, 1), "0", st, c).key)
        // لا إرسال إذا تعذّرت القراءة أو كان الوضع غير معروف
        assertNull(ControlEngine.decideSchedule(syria("2026-11-14", 18, 0), null, CtlState(), c).key)
        assertNull(ControlEngine.decideSchedule(syria("2026-11-14", 18, 0), "Weird", CtlState(), c).key)
    }

    private fun snap(soc: Double, pv: Double, load: Double, gridV: Double = 230.0) =
        Snapshot(0, soc, gridV, 230.0, null, load, null, "Battery Mode", null, pvW = pv)

    @Test
    fun smartUsesHysteresisGapAndFreshReadings() {
        val c = cfg(mode = "smart").copy(low = 45, target = 65, gapMin = 30)
        val now = syria("2026-11-14", 18, 0)
        val fresh = 60_000L
        // البطارية وصلت الحد والألواح لا تغطي الحمل: إلى الشبكة
        assertEquals("0", ControlEngine.decideSmart(now, "2", snap(44.0, 100.0, 600.0), fresh, CtlState(), c).first.key)
        // بين الحدين: لا تذبذب في أي اتجاه
        assertNull(ControlEngine.decideSmart(now, "2", snap(55.0, 100.0, 600.0), fresh, CtlState(), c).first.key)
        assertNull(ControlEngine.decideSmart(now, "0", snap(55.0, 100.0, 600.0), fresh, CtlState(), c).first.key)
        // بلوغ المستهدف: عودة
        assertEquals("2", ControlEngine.decideSmart(now, "0", snap(66.0, 0.0, 600.0), fresh, CtlState(), c).first.key)
        // مدة الانتظار بين تحويلين
        assertNull(ControlEngine.decideSmart(now, "0", snap(70.0, 0.0, 600.0), fresh, CtlState(lastSwitchAt = now - 10 * 60_000), c).first.key)
        // قراءة قديمة، شبكة مقطوعة، توقف يدوي، وضع غير معروف: لا قرار
        assertNull(ControlEngine.decideSmart(now, "2", snap(30.0, 0.0, 600.0), 40 * 60_000L, CtlState(), c).first.key)
        assertNull(ControlEngine.decideSmart(now, "2", snap(30.0, 0.0, 600.0, gridV = 0.0), fresh, CtlState(), c).first.key)
        assertNull(ControlEngine.decideSmart(now, "2", snap(30.0, 0.0, 600.0), fresh, CtlState(pauseUntil = now + 60_000), c).first.key)
        assertNull(ControlEngine.decideSmart(now, "1", snap(30.0, 0.0, 600.0), fresh, CtlState(), c).first.key)
        assertNull(ControlEngine.decideSmart(now, "2", null, null, CtlState(), c).first.key)
        // الألواح تغطي الحمل: يلزم قراءتان متتاليتان
        val (d1, cover1) = ControlEngine.decideSmart(now, "0", snap(50.0, 900.0, 500.0), fresh, CtlState(), c)
        assertNull(d1.key)
        assertEquals(1, cover1)
        assertEquals("2", ControlEngine.decideSmart(now, "0", snap(50.0, 900.0, 500.0), fresh, CtlState(coverRuns = cover1), c).first.key)
    }

    private class FakeApi(var mode: String?, val applies: Boolean = true, val reject: Boolean = false, val readFails: Boolean = false) : CtlApi {
        val sent = mutableListOf<String>()
        var snap: Pair<Snapshot, Long>? = null
        override fun readMode(): String? { if (readFails) throw ApiException("تعذّر الاتصال"); return mode }
        override fun send(key: String) {
            sent += key
            if (reject) throw ApiException("الإنفرتر لم يرد في الوقت المحدد", 1)
            if (applies) mode = key
        }
        override fun snapshot() = snap
    }

    @Test
    fun runnerVerifiesWithDeviceAndCapsRetries() {
        val c = cfg()
        val t = syria("2026-11-14", 17, 1)
        val b = syria("2026-11-14", 17, 0)
        // ناجح: يتأكد من الجهاز ويُعدّ الموعد معالجاً
        val ok = FakeApi("2")
        val r1 = ControlRunner.run(t, c, CtlState(), ok, sleep = {})
        assertEquals("confirmed", r1.status)
        assertEquals(listOf("0"), ok.sent)
        assertEquals(b, r1.state.handledBoundary)
        // قُبل الأمر ولم يُطبَّق: لم يتأكد، ويُعاد في التشغيل التالي حتى 3 محاولات ثم يتوقف
        val stuck = FakeApi("2", applies = false)
        var st = CtlState()
        repeat(3) { i ->
            val r = ControlRunner.run(t + i * 60_000, c, st, stuck, sleep = {})
            assertEquals("unconfirmed", r.status)
            st = r.state
        }
        assertEquals(b, st.handledBoundary)
        assertEquals("none", ControlRunner.run(t + 300_000, c, st, stuck, sleep = {}).status)
        assertEquals(3, stuck.sent.size)
        // مرفوض
        assertEquals("rejected", ControlRunner.run(t, c, CtlState(), FakeApi("2", reject = true), sleep = {}).status)
        // تعذّرت القراءة: لا إرسال إطلاقاً
        val blind = FakeApi("2", readFails = true)
        assertEquals("none", ControlRunner.run(t, c, CtlState(), blind, sleep = {}).status)
        assertTrue(blind.sent.isEmpty())
        // الوضع مطابق أصلاً: يُعدّ معالجاً بلا إرسال
        val same = FakeApi("0")
        val r2 = ControlRunner.run(t, c, CtlState(), same, sleep = {})
        assertEquals("none", r2.status)
        assertEquals(b, r2.state.handledBoundary)
        assertTrue(same.sent.isEmpty())
        // التحكم اليدوي: لا شيء
        val man = FakeApi("2")
        assertEquals("none", ControlRunner.run(t, c.copy(mode = "manual"), CtlState(), man, sleep = {}).status)
        assertFalse(man.sent.isNotEmpty())
    }

    @Test
    fun configParsesSlotsAndValidates() {
        val o = org.json.JSONObject("""{"mode":"schedule","fieldId":"out","gridKey":"0","solarKey":"2","defaultKey":"2",
            "items":{"0":"Utility first","2":"SBU"},"device":{"pn":"P","sn":"S","devcode":"1","devaddr":"1"},
            "slots":[{"startMin":900,"endMin":1020,"key":"0","days":[6]},{"startMin":540,"endMin":660,"key":"0","date":"2026-11-18"}]}""")
        val c = CtlConfig.fromJson(o)
        assertTrue(c.valid)
        assertEquals(setOf(6), c.slots[0].days)
        assertEquals("2026-11-18", c.slots[1].date)
        assertEquals("SBU", ControlEngine.labelOf("2", c))
        assertFalse(c.copy(slots = emptyList()).valid)
        assertFalse(c.copy(mode = "smart", gridKey = "2").valid)
    }
}
