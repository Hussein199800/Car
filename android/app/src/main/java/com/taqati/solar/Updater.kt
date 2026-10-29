package com.taqati.solar

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** قواعد التحديث النقية (تُختبر باختبارات JVM). */
object UpdateRules {
    const val PREFIX = "https://github.com/Hussein199800/Car/releases/download/"
    const val MAX_BYTES = 150L * 1024 * 1024

    /** لا ننزّل إلا من صفحة إصدارات مستودع التطبيق نفسه */
    fun isAllowedUrl(url: String?): Boolean =
        url != null && url.startsWith(PREFIX) && !url.contains("..") && !url.contains('@') && url.endsWith(".apk", ignoreCase = true)

    /** null = الحزمة مقبولة، وإلا سبب الرفض بالعربية */
    fun reject(pkg: String?, expectedPkg: String, newCode: Long, curCode: Long, newSigs: Set<String>?, curSigs: Set<String>?): String? = when {
        pkg == null -> "الملف المحمّل ليس تطبيقاً صالحاً"
        pkg != expectedPkg -> "الملف المحمّل ليس تطبيق طاقتي"
        newCode <= curCode -> "النسخة المحمّلة ليست أحدث من المثبّتة"
        // إن تعذّرت قراءة التوقيع يتكفّل مثبّت أندرويد برفض أي توقيع مختلف
        newSigs != null && curSigs != null && newSigs.isNotEmpty() && newSigs != curSigs -> "توقيع التحديث لا يطابق التطبيق المثبّت"
        else -> null
    }
}

@CapacitorPlugin(name = "Updater")
class UpdaterPlugin : Plugin() {
    private val apk: File get() = File(File(context.cacheDir, "updates").apply { mkdirs() }, "taqati-update.apk")

    @PluginMethod
    fun download(call: PluginCall) {
        val url = call.getString("url")
        if (!UpdateRules.isAllowedUrl(url)) return call.reject("رابط تحديث غير مسموح")
        Thread {
            val tmp = File(apk.path + ".part")
            try {
                var conn = URL(url!!).openConnection() as HttpURLConnection
                // GitHub يحوّل إلى خادم الملفات؛ نتبع التحويلات عبر HTTPS فقط
                var hops = 0
                while (true) {
                    conn.connectTimeout = 20_000
                    conn.readTimeout = 30_000
                    conn.instanceFollowRedirects = false
                    val code = conn.responseCode
                    if (code in 300..399 && hops < 5) {
                        val next = conn.getHeaderField("Location") ?: break
                        conn.disconnect()
                        if (!next.startsWith("https://")) throw IllegalStateException("redirect")
                        conn = URL(next).openConnection() as HttpURLConnection
                        hops++
                        continue
                    }
                    break
                }
                if (conn.responseCode != 200) throw IllegalStateException("HTTP ${conn.responseCode}")
                val total = conn.contentLengthLong
                if (total > UpdateRules.MAX_BYTES) throw IllegalStateException("too big")
                var done = 0L
                var lastPct = -1
                conn.inputStream.use { input ->
                    tmp.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            done += n
                            if (done > UpdateRules.MAX_BYTES) throw IllegalStateException("too big")
                            val pct = if (total > 0) (done * 100 / total).toInt() else -1
                            if (pct != lastPct) {
                                lastPct = pct
                                notifyListeners("progress", JSObject().put("pct", pct).put("done", done))
                            }
                        }
                    }
                }
                conn.disconnect()
                apk.delete()
                tmp.renameTo(apk)
                val why = verify(context, apk)
                if (why != null) {
                    apk.delete()
                    call.reject(why)
                } else {
                    call.resolve(JSObject().put("ok", true))
                }
            } catch (e: Exception) {
                tmp.delete()
                call.reject("تعذّر تحميل التحديث، تحقق من الإنترنت وحاول مجدداً")
            }
        }.start()
    }

    @PluginMethod
    fun install(call: PluginCall) {
        val f = apk
        if (!f.exists()) return call.reject("حمّل التحديث أولاً")
        val why = verify(context, f)
        if (why != null) {
            f.delete()
            return call.reject(why)
        }
        // أندرويد 8+ يطلب إذناً صريحاً من المستخدم ليثبّت هذا التطبيق تحديثاته
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            activity.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return call.resolve(JSObject().put("status", "permission"))
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", f)
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(i)
        call.resolve(JSObject().put("status", "started"))
    }

    /** هل يوجد تحديث محمّل وصالح جاهز للتثبيت؟ */
    @PluginMethod
    fun status(call: PluginCall) {
        val f = apk
        val ready = f.exists() && verify(context, f) == null
        if (!ready) f.delete()
        call.resolve(JSObject().put("ready", ready))
    }

    companion object {
        @Suppress("DEPRECATION")
        private fun flags() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

        @Suppress("DEPRECATION")
        private fun code(p: PackageInfo): Long = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) p.longVersionCode else p.versionCode.toLong()

        @Suppress("DEPRECATION")
        private fun sigs(p: PackageInfo): Set<String>? {
            val raw = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) p.signingInfo?.apkContentsSigners else p.signatures
            return raw?.map { s -> MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) } }?.toSet()
        }

        fun verify(ctx: Context, f: File): String? {
            val pm = ctx.packageManager
            val archive = pm.getPackageArchiveInfo(f.path, flags())
            val installed = pm.getPackageInfo(ctx.packageName, flags())
            return UpdateRules.reject(
                archive?.packageName, ctx.packageName,
                archive?.let { code(it) } ?: 0, code(installed),
                archive?.let { sigs(it) }, sigs(installed),
            )
        }
    }
}
