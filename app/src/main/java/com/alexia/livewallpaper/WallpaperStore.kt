package com.alexia.livewallpaper

import android.content.ContentValues
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.media.MediaMetadataRetriever
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.io.File
import java.io.InputStream

/**
 * Uloženie tapiet. Všetko stiahnuté/vybrané ide do "Moja galéria"
 * (priečinok library v pamäti appky), aktuálna tapeta je jedna z nich.
 */
object WallpaperStore {
    private const val PREFS = "wallpaper"
    const val KEY_VERSION = "version"
    const val KEY_IS_VIDEO = "is_video"
    const val KEY_CURRENT = "current"
    const val KEY_MUTE = "mute"
    const val KEY_FILL = "fill"

    private const val EXT_VIDEO = "vid"
    private const val EXT_IMAGE = "img"

    class LocalItem(val file: File, val thumb: File, val isVideo: Boolean)

    fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun legacyFile(context: Context) = File(context.filesDir, "wallpaper_media")

    fun libraryDir(context: Context): File =
        File(context.filesDir, "library").apply { mkdirs() }

    /** Súbor aktuálnej tapety. */
    fun mediaFile(context: Context): File =
        prefs(context).getString(KEY_CURRENT, null)?.let { File(it) } ?: legacyFile(context)

    fun hasMedia(context: Context): Boolean {
        val f = mediaFile(context)
        return f.exists() && f.length() > 0
    }

    fun isVideo(context: Context): Boolean = prefs(context).getBoolean(KEY_IS_VIDEO, false)

    /** Všetko v "Moja galéria", najnovšie prvé. */
    fun library(context: Context): List<LocalItem> =
        (libraryDir(context).listFiles() ?: emptyArray())
            .filter { it.extension == EXT_VIDEO || it.extension == EXT_IMAGE }
            .sortedByDescending { it.name }
            .map { LocalItem(it, thumbFor(it), it.extension == EXT_VIDEO) }

    private fun thumbFor(f: File) = File(f.parentFile, f.nameWithoutExtension + ".jpg")

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

    /** Presunie hotový súbor do "Moja galéria" a nastaví ho ako aktuálnu tapetu. */
    fun commit(context: Context, temp: File, isVideo: Boolean): File {
        val ext = if (isVideo) EXT_VIDEO else EXT_IMAGE
        var stamp = System.currentTimeMillis()
        var target = File(libraryDir(context), "$stamp.$ext")
        while (target.exists() || File(libraryDir(context), "$stamp.jpg").exists()) {
            stamp++
            target = File(libraryDir(context), "$stamp.$ext")
        }
        if (!temp.renameTo(target)) {
            temp.copyTo(target, overwrite = true)
            temp.delete()
        }
        makeThumb(target, isVideo)
        select(context, target, isVideo)
        return target
    }

    fun select(context: Context, file: File, isVideo: Boolean) {
        prefs(context).edit()
            .putString(KEY_CURRENT, file.path)
            .putBoolean(KEY_IS_VIDEO, isVideo)
            .putLong(KEY_VERSION, System.currentTimeMillis())
            .apply()
    }

    fun delete(context: Context, item: LocalItem) {
        val wasCurrent = mediaFile(context).path == item.file.path
        item.file.delete()
        item.thumb.delete()
        if (wasCurrent) {
            prefs(context).edit()
                .remove(KEY_CURRENT)
                .putLong(KEY_VERSION, System.currentTimeMillis())
                .apply()
            legacyFile(context).delete()
        }
    }

    private fun makeThumb(file: File, isVideo: Boolean) {
        try {
            val bmp: Bitmap? = if (isVideo) {
                MediaMetadataRetriever().run {
                    try {
                        setDataSource(file.path)
                        getScaledFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 480, 480)
                            ?: frameAtTime
                    } finally { release() }
                }
            } else {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { dec, info, _ ->
                    dec.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    val s = 480f / maxOf(info.size.width, info.size.height)
                    if (s < 1f) dec.setTargetSize(
                        (info.size.width * s).toInt().coerceAtLeast(1),
                        (info.size.height * s).toInt().coerceAtLeast(1)
                    )
                }
            }
            bmp?.let { b -> thumbFor(file).outputStream().use { b.compress(Bitmap.CompressFormat.JPEG, 80, it) } }
        } catch (e: Exception) {
            Log.w("AlexiaTapeta", "Náhľad sa nepodaril", e)
        }
    }

    /** Uloží kópiu aj do galérie telefónu (Filmy/Obrázky → AlexiaTapeta). */
    fun saveToPhoneGallery(context: Context, file: File, isVideo: Boolean): Boolean {
        if (Build.VERSION.SDK_INT < 29) return false
        val mime = sniffMime(file) ?: if (isVideo) "video/mp4" else "image/gif"
        val ext = mime.substringAfter('/').replace("jpeg", "jpg")
        val name = "Alexia_${System.currentTimeMillis()}.$ext"
        val collection = if (isVideo) MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val folder = (if (isVideo) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES) + "/AlexiaTapeta"
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(collection, values) ?: return false
        return try {
            resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            true
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            false
        }
    }

    fun isVideoMime(mime: String?): Boolean = mime?.startsWith("video/") == true

    /** Rozpozná typ podľa prvých bajtov súboru. */
    fun sniffMime(file: File): String? {
        val head = ByteArray(12)
        val n = file.inputStream().use { it.read(head) }
        if (n < 12) return null
        val s = String(head, Charsets.ISO_8859_1)
        return when {
            s.startsWith("GIF8") -> "image/gif"
            s.startsWith("\u0089PNG") -> "image/png"
            s.startsWith("ÿØ") -> "image/jpeg"
            s.startsWith("RIFF") && s.substring(8, 12) == "WEBP" -> "image/webp"
            s.substring(4, 8) == "ftyp" -> "video/mp4"
            head[0] == 0x1A.toByte() && head[1] == 0x45.toByte() -> "video/webm"
            else -> null
        }
    }

    fun sniffIsVideo(file: File): Boolean? = sniffMime(file)?.startsWith("video/")

    private const val MAX_BYTES = 500L * 1024 * 1024
}
