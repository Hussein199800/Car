package com.taqati.solar

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** وضع التجربة في الإدارة الذكية: لا يصل أبداً إلى الإرسال أو التحقق، ولا يملأ السجل بالقرار نفسه. */
class DryRunTest {
    private val now = 2_000_000_000_000L
    private val config = CtlConfig("smart", "out", "grid", "Grid", "solar", "Solar")

    private fun api(soc: Double = 20.0, age: Long = 0) = object : CtlApi {
        override fun readMode() = "solar"
        override fun send(key: String) { fail("وضع التجربة وصل إلى الإرسال") }
        override fun snapshot() = Snapshot(0, soc, 230.0, 230.0, null, 1500.0, null, "Battery Mode", null, pvW = 100.0) to age
    }

    @Test
    fun defaultsAndJsonFailClosed() {
        assertTrue(config.dryRun)
        assertTrue(CtlConfig.fromJson(JSONObject("{\"mode\":\"smart\"}")).dryRun)
        val r = ControlRunner.run(now, config, CtlState(), api(), sleep = { fail("لا تحقق في وضع التجربة") })
        assertEquals("simulated", r.status)
        assertEquals("grid", r.to)
        assertTrue(r.decision.reason.contains("البطارية"))
        assertEquals(0L, r.state.lastSwitchAt)   // لا يؤثر على مدة الانتظار الحقيقية
        assertEquals("grid", r.state.simKey)
    }

    @Test
    fun sameDecisionIsLoggedOnceEveryTwoHours() {
        val first = ControlRunner.run(now, config, CtlState(), api())
        val again = ControlRunner.run(now + 15 * 60_000L, config, first.state, api())
        assertEquals("none", again.status)
        assertEquals(now, again.state.simAt)
        val later = ControlRunner.run(now + 2 * 3_600_000L, config, again.state, api())
        assertEquals("simulated", later.status)
        // زال السبب ثم عاد: يُسجَّل من جديد
        val cleared = ControlRunner.run(now + 2 * 3_600_000L + 60_000L, config, later.state, api(soc = 55.0))
        assertEquals("none", cleared.status)
        assertEquals("", cleared.state.simKey)
        assertEquals("simulated", ControlRunner.run(now + 2 * 3_600_000L + 120_000L, config, cleared.state, api()).status)
    }

    @Test
    fun noDecisionKeepsReasonWithoutLogging() {
        // قديمة، أو متقدمة أكثر من 20 دقيقة، أو لا حاجة لتحويل: لا سجل، والسبب محفوظ للعرض
        for ((soc, age) in listOf(20.0 to 16 * 60_000L, 20.0 to -25 * 60_000L, 70.0 to 0L)) {
            val r = ControlRunner.run(now, config, CtlState(), api(soc = soc, age = age))
            assertEquals("none", r.status)
            assertNull(r.to)
            assertTrue(r.state.lastNote.startsWith("تجربة"))
        }
        // متقدمة بدقائق قليلة (فرق ساعة الخادم): ما زالت حيّة
        assertEquals("simulated", ControlRunner.run(now, config, CtlState(), api(age = -5 * 60_000L)).status)
    }
}

/** حالة المراجعة: الخروج من التجربة مع القراءة نفسها لا يستوفي شرط «قراءتين متتاليتين». */
class TrialToLiveTest {
    private val now = 2_000_000_000_000L

    @Test
    fun sameReadingAfterLeavingTrialDoesNotSend() {
        val trial = CtlConfig("smart", "out", "grid", "Grid", "solar", "Solar", low = 45, target = 65)
        val live = trial.copy(dryRun = false)
        var sends = 0
        val reading = Snapshot(now - 1000, 55.0, 230.0, 230.0, null, 1000.0, null, "Line Mode", null, pvW = 2000.0)
        val api = object : CtlApi {
            override fun readMode() = "grid"
            override fun send(key: String) { sends++ }
            override fun snapshot() = reading to 1000L
        }
        val t = ControlRunner.run(now, trial, CtlState(), api, sleep = {})
        assertEquals(1, t.state.coverRuns)
        // نفس الحالة المحفوظة ونفس القراءة بعد ثانية في التنفيذ الحقيقي
        val r = ControlRunner.run(now + 1000, live, t.state, api, sleep = {})
        assertEquals("none", r.status)
        assertEquals(1, r.state.coverRuns)
        assertEquals(0, sends)
        // قراءة جديدة فعلاً بعد خمس دقائق: الآن قراءتان متتاليتان
        val next = Snapshot(now + 300_000, 55.0, 230.0, 230.0, null, 1000.0, null, "Line Mode", null, pvW = 2000.0)
        val api2 = object : CtlApi {
            override fun readMode() = if (sends == 0) "grid" else "solar"
            override fun send(key: String) { sends++ }
            override fun snapshot() = next to 1000L
        }
        assertEquals("confirmed", ControlRunner.run(now + 301_000, live, r.state, api2, sleep = {}).status)
        assertEquals(1, sends)
    }

    @Test
    fun checkLogKeepsEveryReasonChangeAndCountsRepeats() {
        fun e(reason: String, at: Long) = JSONObject().put("reason", reason).put("status", "none").put("at", at)
        var log = org.json.JSONArray()
        log = ControlEngine.appendCheck(log, e("لا حاجة لتحويل: البطارية 55%", 1))
        log = ControlEngine.appendCheck(log, e("لا حاجة لتحويل: البطارية 55%", 2))
        log = ControlEngine.appendCheck(log, e("الشبكة مقطوعة؛ يتصرف الإنفرتر بحمايته", 3))
        log = ControlEngine.appendCheck(log, e("لا حاجة لتحويل: البطارية 54%", 4))
        assertEquals(3, log.length())
        assertEquals(2, log.getJSONObject(2).optInt("count"))
        assertEquals(2L, log.getJSONObject(2).optLong("lastAt"))
        assertEquals("لا حاجة لتحويل: البطارية 54%", log.getJSONObject(0).optString("reason"))
    }
}
