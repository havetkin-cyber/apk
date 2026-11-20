package com.alexia.livewallpaper

import android.content.Context
import android.media.MediaCodecList
import android.media.MediaFormat
import android.util.Log
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File

/**
 * Univerzálne sťahovanie cez yt-dlp (TikTok, YouTube, Instagram, Reddit,
 * X/Twitter, Facebook… 1000+ stránok). yt-dlp sa sám aktualizuje
 * z GitHubu (yt-dlp/yt-dlp), keď vyjde nová verzia.
 */
object YtDlp {
    private const val TAG = "AlexiaYtDlp"
    private const val KEY_LAST_UPDATE = "ytdlp_last_update"
    private const val UPDATE_EVERY_MS = 6L * 60 * 60 * 1000

    @Volatile private var initialized = false

    @Synchronized
    fun init(context: Context) {
        if (initialized) return
        YoutubeDL.getInstance().init(context.applicationContext)
        initialized = true
    }

    /** Vráti novú verziu, ak sa yt-dlp práve aktualizoval, inak null. */
    fun autoUpdate(context: Context, force: Boolean = false): String? {
        val prefs = WallpaperStore.prefs(context)
        val now = System.currentTimeMillis()
        if (!force && now - prefs.getLong(KEY_LAST_UPDATE, 0) < UPDATE_EVERY_MS) return null
        return try {
            init(context)
            val status = YoutubeDL.getInstance()
                .updateYoutubeDL(context.applicationContext, YoutubeDL.UpdateChannel.STABLE)
            prefs.edit().putLong(KEY_LAST_UPDATE, now).apply()
            if (status == YoutubeDL.UpdateStatus.DONE) version(context) else null
        } catch (e: Throwable) {
            Log.w(TAG, "Aktualizácia yt-dlp zlyhala", e)
            null
        }
    }

    fun version(context: Context): String? = try {
        init(context)
        YoutubeDL.getInstance().version(context.applicationContext)
    } catch (e: Throwable) { null }

    fun download(context: Context, url: String, onProgress: (Int) -> Unit): Downloader.Result {
        init(context)
        val dir = File(context.cacheDir, "ytdlp_${System.nanoTime()}").apply { mkdirs() }
        val l = VideoCaps.maxLongSide(context)
        // Len obraz bez zvuku = jeden súbor, netreba FFmpeg na spájanie.
        // Najprv kodeky, ktoré Android prehrá najistejšie.
        val format = listOf(
            "bv*[vcodec^=avc][height<=$l][width<=$l]",
            "bv*[vcodec^=vp9][height<=$l][width<=$l]",
            "bv*[vcodec^=vp09][height<=$l][width<=$l]",
            "bv*[vcodec^=hev][height<=$l][width<=$l]",
            "bv*[height<=$l][width<=$l]",
            "b[height<=$l][width<=$l]",
            "b"
        ).joinToString("/")

        val request = YoutubeDLRequest(url).apply {
            addOption("-f", format)
            addOption("-o", dir.absolutePath + "/media.%(ext)s")
            addOption("--no-playlist")
            addOption("--no-mtime")
            addOption("--max-filesize", "500M")
        }
        try {
            YoutubeDL.getInstance().execute(request, null) { progress, _, _ ->
                onProgress(progress.toInt().coerceIn(0, 100))
            }
        } catch (e: Throwable) {
            dir.deleteRecursively()
            val msg = e.message?.lineSequence()?.lastOrNull { it.contains("ERROR") } ?: e.message
            throw IllegalStateException(msg ?: "yt-dlp zlyhal")
        }
        val file = dir.listFiles()
            ?.filter { it.isFile && it.length() > 0 && !it.name.endsWith(".part") }
            ?.maxByOrNull { it.length() }
            ?: run { dir.deleteRecursively(); throw IllegalStateException("yt-dlp nič nestiahol") }
        val isVideo = WallpaperStore.sniffIsVideo(file) ?: true
        return Downloader.Result(file, isVideo)
    }
}

/** Aké veľké video telefón zvládne plynulo prehrať. */
object VideoCaps {
    @Volatile private var cached = 0

    /** Kratšia strana: 2160 / 1440 / 1080. */
    fun maxShortSide(): Int {
        if (cached != 0) return cached
        val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        fun ok(w: Int, h: Int) = listOf(MediaFormat.MIMETYPE_VIDEO_VP9, MediaFormat.MIMETYPE_VIDEO_AVC).any { m ->
            list.codecInfos.any { ci ->
                !ci.isEncoder && ci.supportedTypes.any { it.equals(m, true) } && try {
                    ci.getCapabilitiesForType(m).videoCapabilities.areSizeAndRateSupported(w, h, 30.0)
                } catch (_: Exception) { false }
            }
        }
        cached = when {
            ok(3840, 2160) -> 2160
            ok(2560, 1440) -> 1440
            else -> 1080
        }
        return cached
    }

    /** Dlhšia strana pre filter yt-dlp (výška aj šírka). */
    fun maxLongSide(@Suppress("UNUSED_PARAMETER") context: Context): Int = when (maxShortSide()) {
        2160 -> 3840
        1440 -> 2560
        else -> 1920
    }
}
