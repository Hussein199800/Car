package com.taqati.solar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateRulesTest {
    private val pkg = "com.taqati.solar"

    @Test
    fun onlyThisRepositoryReleasesAreDownloaded() {
        assertTrue(UpdateRules.isAllowedUrl("https://github.com/Hussein199800/Car/releases/download/v3.4.0/taqati-3.4.0.apk"))
        assertFalse(UpdateRules.isAllowedUrl("http://github.com/Hussein199800/Car/releases/download/v3.4.0/taqati.apk"))
        assertFalse(UpdateRules.isAllowedUrl("https://github.com/other/Car/releases/download/v1/taqati.apk"))
        assertFalse(UpdateRules.isAllowedUrl("https://github.com/Hussein199800/Car/releases/download/../../x/evil.apk"))
        assertFalse(UpdateRules.isAllowedUrl("https://github.com/Hussein199800/Car/releases/download/v1/notes.txt"))
        assertFalse(UpdateRules.isAllowedUrl(null))
    }

    @Test
    fun downloadedPackageMustBeNewerSameAppSameKey() {
        val k = setOf("f003c6d8")
        assertNull(UpdateRules.reject(pkg, pkg, 9, 8, k, k))
        assertEquals("الملف المحمّل ليس تطبيق طاقتي", UpdateRules.reject("com.evil", pkg, 9, 8, k, k))
        assertEquals("النسخة المحمّلة ليست أحدث من المثبّتة", UpdateRules.reject(pkg, pkg, 8, 8, k, k))
        assertEquals("توقيع التحديث لا يطابق التطبيق المثبّت", UpdateRules.reject(pkg, pkg, 9, 8, setOf("aa"), k))
        assertEquals("الملف المحمّل ليس تطبيقاً صالحاً", UpdateRules.reject(null, pkg, 0, 8, null, k))
        // توقيع غير مقروء: يبقى مثبّت أندرويد حارساً أخيراً
        assertNull(UpdateRules.reject(pkg, pkg, 9, 8, null, k))
    }
}
