package com.alexia.livewallpaper

import android.app.Activity
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
 * Galéria voľne licencovaných 4K videí a GIFov z Wikimedia Commons
 * (bez API kľúča). Ťuknutím sa položka vráti do MainActivity na stiahnutie.
 */
class GalleryActivity : Activity() {

    data class Item(
        val title: String,
        val url: String,
        val thumb: String?,
        val width: Int,
        val height: Int,
        val bytes: Long,
        val isVideo: Boolean
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

    private var currentQuery = PRESETS[0].second
    private var nextOffset: Int? = null
    private var loading = false
    private var requestId = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        search(currentQuery)
    }

    override fun onDestroy() {
        net.shutdownNow()
        super.onDestroy()
    }

    // ---------- UI (bez XML, nech je to v jednom súbore) ----------

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

        // vyhľadávanie
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

        // rýchle kategórie
        val chips = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
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
            setOnItemClickListener { _, _, pos, _ ->
                val it = items[pos]
                setResult(RESULT_OK, Intent().putExtra(EXTRA_URL, it.url))
                finish()
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

    private fun searchText() {
        val t = searchBox.text.toString().trim()
        if (t.isNotEmpty()) search("$t filetype:video filew:>1919")
    }

    // ---------- načítanie z Wikimedia Commons ----------

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
        val offset = nextOffset ?: return
        if (loading) return
        loading = true
        val myRequest = requestId
        spinner.visibility = View.VISIBLE
        info.text = ""
        val query = currentQuery
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
                        if (next != null) loadMore() else info.setText(R.string.nothing_found)
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
        val url = "https://commons.wikimedia.org/w/api.php?action=query&format=json" +
            "&generator=search&gsrnamespace=6&gsrlimit=30&gsroffset=$offset" +
            "&gsrsearch=" + URLEncoder.encode(query, "UTF-8") +
            "&prop=imageinfo&iiprop=url%7Csize%7Cmime&iiurlwidth=480"
        val conn = Downloader.open(url)
        val body = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        conn.disconnect()

        val json = JSONObject(body)
        val next = json.optJSONObject("continue")?.optInt("gsroffset", -1)?.takeIf { it >= 0 }
        val pages = json.optJSONObject("query")?.optJSONObject("pages") ?: return emptyList<Item>() to next

        val list = ArrayList<Pair<Int, Item>>()
        val keys = pages.keys()
        while (keys.hasNext()) {
            val p = pages.getJSONObject(keys.next())
            val ii = p.optJSONArray("imageinfo")?.optJSONObject(0) ?: continue
            val mime = ii.optString("mime")
            if (mime !in SUPPORTED_MIME) continue // napr. .ogv Android neprehrá
            list += p.optInt("index") to Item(
                title = p.optString("title").removePrefix("File:"),
                url = ii.optString("url"),
                thumb = ii.optString("thumburl").ifBlank { null },
                width = ii.optInt("width"),
                height = ii.optInt("height"),
                bytes = ii.optLong("size"),
                isVideo = mime.startsWith("video/")
            )
        }
        return list.sortedBy { it.first }.map { it.second } to next
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
            val label = cell.findViewById<TextView>(android.R.id.text1)

            val res = when {
                item.width >= 3840 -> "4K"
                item.width >= 2560 -> "2K"
                item.width >= 1920 -> "Full HD"
                else -> "${item.width}×${item.height}"
            }
            val kind = if (item.isVideo) "▶ video" else "GIF"
            val mb = item.bytes / (1024.0 * 1024.0)
            label.text = "$kind · $res · ${"%.0f".format(mb.coerceAtLeast(1.0))} MB"

            img.tag = item.thumb
            img.setImageBitmap(null)
            val t = item.thumb ?: return cell
            val cached = thumbs.get(t)
            if (cached != null) {
                img.setImageBitmap(cached)
            } else {
                net.execute {
                    val bmp = try {
                        val c = Downloader.open(t)
                        c.inputStream.use { BitmapFactory.decodeStream(it) }.also { c.disconnect() }
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

        private const val UHD = "filew:>3839"
        val PRESETS = listOf(
            "4K videá" to "filetype:video $UHD",
            "Príroda 4K" to "nature filetype:video $UHD",
            "Vesmír 4K" to "space filetype:video $UHD",
            "Oceán 4K" to "ocean filetype:video $UHD",
            "Mesto 4K" to "city filetype:video $UHD",
            "Full HD videá" to "filetype:video filew:>1919",
            "GIFy" to "animated filemime:image/gif filew:>700",
        )

        private val SUPPORTED_MIME = setOf("video/webm", "video/mp4", "image/gif", "image/webp")
    }
}
