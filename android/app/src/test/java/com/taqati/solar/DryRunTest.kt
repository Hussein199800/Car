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
