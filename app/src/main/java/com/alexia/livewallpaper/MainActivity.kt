package com.alexia.livewallpaper

import android.app.Activity
import android.app.AlertDialog
import android.app.WallpaperManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import java.io.File
import java.util.concurrent.Executors

class MainActivity : Activity() {

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    private lateinit var previewImage: ImageView
    private lateinit var previewVideo: VideoView
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private lateinit var urlInput: EditText
    private lateinit var applyBtn: Button
    private lateinit var downloadBtn: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        previewImage = findViewById(R.id.previewImage)
        previewVideo = findViewById(R.id.previewVideo)
        status = findViewById(R.id.status)
        progress = findViewById(R.id.progress)
        urlInput = findViewById(R.id.url)
        applyBtn = findViewById(R.id.apply)
        downloadBtn = findViewById(R.id.download)

        val prefs = WallpaperStore.prefs(this)
        findViewById<CheckBox>(R.id.mute).apply {
            isChecked = prefs.getBoolean(WallpaperStore.KEY_MUTE, true)
            setOnCheckedChangeListener { _, c -> prefs.edit().putBoolean(WallpaperStore.KEY_MUTE, c).apply() }
        }
        findViewById<CheckBox>(R.id.fill).apply {
            isChecked = prefs.getBoolean(WallpaperStore.KEY_FILL, true)
            setOnCheckedChangeListener { _, c ->
                prefs.edit().putBoolean(WallpaperStore.KEY_FILL, c).apply()
                previewImage.scaleType = if (c) ImageView.ScaleType.CENTER_CROP else ImageView.ScaleType.FIT_CENTER
            }
            previewImage.scaleType = if (isChecked) ImageView.ScaleType.CENTER_CROP else ImageView.ScaleType.FIT_CENTER
        }

        findViewById<Button>(R.id.pick).setOnClickListener { pickFile() }
        findViewById<Button>(R.id.gallery).setOnClickListener {
            startActivityForResult(Intent(this, GalleryActivity::class.java), REQ_GALLERY)
        }
        findViewById<Button>(R.id.favorites).setOnClickListener { showFavorites() }
        downloadBtn.setOnClickListener { startDownload(urlInput.text.toString()) }
        urlInput.setOnEditorActionListener { _, id, _ ->
            if (id == EditorInfo.IME_ACTION_GO) { startDownload(urlInput.text.toString()); true } else false
        }
        applyBtn.setOnClickListener { openWallpaperChooser() }

        showCurrent()
        handleShare(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }

    // ---------- vstupy ----------

