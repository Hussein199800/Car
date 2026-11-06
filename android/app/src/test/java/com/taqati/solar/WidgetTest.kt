package com.taqati.solar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetTest {
    @Test
    fun wattsUseArabicUnitsAndLatinDigits() {
        assertEquals("408 واط", WidgetText.watts(408))
        assertEquals("4.2 ك.واط", WidgetText.watts(4230))
        assertEquals("—", WidgetText.watts(null))
    }

    @Test
    fun batteryLineFollowsDirectionAndStaleness() {
        val base = WidgetState(67, 428, 178, 630, false, 0)
        assertEquals("تشحن 428 واط", WidgetText.battery(base))
        assertEquals("تُفرّغ 265 واط", WidgetText.battery(base.copy(batW = -265)))
        assertEquals("مستقرة", WidgetText.battery(base.copy(batW = 3)))
        assertEquals("آخر قيمة مسجّلة", WidgetText.battery(base.copy(stale = true)))
        assertTrue(WidgetText.time(base.copy(stale = true)).startsWith("غير متصل"))
    }

    @Test
    fun stateSurvivesStorageIncludingMissingValues() {
        val s = WidgetState(53, null, 1730, null, true, 123L)
        assertEquals(s, WidgetState.fromJson(s.toJson()))
        assertNull(WidgetState.fromJson("not json"))
    }

    @Test
    fun snapshotReadsPanelPowerForWidget() {
        val s = AlertEvaluator.snapshot(listOf(Point("PV1 Charging Power", "630"), Point("PV2 Charging Power", "120")))
        assertEquals(750.0, s.pvW!!, 0.0)
    }
}
