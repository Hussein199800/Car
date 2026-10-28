package com.taqati.solar

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** نسخة Kotlin من src/api.js لاستخدامها في المراقبة بالخلفية. يجب أن تبقى مطابقة لها في التوقيع. */

data class Session(
    val profile: String,
    val usr: String,
    val pwdHash: String,
    var token: String,
    var secret: String,
    var expire: Long,
) {
    fun toJson(): String = JSONObject()
        .put("profile", profile).put("usr", usr).put("pwdHash", pwdHash)
        .put("token", token).put("secret", secret).put("expire", expire)
        .toString()

    companion object {
        fun fromJson(json: String?): Session? = try {
            val o = JSONObject(json ?: return null)
            Session(
                o.optString("profile", "dess"), o.getString("usr"), o.getString("pwdHash"),
                o.optString("token"), o.optString("secret"), o.optLong("expire"),
            )
        } catch (e: Exception) {
            null
        }
    }
}

data class Device(val pn: String, val sn: String, val devcode: String, val devaddr: String)

data class Point(val title: String, val value: String)

class ApiException(message: String, val code: Int? = null) : Exception(message)

fun interface HttpGet {
    fun get(url: String): String
}

object DefaultHttp : HttpGet {
    override fun get(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 20_000
        conn.readTimeout = 20_000
        conn.instanceFollowRedirects = false
        try {
            if (conn.responseCode != 200) throw ApiException("HTTP ${conn.responseCode}")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }
}

class WatchPowerClient(
    var session: Session,
    private val http: HttpGet = DefaultHttp,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private data class Profile(val base: String, val authAction: String, val source: String)

    private val profiles = mapOf(
        "dess" to Profile("https://api.dessmonitor.com/public/", "authSource", "1"),
        "shine" to Profile("https://ios.shinemonitor.com/public/", "auth", "0"),
    )
    private val profile get() = profiles[session.profile] ?: profiles.getValue("dess")

    /** صحيح إذا جُدِّد الرمز أثناء الطلبات، ليُحفظ في التخزين المشفّر. */
    var sessionChanged = false
        private set

    fun authenticate() {
        session.token = ""
        session.secret = ""
        val res = request(
            profile.authAction,
            linkedMapOf(
                "usr" to session.usr, "company-key" to COMPANY_KEY, "source" to profile.source,
                "_app_client_" to "web", "_app_id_" to "taqati-solar", "_app_version_" to "1.0.0",
            ),
            retry = false,
        )
        val dat = res.optJSONObject("dat") ?: throw ApiException("استجابة دخول غير صالحة", -1)
        session.token = dat.optString("token")
        session.secret = dat.optString("secret")
        if (session.token.isEmpty() || session.secret.isEmpty()) throw ApiException("استجابة دخول غير صالحة", -1)
        session.expire = now() + dat.optLong("expire", 3600) * 1000
        sessionChanged = true
    }

    fun request(action: String, params: Map<String, String>, retry: Boolean = true): JSONObject {
        val isAuth = action == profile.authAction
        if (!isAuth && (session.token.isEmpty() || now() > session.expire - 120_000)) authenticate()
        val salt = now().toString()
        val actionStr = buildActionString(action, params)
        val sign = if (isAuth) sha1(salt + session.pwdHash + actionStr) else sha1(salt + session.secret + session.token + actionStr)
        val url = buildString {
            append(profile.base).append("?sign=").append(sign).append("&salt=").append(salt)
            if (!isAuth) append("&token=").append(session.token)
            append(actionStr)
        }
        val body = try {
            http.get(url)
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException("تعذّر الاتصال بالخادم")
        }
        val json = try {
            JSONObject(body)
        } catch (e: Exception) {
            throw ApiException("استجابة غير صالحة من الخادم")
        }
        val err = json.optInt("err", 0)
        if (err != 0) {
            val desc = json.optString("desc")
            if (!isAuth && retry && Regex("TOKEN|AUTH|SIGN|VERIF").containsMatchIn(desc)) {
                authenticate()
                return request(action, params, retry = false)
            }
            throw ApiException(desc.ifEmpty { "خطأ $err" }, err)
        }
        return json
    }

    fun lastData(dev: Device): List<Point> {
        val res = request(
            "queryDeviceLastData",
            linkedMapOf("pn" to dev.pn, "devcode" to dev.devcode, "devaddr" to dev.devaddr, "sn" to dev.sn, "i18n" to "en_US"),
        )
        val arr = res.optJSONArray("dat") ?: res.optJSONObject("dat")?.optJSONArray("data") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            Point(o.optString("title"), o.optString("val"))
        }
    }

    companion object {
        const val COMPANY_KEY = "bnrl_frRFjEz8Mkn"

        fun sha1(text: String): String =
            MessageDigest.getInstance("SHA-1").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

        /** مطابق لـ quote_plus في بايثون ولـ quotePlus في api.js: يبقي الحروف والأرقام و -_.~ */
        fun quotePlus(value: String): String = buildString {
            for (b in value.toByteArray(Charsets.UTF_8)) {
                val c = b.toInt() and 0xff
                when {
                    c in 'a'.code..'z'.code || c in 'A'.code..'Z'.code || c in '0'.code..'9'.code || c in "-_.~".map { it.code } -> append(c.toChar())
                    c == ' '.code -> append('+')
                    else -> append('%').append("%02X".format(c))
                }
            }
        }

        fun buildActionString(action: String, params: Map<String, String>): String =
            "&action=$action" + params.entries.joinToString("") { "&${it.key}=${quotePlus(it.value)}" }
    }
}
