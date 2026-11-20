package com.alexia.livewallpaper

import android.content.Context
import android.content.SharedPreferences
import java.io.File
import java.io.InputStream

/** Uloženie vybranej tapety (súbor v pamäti appky + nastavenia). */
object WallpaperStore {
    private const val PREFS = "wallpaper"
    const val KEY_VERSION = "version"
    const val KEY_IS_VIDEO = "is_video"
    const val KEY_MUTE = "mute"
    const val KEY_FILL = "fill"

    fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun mediaFile(context: Context): File = File(context.filesDir, "wallpaper_media")

    fun hasMedia(context: Context): Boolean =
        mediaFile(context).exists() && mediaFile(context).length() > 0

    fun isVideo(context: Context): Boolean = prefs(context).getBoolean(KEY_IS_VIDEO, false)

    /** Prázdny dočasný súbor na sťahovanie / kopírovanie. */
    fun tempFile(context: Context): File =
        File(context.cacheDir, "incoming_${System.nanoTime()}").also { it.delete() }

    /** Skopíruje stream do dočasného súboru (s priebehom). */
    fun copyToTemp(
        context: Context,
        input: InputStream,
        totalBytes: Long = -1,
        onProgress: ((Int) -> Unit)? = null
    ): File {
        val temp = tempFile(context)
        input.use { src ->
            temp.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                var done = 0L
                var lastPct = -1
                while (true) {
                    val n = src.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    if (done > MAX_BYTES) throw IllegalStateException("Súbor je väčší ako 500 MB")
                    if (totalBytes > 0 && onProgress != null) {
                        val pct = (done * 100 / totalBytes).toInt()
                        if (pct != lastPct) { lastPct = pct; onProgress(pct) }
                    }
                }
            }
        }
        return temp
    }

    /** Presunie hotový dočasný súbor na miesto tapety a upozorní tapetu. */
    fun commit(context: Context, temp: File, isVideo: Boolean) {
        val target = mediaFile(context)
        if (!temp.renameTo(target)) {
            temp.copyTo(target, overwrite = true)
            temp.delete()
        }
        prefs(context).edit()
            .putBoolean(KEY_IS_VIDEO, isVideo)
            .putLong(KEY_VERSION, System.currentTimeMillis())
            .apply()
    }

    fun isVideoMime(mime: String?): Boolean = mime?.startsWith("video/") == true

    /** Rozpozná typ podľa prvých bajtov súboru (keď server klame o Content-Type). */
    fun sniffIsVideo(file: File): Boolean? {
        val head = ByteArray(12)
        val n = file.inputStream().use { it.read(head) }
        if (n < 12) return null
        val s = String(head, Charsets.ISO_8859_1)
        return when {
            s.startsWith("GIF8") -> false
            s.startsWith("\u0089PNG") -> false
            s.startsWith("ÿØ") -> false
            s.startsWith("RIFF") && s.substring(8, 12) == "WEBP" -> false
            s.substring(4, 8) == "ftyp" -> true
            head[0] == 0x1A.toByte() && head[1] == 0x45.toByte() -> true // WebM / MKV
            else -> null
        }
    }

    private const val MAX_BYTES = 500L * 1024 * 1024
}
