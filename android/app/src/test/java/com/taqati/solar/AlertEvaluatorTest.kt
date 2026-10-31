package com.taqati.solar

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.text.SimpleDateFormat
import java.util.Locale

class AlertEvaluatorTest {
    private val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
    private val now = fmt.parse("2026-10-28 20:56:00")!!.time
    private val cfg = MonitorConfig(sn = "x")

    // نفس الحقول التي يرسلها جهاز حقيقي (Master 7KW)
    private fun points(ts: String, soc: String = "53", grid: String = "225.9", load: String = "27", fault: String = "-", dis: String = "36") = listOf(
        Point("id", "7c95e164763112e14109989f40c20b3a"), Point("Timestamp", ts), Point("Grid Voltage", grid),
        Point("Battery Voltage", "51.6"), Point("Battery Capacity", soc), Point("Battery Charging Current", "0"),
        Point("Battery Discharge Current", dis), Point("AC Output Active Power", "1730"), Point("Output Load Percent", load),
        Point("Grid Rating Voltage", "230.0"), Point("Model", "Battery Mode"), Point("Inverter Fault", fault),
        Point("PV2 Input voltage", "-"),
    )

    @Test
    fun parsesRealDeviceFields() {
        val s = AlertEvaluator.snapshot(points("2026-10-28 19:17:29"))
        assertEquals(fmt.parse("2026-10-28 19:17:29")!!.time, s.tsRaw)
        assertEquals(53.0, s.soc!!, 0.0)
        assertEquals(225.9, s.gridV!!, 0.0)
        assertEquals("Battery Mode", s.mode)
        assertNull("«-» تعني لا يوجد عطل", s.fault)
        assertEquals(51.6 * -36, s.batW!!, 0.01)
    }

    @Test
    fun staleReadingRaisesOfflineOnceAndSkipsOtherAlerts() {
        val s = AlertEvaluator.snapshot(points("2026-10-28 19:17:29", soc = "10"))
        val first = AlertEvaluator.evaluate(s, cfg, JSONObject(), now)
        assertEquals(listOf("الإنفرتر غير متصل"), first.alerts.map { it.title })
        assertEquals(listOf("offline"), first.faults.map { it.kind })
        val second = AlertEvaluator.evaluate(s, cfg, first.flags, now + 900_000)
        assertTrue("لا تكرار", second.alerts.isEmpty())
    }

    @Test
    fun recoveryAfterOfflineAnnouncesOnlyIfOfflineWasAnnounced() {
        val fresh = AlertEvaluator.snapshot(points("2026-10-28 20:54:00"))
        val back = AlertEvaluator.evaluate(fresh, cfg, JSONObject().put("offline", true), now)
        assertTrue(back.alerts.any { it.title == "عاد اتصال الإنفرتر" })
        val silent = AlertEvaluator.evaluate(fresh, cfg, JSONObject().put("offline", "silent"), now)
        assertTrue(silent.alerts.none { it.title == "عاد اتصال الإنفرتر" })
        assertEquals(false, silent.flags.get("offline"))
    }

    @Test
    fun timezoneOffsetMakesServerTimeFresh() {
        // الخادم متأخر 3 ساعات عن الهاتف
        val s = AlertEvaluator.snapshot(points("2026-10-28 17:54:00"))
        val out = AlertEvaluator.evaluate(s, cfg.copy(tzOffsetMs = 3 * 3_600_000L), JSONObject(), now)
        assertTrue(out.alerts.none { it.title == "الإنفرتر غير متصل" })
    }

    @Test
    fun lowBatteryGridLossAndOverloadAreEdgeTriggered() {
        val s = AlertEvaluator.snapshot(points("2026-10-28 20:54:00", soc = "25", grid = "0", load = "95"))
        val out = AlertEvaluator.evaluate(s, cfg, JSONObject(), now)
        assertEquals(setOf("البطارية منخفضة", "حمل زائد", "انقطعت كهرباء الشبكة"), out.alerts.map { it.title }.toSet())
        val again = AlertEvaluator.evaluate(s, cfg, out.flags, now + 60_000)
        assertTrue(again.alerts.isEmpty())
        val restored = AlertEvaluator.snapshot(points("2026-10-28 20:55:00", soc = "60", grid = "230", load = "20"))
        val after = AlertEvaluator.evaluate(restored, cfg, again.flags, now + 120_000)
        assertEquals(listOf("عادت كهرباء الشبكة"), after.alerts.map { it.title })
    }

    @Test
    fun gridThresholdFollowsRatedVoltage() {
        // شبكة 120 فولت: 110 فولت تعني الكهرباء موجودة
        val p = points("2026-10-28 20:54:00", grid = "110").map { if (it.title == "Grid Rating Voltage") Point(it.title, "120") else it }
        val out = AlertEvaluator.evaluate(AlertEvaluator.snapshot(p), cfg, JSONObject(), now)
        assertTrue(out.alerts.none { it.title.startsWith("انقطعت") })
    }

    @Test
    fun faultCodeChangeIsReportedOnce() {
        val s = AlertEvaluator.snapshot(points("2026-10-28 20:54:00", fault = "07"))
        val out = AlertEvaluator.evaluate(s, cfg, JSONObject(), now)
        assertEquals(listOf("عطل في الإنفرتر"), out.alerts.map { it.title })
        assertTrue(AlertEvaluator.evaluate(s, cfg, out.flags, now).alerts.isEmpty())
    }

