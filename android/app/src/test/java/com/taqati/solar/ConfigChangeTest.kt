package com.taqati.solar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** تغيّر الإعداد أو الخروج أثناء فحص جارٍ: لا يُرسل الأمر الذي قرّره الإعداد القديم. */
class ConfigChangeTest {
    private val now = 2_000_000_000_000L
    private val live = CtlConfig("smart", "out", "grid", "Grid", "solar", "Solar", dryRun = false)

    private fun api(allowed: () -> Boolean) = object : CtlApi {
        override fun readMode() = "solar"
        override fun send(key: String) { fail("أُرسل أمر بعد تغيّر الإعداد") }
        override fun snapshot() = Snapshot(0, 20.0, 230.0, 230.0, null, 1500.0, null, "Battery Mode", null, pvW = 100.0) to 0L
        override fun stillAllowed() = allowed()
    }

    @Test
    fun noSendWhenConfigChangedDuringRun() {
        val st = CtlState(lastCheckAt = 5)
        val r = ControlRunner.run(now, live, st, api { false }, sleep = {})
        assertEquals("none", r.status)
        assertTrue(r.decision.reason.contains("تغيّر إعداد التحكم"))
        assertEquals(st, r.state)   // لا تُحتسب محاولة ولا وقت تحويل
    }

    @Test
    fun sendsWhenStillAllowed() {
        var sent = 0
        val a = object : CtlApi {
            var mode = "solar"
            override fun readMode() = mode
            override fun send(key: String) { sent++; mode = key }
            override fun snapshot() = Snapshot(0, 20.0, 230.0, 230.0, null, 1500.0, null, "Battery Mode", null, pvW = 100.0) to 0L
        }
        val r = ControlRunner.run(now, live, CtlState(), a, sleep = {})
        assertEquals("confirmed", r.status)
        assertEquals(1, sent)
    }

    @Test
    fun scheduleAlsoGuarded() {
        val sch = CtlConfig("schedule", "out", "grid", "Grid", "solar", "Solar", slots = listOf(Slot(0, 1439, "grid")))
        val r = ControlRunner.run(now, sch, CtlState(), api { false }, sleep = {})
        assertEquals("none", r.status)
    }
}
