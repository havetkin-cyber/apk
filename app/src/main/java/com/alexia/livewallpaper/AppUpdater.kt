package com.alexia.livewallpaper

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

/**
 * Kontrola novej verzie appky v GitHub Releases (havetkin-cyber/APK)
 * a jej stiahnutie + inštalácia.
 */
object AppUpdater {
    private const val API = "https://api.github.com/repos/havetkin-cyber/apk/releases/latest"
    private const val KEY_LAST_CHECK = "app_last_update_check"
    private const val CHECK_EVERY_MS = 6L * 60 * 60 * 1000

    class Release(val version: String, val apkUrl: String, val sizeBytes: Long, val notes: String)

    fun currentVersion(context: Context): String =
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"

    /** Či je čas na automatickú kontrolu (max. raz za 6 h). */
    fun shouldAutoCheck(context: Context): Boolean {
        val prefs = WallpaperStore.prefs(context)
        val now = System.currentTimeMillis()
        if (now - prefs.getLong(KEY_LAST_CHECK, 0) < CHECK_EVERY_MS) return false
        prefs.edit().putLong(KEY_LAST_CHECK, now).apply()
        return true
    }

    /** Vráti novšiu verziu, alebo null, ak je appka aktuálna. */
    fun check(context: Context): Release? {
        val conn = Downloader.open(API)
        val body = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        conn.disconnect()
        val json = JSONObject(body)
        val version = json.optString("tag_name").removePrefix("v")
        if (!isNewer(version, currentVersion(context))) return null
        val assets = json.optJSONArray("assets") ?: return null
        for (i in 0 until assets.length()) {
            val a = assets.getJSONObject(i)
            if (a.optString("name").endsWith(".apk")) {
                return Release(version, a.optString("browser_download_url"), a.optLong("size"), json.optString("body"))
            }
        }
        return null
    }

    fun isNewer(remote: String, local: String): Boolean {
        val r = remote.split('.').map { it.toIntOrNull() ?: 0 }
        val l = local.split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(r.size, l.size)) {
            val a = r.getOrElse(i) { 0 }
            val b = l.getOrElse(i) { 0 }
            if (a != b) return a > b
        }
        return false
    }

    /** Stiahne APK do cache. */
    fun download(context: Context, release: Release, onProgress: (Int) -> Unit): File {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val conn = Downloader.open(release.apkUrl)
        val temp = try {
            WallpaperStore.copyToTemp(context, conn.inputStream, conn.contentLengthLong.takeIf { it > 0 } ?: release.sizeBytes, onProgress)
        } finally {
            conn.disconnect()
        }
        val apk = File(dir, "AlexiaLiveTapeta-${release.version}.apk")
        if (!temp.renameTo(apk)) { temp.copyTo(apk, true); temp.delete() }
        return apk
    }

    /** Spustí inštaláciu. Vráti false, ak treba najprv povoliť inštaláciu z tejto appky. */
    fun install(context: Context, apk: File): Boolean {
        if (!context.packageManager.canRequestPackageInstalls()) {
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            return false
        }
        val uri = FileProvider.getUriForFile(context, context.packageName + ".updates", apk)
        context.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        return true
    }
}
