# Alexia Live Tapeta

Android appka, ktorá nastaví **GIF alebo krátke video** ako živú tapetu na hlavnú obrazovku.

## Čo vie
- Vybrať GIF / video / obrázok z telefónu
- **Galéria 4K z webu** – voľne licencované 4K videá a GIFy z Wikimedia Commons (príroda, vesmír, oceán, mesto…), s hľadaním
- **Stiahnuť z webu cez yt-dlp** – TikTok, YouTube, Instagram, Reddit, X a 1000+ ďalších stránok, aj priame odkazy na GIF/MP4
- **yt-dlp sa aktualizuje sám** z GitHubu (pri spustení appky, max. raz za 6 h; podržaním tlačidla *Stiahnuť* vynútiš kontrolu)
- **Aktualizácie appky** – appka sama zistí novú verziu v Releases a ponúkne jej stiahnutie a inštaláciu (tlačidlo *Aktualizácie*)
- **Moja galéria** – všetko stiahnuté sa uloží do appky aj do galérie telefónu (Filmy/AlexiaTapeta)
- **TikTok** – vlož odkaz `vm.tiktok.com/…` alebo v TikToku daj *Zdieľať → Alexia Live Tapeta*
- **TikTok fotkové príspevky** – keď je v príspevku viac obrázkov, stiahnu sa všetky
- Zoznam „Moje TikToky a odkazy“ (pamätá si stiahnuté odkazy)
- Bez zvuku / so zvukom, vyplniť celú obrazovku alebo zobraziť celé
- Šetrí batériu – keď tapetu nevidno, prehrávanie sa pozastaví

## Stiahnutie APK
Každý push do `main` spustí GitHub Actions a všetko sa objaví v **Releases** (`AlexiaLiveTapeta-android.apk`).

Vyžaduje Android 9+.

## PC (Windows) a Linux
Priečinok `desktop/` – Electron appka s rovnakými funkciami:
- video / GIF ako živá tapeta **za ikonami na ploche** (Windows 10/11), na Linuxe ako okno plochy (X11: KDE, XFCE, Cinnamon, MATE, GNOME na Xorg; na Waylande cez XWayland, nie všade)
- viac monitorov, pauza z lišty, spustenie so systémom
- sťahovanie cez **yt-dlp** – stiahne sa z GitHubu pri prvom spustení a **sám sa aktualizuje** (pri štarte a potom každých 6 h)
- Moja galéria, Galéria 4K z webu, Moje odkazy

V **Releases** nájdeš `AlexiaLiveTapeta-windows-setup.exe`, `AlexiaLiveTapeta-windows-portable.exe`, `.AppImage` a `.deb`.
