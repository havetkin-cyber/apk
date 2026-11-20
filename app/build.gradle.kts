plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.alexia.livewallpaper"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.alexia.livewallpaper"
        minSdk = 28
        targetSdk = 34
        versionCode = 2
        versionName = "2.0"

        // yt-dlp (Python) je natívna knižnica – len pre bežné mobily
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    // Pevný kľúč v repozitári, aby sa nové verzie z GitHubu dali
    // nainštalovať cez starú bez odinštalovania.
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // yt-dlp pre Android (Python + yt-dlp), aktualizuje sa z GitHubu za behu
    implementation("io.github.junkfood02.youtubedl-android:library:0.17.4")
}
