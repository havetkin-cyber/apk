package com.alexia.livewallpaper

import android.content.SharedPreferences
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.drawable.Animatable
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.Drawable
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.util.Log
import android.view.SurfaceHolder
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Živá tapeta: prehráva video (MediaPlayer) alebo animovaný GIF/WebP. */
class LiveWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = MediaEngine()

    inner class MediaEngine : Engine(), SharedPreferences.OnSharedPreferenceChangeListener {
        private val handler = Handler(Looper.getMainLooper())
        private val decoder = Executors.newSingleThreadExecutor()
        private val prefs = WallpaperStore.prefs(this@LiveWallpaperService)

        private var player: MediaPlayer? = null
        private var drawable: Drawable? = null
        private var surfaceReady = false
        private var isVisibleNow = false
        private var surfaceW = 0
        private var surfaceH = 0
        private var loadedVersion = Long.MIN_VALUE
        private var loadToken = 0

        private val frameLoop = object : Runnable {
            override fun run() {
                drawFrame()
                if (isVisibleNow && drawable is Animatable) handler.postDelayed(this, FRAME_MS)
            }
        }

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            setTouchEventsEnabled(false)
            prefs.registerOnSharedPreferenceChangeListener(this)
        }

        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            surfaceReady = true
            load()
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            surfaceW = width
            surfaceH = height
            layoutDrawable()
            drawFrame()
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            surfaceReady = false
            releaseAll()
            super.onSurfaceDestroyed(holder)
        }

        override fun onVisibilityChanged(visible: Boolean) {
            isVisibleNow = visible
            if (visible) {
                if (loadedVersion != prefs.getLong(WallpaperStore.KEY_VERSION, 0)) load() else resume()
            } else {
                pause()
            }
        }

        override fun onDestroy() {
            prefs.unregisterOnSharedPreferenceChangeListener(this)
            releaseAll()
            decoder.shutdownNow()
            super.onDestroy()
        }

        override fun onSharedPreferenceChanged(p: SharedPreferences?, key: String?) {
            handler.post {
                if (!surfaceReady) return@post
                when (key) {
                    WallpaperStore.KEY_MUTE -> applyVolume()
                    WallpaperStore.KEY_FILL -> { applyVideoScaling(); layoutDrawable(); drawFrame() }
                    WallpaperStore.KEY_VERSION -> if (isVisibleNow) load()
                }
            }
        }

        // ---------- načítanie ----------

        private fun load() {
            if (!surfaceReady) return
            releaseAll()
            val ctx = this@LiveWallpaperService
            loadedVersion = prefs.getLong(WallpaperStore.KEY_VERSION, 0)
            if (!WallpaperStore.hasMedia(ctx)) return
            if (WallpaperStore.isVideo(ctx)) loadVideo() else loadImage()
        }

        private fun loadVideo() {
            val file = WallpaperStore.mediaFile(this@LiveWallpaperService)
            val mp = MediaPlayer()
            player = mp
            try {
                mp.setSurface(surfaceHolder.surface)
                mp.setDataSource(file.path)
                mp.isLooping = true
                mp.setOnPreparedListener {
                    applyVideoScaling()
                    applyVolume()
                    if (isVisibleNow) it.start()
                }
                mp.setOnErrorListener { _, what, extra ->
                    Log.e(TAG, "MediaPlayer chyba $what/$extra")
                    true
                }
                mp.prepareAsync()
            } catch (e: Exception) {
                Log.e(TAG, "Video sa nepodarilo spustiť", e)
                mp.release()
                player = null
            }
        }

        private fun loadImage() {
            val token = ++loadToken
            val file = WallpaperStore.mediaFile(this@LiveWallpaperService)
            decoder.execute {
                val d = try {
                    ImageDecoder.decodeDrawable(ImageDecoder.createSource(file)) { dec, info, _ ->
                        // obmedzenie veľkosti, aby obrovský GIF nezabil pamäť
                        val maxSide = 2160
                        val big = max(info.size.width, info.size.height)
                        if (big > maxSide) {
                            val s = maxSide.toFloat() / big
                            dec.setTargetSize(
                                (info.size.width * s).roundToInt().coerceAtLeast(1),
                                (info.size.height * s).roundToInt().coerceAtLeast(1)
                            )
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Obrázok sa nepodarilo dekódovať", e)
                    null
                }
                handler.post {
                    if (token != loadToken || !surfaceReady) return@post
                    drawable = d
                    if (d is AnimatedImageDrawable) {
                        d.repeatCount = AnimatedImageDrawable.REPEAT_INFINITE
                        d.start()
                    }
                    layoutDrawable()
                    resume()
                    drawFrame()
                }
            }
        }

        // ---------- prehrávanie ----------

        private fun resume() {
            player?.let { if (!it.isPlaying) try { it.start() } catch (_: IllegalStateException) {} }
            (drawable as? Animatable)?.start()
            handler.removeCallbacks(frameLoop)
            if (drawable != null) handler.post(frameLoop)
        }

        private fun pause() {
            player?.let { if (it.isPlaying) try { it.pause() } catch (_: IllegalStateException) {} }
            (drawable as? Animatable)?.stop()
            handler.removeCallbacks(frameLoop)
        }

        private fun releaseAll() {
            loadToken++
            handler.removeCallbacks(frameLoop)
            player?.release()
            player = null
            (drawable as? Animatable)?.stop()
            drawable = null
        }

        private fun applyVolume() {
            val muted = prefs.getBoolean(WallpaperStore.KEY_MUTE, true)
            val v = if (muted) 0f else 1f
            try { player?.setVolume(v, v) } catch (_: IllegalStateException) {}
        }

        private fun applyVideoScaling() {
            val fill = prefs.getBoolean(WallpaperStore.KEY_FILL, true)
            val mode = if (fill) MediaPlayer.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
            else MediaPlayer.VIDEO_SCALING_MODE_SCALE_TO_FIT
            try { player?.setVideoScalingMode(mode) } catch (_: IllegalStateException) {}
        }

        // ---------- kreslenie GIFu ----------

        private fun layoutDrawable() {
            val d = drawable ?: return
            if (surfaceW == 0 || surfaceH == 0) return
            val iw = d.intrinsicWidth.takeIf { it > 0 } ?: surfaceW
            val ih = d.intrinsicHeight.takeIf { it > 0 } ?: surfaceH
            val fill = prefs.getBoolean(WallpaperStore.KEY_FILL, true)
            val sx = surfaceW.toFloat() / iw
            val sy = surfaceH.toFloat() / ih
            val s = if (fill) max(sx, sy) else min(sx, sy)
            val w = (iw * s).roundToInt()
            val h = (ih * s).roundToInt()
            val left = (surfaceW - w) / 2
            val top = (surfaceH - h) / 2
            d.setBounds(left, top, left + w, top + h)
        }

        private fun drawFrame() {
            val d = drawable ?: return
            if (!surfaceReady) return
            withCanvas { c ->
                c.drawColor(Color.BLACK)
                d.draw(c)
            }
        }

        private inline fun withCanvas(block: (Canvas) -> Unit) {
            val holder = surfaceHolder
            var canvas: Canvas? = null
            try {
                canvas = holder.lockHardwareCanvas()
                if (canvas != null) block(canvas)
            } catch (e: Exception) {
                Log.w(TAG, "Kreslenie zlyhalo", e)
            } finally {
                if (canvas != null) try { holder.unlockCanvasAndPost(canvas) } catch (_: Exception) {}
            }
        }
    }

    companion object {
        private const val TAG = "AlexiaTapeta"
        private const val FRAME_MS = 20L
    }
}
