package com.taqati.solar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class WatchPowerClientTest {
    // القيم المرجعية محسوبة من تنفيذ JavaScript (src/api.js) ومطابقة لـ quote_plus في بايثون
    @Test
    fun quotePlusMatchesJsAndPython() {
        assertEquals("a+b%2A~-_.%21%27%28%29%2F%3F%3D%26%C3%A9", WatchPowerClient.quotePlus("a b*~-_.!'()/?=&é"))
    }

    @Test
    fun authSignatureMatchesJs() {
        val params = linkedMapOf(
            "usr" to "حسين test+1@x.com", "company-key" to "bnrl_frRFjEz8Mkn", "source" to "1",
            "_app_client_" to "web", "_app_id_" to "taqati-solar", "_app_version_" to "1.0.0",
        )
        val action = WatchPowerClient.buildActionString("authSource", params)
        assertEquals(
            "&action=authSource&usr=%D8%AD%D8%B3%D9%8A%D9%86+test%2B1%40x.com&company-key=bnrl_frRFjEz8Mkn&source=1&_app_client_=web&_app_id_=taqati-solar&_app_version_=1.0.0",
            action,
        )
        val sign = WatchPowerClient.sha1("1700000000000" + WatchPowerClient.sha1("p@ss word") + action)
        assertEquals("cd91c72ea5cd482a4f28a92957db3c620e28beb9", sign)
    }

    @Test
    fun requestSignatureMatchesJs() {
        val sign = WatchPowerClient.sha1(
            "1700000000000SECRETTOKEN&action=queryDeviceLastData&pn=W0072122216413&devcode=2451&devaddr=1&sn=96342601101639&i18n=en_US",
        )
        assertEquals("e246ea2b10e9d70d26173b2e13a8b6ad0f779846", sign)
    }

    @Test
    fun lastDataSignsRequestAndParsesPoints() {
        val urls = mutableListOf<String>()
        val session = Session("dess", "u", "h", "TOKEN", "SECRET", Long.MAX_VALUE)
        val client = WatchPowerClient(session, { url ->
            urls += url
            """{"err":0,"dat":[{"title":"Battery Capacity","val":"53","unit":"%"},{"title":"Grid Voltage","val":"225.9","unit":"V"}]}"""
        }, { 1700000000000 })
        val pts = client.lastData(Device("W0072122216413", "96342601101639", "2451", "1"))
        assertEquals(listOf(Point("Battery Capacity", "53"), Point("Grid Voltage", "225.9")), pts)
        assertTrue(urls.single().startsWith("https://api.dessmonitor.com/public/?sign=e246ea2b10e9d70d26173b2e13a8b6ad0f779846&salt=1700000000000&token=TOKEN&action=queryDeviceLastData"))
        assertFalse(client.sessionChanged)
    }

    @Test
    fun expiredTokenReauthenticatesOnce() {
        var calls = 0
        val session = Session("dess", "u", WatchPowerClient.sha1("pw"), "OLD", "S", Long.MAX_VALUE)
        val client = WatchPowerClient(session, { url ->
            calls++
            when {
                url.contains("action=authSource") -> """{"err":0,"dat":{"token":"NEW","secret":"S2","expire":7200}}"""
                url.contains("token=OLD") -> """{"err":11,"desc":"ERR_TOKEN_EXPIRE"}"""
                else -> """{"err":0,"dat":[]}"""
            }
        }, { 1000L })
        client.lastData(Device("p", "s", "1", "1"))
        assertEquals(3, calls)
        assertEquals("NEW", client.session.token)
        assertTrue(client.sessionChanged)
    }

    @Test(expected = ApiException::class)
    fun networkFailureBecomesApiException() {
        val client = WatchPowerClient(Session("dess", "u", "h", "T", "S", Long.MAX_VALUE), { throw java.io.IOException("down") })
        client.lastData(Device("p", "s", "1", "1"))
    }

    @Test
    fun sessionRoundTripsThroughJson() {
        val s = Session("shine", "user", "hash", "tok", "sec", 123L)
        assertEquals(s, Session.fromJson(s.toJson()))
        assertEquals(null, Session.fromJson("not json"))
    }
}
