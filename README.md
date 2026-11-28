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

## 🧝 Postavička na ploche (len PC – Windows)
V tapete (alebo v lište → *Postavička na ploche*) zapneš 3D postavičku, ktorá žije na tvojej ploche:
- **sedí na lište** alebo si **sadne na okno**, s ktorým práve pracuješ, nohy jej visia a hompáľajú sa; občas sa prejde
- **chytíš ju myšou a presunieš** – keď ju pustíš, spadne na lištu alebo na okno (z výšky sa naštve)
- **pohladkanie** = klik na ňu, **rozhovor** = dvojklik, **menu** = pravé tlačidlo
- **má náladu**: keď ju 15 minút ignoruješ, urazí sa a otočí sa chrbtom (pohladkaním jej to prejde), keď ju ťaháš, hnevá sa,
  v noci ťa posiela spať, komentuje, čo robíš (podľa názvu okna), sedá si naschvál na tvoje okno
- **tancuje na hudbu**: keď v PC hrá pesnička (YouTube, Spotify, hocičo), postaví sa a tancuje do rytmu (zvuk z PC sa len počúva
  kvôli rytmu, nikam sa neposiela ani neukladá); keď hudba stíchne, prestane – dá sa vypnúť v menu
- **skutočné tance (VRMA)**: v menu *Pridať tanec (.vrma)…* alebo *Priečinok s tancami* – pri hudbe si vyberie náhodný tanec
  a každých ~20 s ho vymení; bez tancov tancuje vlastnými pohybmi. Tance (VRM Animation) nájdeš napr. na BOOTH (booth.pm, hľadaj „VRMA“)
- nikdy nezatvára programy, nemaže súbory ani nehýbe kurzorom – zloba je len zábavná
- **postavy na výber** (3D VRM, CC0 od VRoid Project, stiahnu sa pri výbere): Shino, Sample E, F, G – alebo **vlastný VRM** (napr. z VRoid Hubu)
- **mozog**: Qwen3 4B Instruct (lokálne, ~2,5 GB, stiahne sa na požiadanie) – beží na **grafike (VRAM)**, keď nejde, na procesore;
  odpovedá po slovensky a ku každej odpovedi určí **emóciu** (radosť, nadšenie, hnev, krik, smútok, strach, prekvapenie, šepot, pohoda)
- **hlas**: Piper + **Kasandra** (český ženský hlas s emóciami, CC BY 4.0, autor Ondřej Šimek) – beží na **procesore (RAM)**;
  podľa emócie sa mení tempo, živosť, výška a hlasitosť; ústa sa hýbu podľa zvuku; tvár podľa emócie
