package com.alexia.livewallpaper

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.AbsListView
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridView
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * Galéria: "Moje stiahnuté" (všetko stiahnuté z TikToku/webu) +
 * voľne licencované 4K videá a GIFy z Wikimedia Commons.
 */
class GalleryActivity : Activity() {

    class Item(
        val label: String,
        val thumb: String?,          // URL alebo cesta k súboru
        val url: String? = null,     // na stiahnutie
        val local: WallpaperStore.LocalItem? = null
    )

    private val net = Executors.newFixedThreadPool(4)
    private val main = Handler(Looper.getMainLooper())
    private val thumbs = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }

    private val items = ArrayList<Item>()
    private lateinit var adapter: ItemAdapter
    private lateinit var info: TextView
    private lateinit var spinner: ProgressBar
    private lateinit var searchBox: EditText

    private var currentQuery: String? = null   // null = Moje stiahnuté
    private var nextOffset: Int? = null
    private var loading = false
    private var requestId = 0

    /** Najväčšie video (kratšia strana), ktoré tento telefón plynulo prehrá. */
    private val maxShortSide: Int by lazy { VideoCaps.maxShortSide() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        if (WallpaperStore.library(this).isNotEmpty()) showLocal() else search(PRESETS[0].second)
    }

    override fun onDestroy() {
        net.shutdownNow()
        super.onDestroy()
    }

    // ---------- UI ----------

    private fun dp(v: Int) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics
    ).toInt()

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(getColor(R.color.bg))
            fitsSystemWindows = true
            setPadding(dp(12), dp(12), dp(12), 0)
        }

        root.addView(TextView(this).apply {
            text = getString(R.string.gallery)
            setTextColor(Color.WHITE)
            textSize = 22f
        })
        root.addView(TextView(this).apply {
            text = getString(R.string.gallery_note)
            setTextColor(getColor(R.color.text_dim))
            textSize = 12f
        })

        val searchRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        searchBox = EditText(this).apply {
            hint = getString(R.string.search_hint)
            setTextColor(Color.WHITE)
            setHintTextColor(getColor(R.color.text_dim))
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setOnEditorActionListener { _, id, _ ->
                if (id == EditorInfo.IME_ACTION_SEARCH) { searchText(); true } else false
            }
        }
        searchRow.addView(searchBox, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        searchRow.addView(Button(this).apply {
            text = getString(R.string.search)
            setOnClickListener { searchText() }
        })
        root.addView(searchRow)

        val chips = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        chips.addView(Button(this).apply {
            text = getString(R.string.my_gallery)
            isAllCaps = false
            setTextColor(getColor(R.color.accent))
            setOnClickListener { showLocal() }
        })
        for ((label, query) in PRESETS) {
            chips.addView(Button(this).apply {
                text = label
                isAllCaps = false
                setOnClickListener { search(query) }
            })
        }
        root.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(chips)
        })

        val status = FrameLayout(this)
        info = TextView(this).apply {
            setTextColor(getColor(R.color.text_dim))
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, dp(4))
        }
        spinner = ProgressBar(this).apply { visibility = View.GONE }
        status.addView(info, FrameLayout.LayoutParams(-1, -2))
        status.addView(spinner, FrameLayout.LayoutParams(dp(32), dp(32), Gravity.CENTER))
        root.addView(status)

        adapter = ItemAdapter()
        val grid = GridView(this).apply {
            numColumns = 2
            horizontalSpacing = dp(8)
            verticalSpacing = dp(8)
            adapter = this@GalleryActivity.adapter
            setOnItemClickListener { _, _, pos, _ -> choose(items[pos]) }
            setOnItemLongClickListener { _, _, pos, _ ->
                val local = items[pos].local ?: return@setOnItemLongClickListener false
                AlertDialog.Builder(this@GalleryActivity)
                    .setMessage(R.string.delete_q)
                    .setPositiveButton(R.string.delete) { _, _ ->
                        WallpaperStore.delete(this@GalleryActivity, local)
                        showLocal()
                    }
                    .setNegativeButton(android.R.string.cancel, null)
                    .show()
                true
            }
            setOnScrollListener(object : AbsListView.OnScrollListener {
                override fun onScrollStateChanged(view: AbsListView?, scrollState: Int) {}
                override fun onScroll(v: AbsListView?, first: Int, visible: Int, total: Int) {
                    if (total > 0 && first + visible >= total - 4) loadMore()
                }
            })
        }
        root.addView(grid, LinearLayout.LayoutParams(-1, 0, 1f))
        return root
    }

    private fun choose(item: Item) {
        val data = Intent()
        val local = item.local
        if (local != null) {
            data.putExtra(EXTRA_LOCAL, local.file.path).putExtra(EXTRA_IS_VIDEO, local.isVideo)
        } else {
            data.putExtra(EXTRA_URL, item.url ?: return)
        }
        setResult(RESULT_OK, data)
        finish()
    }

    private fun searchText() {
        val t = searchBox.text.toString().trim()
        if (t.isNotEmpty()) search("$t filetype:video $UHD")
    }

    // ---------- Moje stiahnuté ----------

    private fun showLocal() {
        requestId++
        currentQuery = null
        nextOffset = null
        loading = false
        spinner.visibility = View.GONE
        items.clear()
        for (l in WallpaperStore.library(this)) {
            items += Item(
                label = if (l.isVideo) "▶ video" else "GIF / obrázok",
                thumb = l.thumb.path.takeIf { l.thumb.exists() },
                local = l
            )
        }
        adapter.notifyDataSetChanged()
        info.text = if (items.isEmpty()) getString(R.string.my_empty) else "Podrž prst na položke = vymazať"
    }

    // ---------- Wikimedia Commons ----------

    private fun search(query: String) {
        currentQuery = query
        items.clear()
        adapter.notifyDataSetChanged()
        nextOffset = 0
        loading = false
        requestId++
        loadMore()
    }

    private fun loadMore() {
        val query = currentQuery ?: return
        val offset = nextOffset ?: return
        if (loading) return
        loading = true
        val myRequest = requestId
        spinner.visibility = View.VISIBLE
        info.text = ""
        net.execute {
            try {
                val (found, next) = fetch(query, offset)
                main.post {
                    if (myRequest != requestId) return@post
                    loading = false
                    spinner.visibility = View.GONE
                    items.addAll(found)
                    nextOffset = next
                    adapter.notifyDataSetChanged()
                    if (items.isEmpty()) {
                        when {
                            next != null && offset < 300 -> loadMore()
                            UHD in query -> search(query.replace(UHD, FHD)) // menej prísne
                            else -> info.setText(R.string.nothing_found)
                        }
                    }
                }
            } catch (e: Exception) {
                main.post {
                    if (myRequest != requestId) return@post
                    loading = false
                    spinner.visibility = View.GONE
                    info.text = getString(R.string.download_failed, e.message ?: "sieť")
                }
            }
        }
    }

    private fun fetch(query: String, offset: Int): Pair<List<Item>, Int?> {
        val url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2" +
            "&generator=search&gsrnamespace=6&gsrlimit=30&gsroffset=$offset" +
            "&gsrsearch=" + URLEncoder.encode(query, "UTF-8") +
            "&prop=videoinfo&viprop=url%7Csize%7Cmime%7Cderivatives&viurlwidth=480"
        val conn = Downloader.open(url)
        val body = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        conn.disconnect()

        val json = JSONObject(body)
        val next = json.optJSONObject("continue")?.optInt("gsroffset", -1)?.takeIf { it >= 0 }
        val pages = json.optJSONObject("query")?.optJSONArray("pages") ?: return emptyList<Item>() to next

        val list = ArrayList<Pair<Int, Item>>()
        for (i in 0 until pages.length()) {
            val p = pages.getJSONObject(i)
            val vi = (p.optJSONArray("videoinfo") ?: p.optJSONArray("imageinfo"))?.optJSONObject(0) ?: continue
            val item = toItem(vi) ?: continue
            list += p.optInt("index") to item
        }
        return list.sortedBy { it.first }.map { it.second } to next
    }

    /**
     * Pre videá neberieme originál (často obrovský alebo .ogv, ktorý Android
     * neprehrá), ale hotovú WebM verziu od Wikimedie v takom rozlíšení,
     * aké tento telefón zvládne.
     */
    private fun toItem(vi: JSONObject): Item? {
        val mime = vi.optString("mime")
        val thumb = vi.optString("thumburl").ifBlank { null }
        val w = vi.optInt("width")
        val h = vi.optInt("height")

        if (mime == "image/gif" || mime == "image/webp") {
            val mb = vi.optLong("size") / (1024.0 * 1024.0)
            return Item("GIF · ${w}×${h} · ${"%.0f".format(mb.coerceAtLeast(1.0))} MB", thumb, url = vi.optString("url"))
        }
        if (!mime.startsWith("video/") && mime != "application/ogg") return null

        var bestUrl: String? = null
        var bestShort = 0
        var bestScore = -1
        val ders = vi.optJSONArray("derivatives")
        if (ders != null) for (i in 0 until ders.length()) {
            val d = ders.getJSONObject(i)
            val type = d.optString("type")
            if (!type.startsWith("video/webm") && !type.startsWith("video/mp4")) continue
            val short = minOf(d.optInt("width"), d.optInt("height"))
            if (short <= 0 || short > maxShortSide) continue
            val score = short * 10 + if (type.contains("vp9")) 1 else 0
            if (score > bestScore) {
                bestScore = score; bestShort = short; bestUrl = d.optString("src")
            }
        }
        // bez prevodu: originál len ak je to webm/mp4 a telefón ho zvládne
        if (bestUrl.isNullOrBlank()) {
            if ((mime == "video/webm" || mime == "video/mp4") && minOf(w, h) <= maxShortSide) {
                bestUrl = vi.optString("url"); bestShort = minOf(w, h)
            } else return null
        }
        val res = when {
            bestShort >= 2160 -> "4K"
            bestShort >= 1440 -> "1440p"
            bestShort >= 1080 -> "1080p"
            else -> "${bestShort}p"
        }
        val src = if (minOf(w, h) >= 2160) " (4K zdroj)" else ""
        return Item("▶ $res$src", thumb, url = bestUrl)
    }

    // ---------- mriežka ----------

    private inner class ItemAdapter : BaseAdapter() {
        override fun getCount() = items.size
        override fun getItem(position: Int) = items[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
            val cell = (convertView as? FrameLayout) ?: FrameLayout(this@GalleryActivity).apply {
                layoutParams = AbsListView.LayoutParams(-1, dp(200))
                setBackgroundColor(Color.BLACK)
                addView(ImageView(context).apply {
                    id = android.R.id.icon
                    scaleType = ImageView.ScaleType.CENTER_CROP
                }, FrameLayout.LayoutParams(-1, -1))
                addView(TextView(context).apply {
                    id = android.R.id.text1
                    setTextColor(Color.WHITE)
                    textSize = 12f
                    setBackgroundColor(0x99000000.toInt())
                    setPadding(dp(6), dp(3), dp(6), dp(3))
                }, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
            }
            val item = items[position]
            val img = cell.findViewById<ImageView>(android.R.id.icon)
            cell.findViewById<TextView>(android.R.id.text1).text = item.label

            img.tag = item.thumb
            img.setImageBitmap(null)
            val t = item.thumb ?: return cell
            val cached = thumbs.get(t)
            if (cached != null) {
                img.setImageBitmap(cached)
            } else {
                net.execute {
                    val bmp = try {
                        if (t.startsWith("http")) {
                            val c = Downloader.open(t)
                            c.inputStream.use { BitmapFactory.decodeStream(it) }.also { c.disconnect() }
                        } else BitmapFactory.decodeFile(t)
                    } catch (_: Exception) { null }
                    if (bmp != null) {
                        thumbs.put(t, bmp)
                        main.post { if (img.tag == t) img.setImageBitmap(bmp) }
                    }
                }
            }
            return cell
        }
    }

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_LOCAL = "local"
        const val EXTRA_IS_VIDEO = "is_video"

        private const val UHD = "filew:>3839"
        private const val FHD = "filew:>1919"
        val PRESETS = listOf(
            "4K videá" to "filetype:video $UHD",
            "Príroda 4K" to "nature filetype:video $UHD",
            "Vesmír 4K" to "space filetype:video $UHD",
            "Oceán 4K" to "ocean filetype:video $UHD",
            "Mesto 4K" to "city filetype:video $UHD",
            "Full HD videá" to "filetype:video $FHD",
            "GIFy" to "animated filemime:image/gif filew:>700",
        )
    }
}