    private fun pickFile() {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/gif", "image/webp", "image/*", "video/*"))
        }
        startActivityForResult(i, REQ_PICK)
    }

    @Suppress("DEPRECATION")
    private fun handleShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        val uri: Uri? = if (Build.VERSION.SDK_INT >= 33)
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_STREAM)
        when {
            uri != null -> importUri(uri)
            !text.isNullOrBlank() -> {
                val link = Regex("""https?://\S+""").find(text)?.value ?: text
                urlInput.setText(link)
                startDownload(link)
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK || data == null) return
        when (requestCode) {
            REQ_PICK -> data.data?.let { importUri(it) }
            REQ_GALLERY -> data.getStringExtra(GalleryActivity.EXTRA_URL)?.let { startDownload(it) }
        }
    }

    private fun importUri(uri: Uri) {
        setBusy(true, getString(R.string.loading))
        io.execute {
            try {
                val mime = contentResolver.getType(uri)
                val input = contentResolver.openInputStream(uri) ?: throw IllegalStateException("Súbor sa nedá otvoriť")
                val temp = WallpaperStore.copyToTemp(this, input)
                val isVideo = WallpaperStore.sniffIsVideo(temp) ?: WallpaperStore.isVideoMime(mime)
                WallpaperStore.commit(this, temp, isVideo)
                main.post { setBusy(false, null); showCurrent() }
            } catch (e: Exception) {
                main.post { setBusy(false, null); toast(getString(R.string.error) + ": " + e.message) }
            }
        }
    }

    private fun startDownload(url: String) {
        if (url.isBlank()) return
        setBusy(true, getString(R.string.downloading, 0))
        progress.isIndeterminate = true
        io.execute {
            try {
                val r = Downloader.download(this, url) { pct ->
                    main.post {
                        progress.isIndeterminate = false
                        progress.progress = pct
                        status.text = getString(R.string.downloading, pct)
                    }
                }
                WallpaperStore.commit(this, r.file, r.isVideo)
                rememberLink(url.trim())
                main.post { setBusy(false, null); showCurrent() }
            } catch (e: Exception) {
                main.post {
                    setBusy(false, null)
                    showCurrent()
                    toast(getString(R.string.download_failed, e.message ?: e.javaClass.simpleName))
                }
            }
        }
    }

    // ---------- obľúbené odkazy (TikTok a pod.) ----------

    private fun favoriteLinks(): List<String> {
        val saved = WallpaperStore.prefs(this).getString(KEY_LINKS, null)
            ?.split('\n')?.filter { it.isNotBlank() }
        return saved ?: resources.getStringArray(R.array.default_links).toList()
    }

    private fun saveLinks(links: List<String>) {
        WallpaperStore.prefs(this).edit().putString(KEY_LINKS, links.joinToString("\n")).apply()
    }

    private fun rememberLink(url: String) {
        if (url.isBlank()) return
        val links = favoriteLinks().toMutableList()
        links.remove(url)
        links.add(0, url)
        saveLinks(links.take(50))
    }

    private fun showFavorites() {
        val links = favoriteLinks()
        if (links.isEmpty()) { toast("Zoznam je prázdny"); return }
        AlertDialog.Builder(this)
            .setTitle(R.string.favorites)
            .setItems(links.toTypedArray()) { _, which ->
                urlInput.setText(links[which])
                startDownload(links[which])
            }
            .setNeutralButton("Vymazať zoznam") { _, _ -> saveLinks(emptyList()) }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    // ---------- náhľad ----------

    private fun setBusy(busy: Boolean, text: String?) {
        progress.visibility = if (busy) View.VISIBLE else View.GONE
        downloadBtn.isEnabled = !busy
        applyBtn.isEnabled = !busy && WallpaperStore.hasMedia(this)
        if (text != null) {
            status.visibility = View.VISIBLE
            status.text = text
        }
    }

    private fun showCurrent() {
        previewVideo.stopPlayback()
        previewVideo.visibility = View.GONE
        previewImage.setImageDrawable(null)
        previewImage.visibility = View.GONE

        val file = WallpaperStore.mediaFile(this)
        if (!WallpaperStore.hasMedia(this)) {
            status.visibility = View.VISIBLE
            status.setText(R.string.empty)
            applyBtn.isEnabled = false
            return
        }
        applyBtn.isEnabled = true
        status.visibility = View.GONE
        if (WallpaperStore.isVideo(this)) showVideo(file) else showImage(file)
    }

    private fun showVideo(file: File) {
        previewVideo.visibility = View.VISIBLE
        previewVideo.setVideoPath(file.path)
        previewVideo.setOnPreparedListener { mp ->
            mp.isLooping = true
            mp.setVolume(0f, 0f)
            previewVideo.start()
        }
        previewVideo.setOnErrorListener { _, _, _ ->
            status.visibility = View.VISIBLE
            status.text = getString(R.string.error) + " (formát videa nie je podporovaný)"
            true
        }
        toast(getString(R.string.ready_video))
    }

    private fun showImage(file: File) {
        io.execute {
            val d = try {
                ImageDecoder.decodeDrawable(ImageDecoder.createSource(file)) { dec, info, _ ->
                    val big = maxOf(info.size.width, info.size.height)
                    if (big > 1080) {
                        val s = 1080f / big
                        dec.setTargetSize(
                            (info.size.width * s).toInt().coerceAtLeast(1),
                            (info.size.height * s).toInt().coerceAtLeast(1)
                        )
                    }
                }
            } catch (e: Exception) { null }
            main.post {
                if (d == null) {
                    status.visibility = View.VISIBLE
                    status.setText(R.string.error)
                    return@post
                }
                previewImage.visibility = View.VISIBLE
                previewImage.setImageDrawable(d)
                (d as? AnimatedImageDrawable)?.start()
                toast(getString(R.string.ready_image))
            }
        }
    }

    // ---------- nastavenie tapety ----------

    private fun openWallpaperChooser() {
        val component = ComponentName(this, LiveWallpaperService::class.java)
        val direct = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
            .putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
        try {
            startActivity(direct)
        } catch (e: ActivityNotFoundException) {
            try {
                startActivity(Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER))
            } catch (e2: ActivityNotFoundException) {
                toast(getString(R.string.no_chooser))
            }
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    companion object {
        private const val REQ_PICK = 1
        private const val REQ_GALLERY = 2
        private const val KEY_LINKS = "links"
    }
}