    @Test
    fun nullFaultHandedOverFromUiIsNotAnEvent() {
        // الواجهة تسلّم faultCode = null بصيغة JSON عند الانتقال للخلفية
        val s = AlertEvaluator.snapshot(points("2026-10-28 20:54:00"))
        val out = AlertEvaluator.evaluate(s, cfg, JSONObject("{\"faultCode\":null,\"gridOff\":false,\"offline\":false}"), now)
        assertTrue(out.faults.isEmpty())
        assertTrue(out.alerts.isEmpty())
    }

    @Test
    fun disabledAlertsStillLogFaults() {
        val s = AlertEvaluator.snapshot(points("2026-10-28 19:17:29"))
        val out = AlertEvaluator.evaluate(s, cfg.copy(alertOffline = false), JSONObject(), now)
        assertTrue(out.alerts.isEmpty())
        assertEquals(1, out.faults.size)
    }

    @Test
    fun notificationsUseFixedTerms() {
        // المصطلحات ثابتة في النص نفسه: «الإنفرتر» و«كهرباء الشبكة»
        val s = AlertEvaluator.snapshot(points("2026-10-28 20:54:00", grid = "0"))
        val out = AlertEvaluator.evaluate(s, cfg, JSONObject(), now)
        assertTrue(out.alerts.any { it.title == "انقطعت كهرباء الشبكة" })
        val stale = AlertEvaluator.evaluate(AlertEvaluator.snapshot(points("2026-10-28 19:17:29")), cfg, JSONObject(), now)
        assertTrue(stale.alerts.all { it.body.contains("الإنفرتر") && !it.body.contains("الرافع") })
    }

    @Test
    fun alertsUseHysteresisToAvoidFlapping() {
        val low = AlertEvaluator.evaluate(AlertEvaluator.snapshot(points("2026-10-28 20:54:00", soc = "30", load = "80")), cfg, JSONObject(), now)
        assertEquals(setOf("البطارية منخفضة", "حمل زائد"), low.alerts.map { it.title }.toSet())
        // تذبذب بسيط فوق الحد لا يُعيد التسليح ولا يكرر التنبيه
        val wobble = AlertEvaluator.evaluate(AlertEvaluator.snapshot(points("2026-10-28 20:55:00", soc = "32", load = "75")), cfg, low.flags, now)
        assertEquals(true, wobble.flags.get("lowSoc"))
        assertEquals(true, wobble.flags.get("overload"))
        val back = AlertEvaluator.evaluate(AlertEvaluator.snapshot(points("2026-10-28 20:55:30", soc = "30", load = "80")), cfg, wobble.flags, now)
        assertTrue(back.alerts.isEmpty())
        // ابتعاد واضح يعيد التسليح
        val clear = AlertEvaluator.evaluate(AlertEvaluator.snapshot(points("2026-10-28 20:55:40", soc = "36", load = "60")), cfg, back.flags, now)
        assertEquals(false, clear.flags.get("lowSoc"))
        assertEquals(false, clear.flags.get("overload"))
    }

    @Test
    fun arabicCountGrammar() {
        assertEquals("دقيقة", AlertEvaluator.minutesAgo(60_000))
        assertEquals("دقيقتين", AlertEvaluator.minutesAgo(120_000))
        assertEquals("5 دقائق", AlertEvaluator.minutesAgo(300_000))
        assertEquals("25 دقيقة", AlertEvaluator.minutesAgo(25 * 60_000L))
        assertEquals("ساعتين و3 دقائق", AlertEvaluator.minutesAgo(123 * 60_000L))
        assertEquals("يومين", AlertEvaluator.minutesAgo(49 * 3_600_000L))
    }

    @Test
    fun temperatureAlertsOnlyWhenDeviceReportsTemperature() {
        val none = AlertEvaluator.snapshot(points("2026-10-28 20:54:00"))
        assertNull(none.batTemp)
        assertNull(none.invTemp)
        val hot = points("2026-10-28 20:54:00") + Point("Inverter heat sink temperature", "82") + Point("Battery Temperature", "0")
        val s = AlertEvaluator.snapshot(hot)
        assertEquals(82.0, s.invTemp!!, 0.0)
        assertNull("الصفر يعني حساساً غير موجود", s.batTemp)
        val out = AlertEvaluator.evaluate(s, cfg, JSONObject(), now)
        assertEquals(listOf("حرارة الإنفرتر مرتفعة"), out.alerts.map { it.title })
        // 78° ما زالت ضمن هامش الرجوع (75 - 5) فلا يتكرر التنبيه
        val warm = AlertEvaluator.snapshot(points("2026-10-28 20:55:00") + Point("Inverter heat sink temperature", "78"))
        val again = AlertEvaluator.evaluate(warm, cfg, out.flags, now)
        assertTrue(again.alerts.isEmpty())
        assertEquals(true, again.flags.get("hotInv"))
        assertTrue(AlertEvaluator.evaluate(s, cfg.copy(alertTemp = false), JSONObject(), now).alerts.isEmpty())
    }
}
