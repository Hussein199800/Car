package com.taqati.solar

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * تخزين مشفّر لبيانات الجلسة (الرمز والسر وبصمة كلمة المرور).
 * المفتاح يُولَّد داخل Android Keystore ولا يمكن استخراجه من الجهاز، والقيم تُشفّر بـ AES-256-GCM.
 */
object SecureStore {
    private const val KEY_ALIAS = "taqati_secure_v1"
    private const val PREFS = "taqati_secure"
    private const val TAG_BITS = 128

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun put(ctx: Context, name: String, value: String?) {
        if (value == null) {
            remove(ctx, name)
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val packed = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
        prefs(ctx).edit().putString(name, packed).apply()
    }

    fun get(ctx: Context, name: String): String? {
        val packed = prefs(ctx).getString(name, null) ?: return null
        return try {
            val (iv, ct) = packed.split(":", limit = 2).map { Base64.decode(it, Base64.NO_WRAP) }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (e: Exception) {
            // مفتاح أُبطل (مثلاً بعد استعادة نسخة احتياطية على جهاز آخر): نحذف القيمة ويطلب التطبيق الدخول مجدداً
            remove(ctx, name)
            null
        }
    }

    fun remove(ctx: Context, name: String) {
        prefs(ctx).edit().remove(name).apply()
    }
}
