package com.alexia.livewallpaper

import android.app.Application
import android.os.Handler
import android.os.Looper
import android.widget.Toast

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        // Pri každom spustení (max. raz za 6 h) skontroluje novú verziu yt-dlp na GitHube
        Thread {
            val newVersion = YtDlp.autoUpdate(this)
            if (newVersion != null) {
                Handler(Looper.getMainLooper()).post {
                    Toast.makeText(this, "yt-dlp aktualizovaný na $newVersion", Toast.LENGTH_SHORT).show()
                }
            }
        }.start()
    }
}
