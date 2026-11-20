package com.alexia.livewallpaper

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import org.json.JSONObject

/** Sťahovanie GIFov / videí z webu. */
object Downloader {
    const val USER_AGENT = "AlexiaLiveTapeta/1.0 (Android; github.com/havetkin-cyber/APK)"

    class Result(val file: File, val isVideo: Boolean)

    fun open(url: String): HttpURLConnection {
        var current = URL(url)
        repeat(6) {
            val c = current.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 15_000
            c.readTimeout = 30_000
            c.setRequestProperty("User-Agent", USER_AGENT)
            c.setRequestProperty("Accept", "*/*")
            val code = c.responseCode
            if (code in 300..399) {
                val loc = c.getHeaderField("Location") ?: throw IllegalStateException("Presmerovanie bez adresy")
                c.disconnect()
                current = URL(current, loc) // aj http -> https
            } else {
                if (code !in 200..299) {
                    c.disconnect()
                    throw IllegalStateException("Server vrátil chybu $code")
                }
                return c
            }
        }
        throw IllegalStateException("Priveľa presmerovaní")
    }

    /**
     * Stiahne priamy odkaz na GIF/video. Ak je odkaz na webovú stránku,
     * skúsi v nej nájsť video alebo GIF (og:video, <video src>, .gif/.mp4 odkazy).
     */
    private val MEDIA_EXT = Regex("""\.(gif|webp|mp4|webm|mkv|mov)(\?.*)?$""", RegexOption.IGNORE_CASE)

    /**
     * Univerzálne sťahovanie:
     *  1. priamy odkaz na súbor (.gif, .mp4, …) → stiahne priamo
     *  2. inak yt-dlp (TikTok, YouTube, Instagram, Reddit, X, …)
     *  3. ak yt-dlp zlyhá: TikTok cez tikwm.com, iné stránky hľadaním videa v HTML
     */
    fun download(context: Context, rawUrl: String, onProgress: (Int) -> Unit): Result {
        val url = normalize(rawUrl)
        val path = try { URL(url).path } catch (_: Exception) { "" }
        if (MEDIA_EXT.containsMatchIn(path)) return downloadDirect(context, url, onProgress)

        val ytError = try {
            return YtDlp.download(context, url, onProgress)
        } catch (e: Throwable) {
            e
        }
        return try {
            if (isTikTok(url)) downloadDirect(context, resolveTikTok(url), onProgress)
            else downloadDirect(context, url, onProgress)
        } catch (fallback: Exception) {
            throw IllegalStateException(ytError.message ?: fallback.message)
        }
    }

    private fun downloadDirect(context: Context, url: String, onProgress: (Int) -> Unit, depth: Int = 0): Result {
        val conn = open(url)
        val mime = conn.contentType?.substringBefore(';')?.trim()?.lowercase()

        if (mime == null || mime.startsWith("text/html") || mime.startsWith("application/xhtml")) {
            val html = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
            conn.disconnect()
            if (depth > 1) throw IllegalStateException("Na stránke som nenašiel video ani GIF")
            val found = findMediaInHtml(html, conn.url.toString())
                ?: throw IllegalStateException("Na stránke som nenašiel video ani GIF. Skús priamy odkaz.")
            return downloadDirect(context, found, onProgress, depth + 1)
        }

        val temp = try {
            WallpaperStore.copyToTemp(context, conn.inputStream, conn.contentLengthLong, onProgress)
        } finally {
            conn.disconnect()
        }
        val isVideo = WallpaperStore.sniffIsVideo(temp)
            ?: when {
                mime.startsWith("video/") -> true
                mime.startsWith("image/") -> false
                else -> { temp.delete(); throw IllegalStateException("Nepodporovaný typ súboru ($mime)") }
            }
        return Result(temp, isVideo)
    }

    private fun isTikTok(url: String): Boolean {
        val host = try { URL(url).host.lowercase() } catch (_: Exception) { return false }
        return host == "tiktok.com" || host.endsWith(".tiktok.com")
    }

    /**
     * TikTok stránky video priamo neobsahujú, preto použijeme verejnú
     * službu tikwm.com, ktorá vráti priamy odkaz na MP4 (bez vodoznaku).
     */
    private fun resolveTikTok(url: String): String {
        val api = "https://www.tikwm.com/api/?hd=1&url=" + URLEncoder.encode(url, "UTF-8")
        val conn = open(api)
        val body = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        conn.disconnect()
        val json = JSONObject(body)
        if (json.optInt("code", -1) != 0) {
            throw IllegalStateException("TikTok video sa nepodarilo nájsť (" + json.optString("msg") + ")")
        }
        val data = json.getJSONObject("data")
        val play = listOf("hdplay", "play", "wmplay")
            .map { data.optString(it) }
            .firstOrNull { it.isNotBlank() }
        if (play != null) return absolutize(play)
        // fotkový príspevok – zoberieme prvý obrázok
        val images = data.optJSONArray("images")
        if (images != null && images.length() > 0) return absolutize(images.getString(0))
        throw IllegalStateException("V TikTok príspevku nie je video")
    }

    private fun absolutize(u: String) = if (u.startsWith("/")) "https://www.tikwm.com$u" else u

    private fun normalize(raw: String): String {
        val t = raw.trim()
        return if (t.startsWith("http://") || t.startsWith("https://")) t else "https://$t"
    }

    private fun findMediaInHtml(html: String, base: String): String? {
        val patterns = listOf(
            Regex("""<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)""", RegexOption.IGNORE_CASE),
            Regex("""<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url|:url)?["']""", RegexOption.IGNORE_CASE),
            Regex("""<(?:video|source)[^>]+src=["']([^"']+)""", RegexOption.IGNORE_CASE),
            Regex("""(https?:)?//[^"'\s<>]+\.(?:mp4|webm|gif)(?:\?[^"'\s<>]*)?""", RegexOption.IGNORE_CASE),
            Regex("""<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+\.gif[^"']*)""", RegexOption.IGNORE_CASE),
        )
        for (p in patterns) {
            val m = p.find(html) ?: continue
            val link = (m.groups[1]?.value?.takeIf { !it.endsWith(":") } ?: m.value)
                .replace("&amp;", "&")
            return try { URL(URL(base), link).toString() } catch (_: Exception) { null }
        }
        return null
    }
}
