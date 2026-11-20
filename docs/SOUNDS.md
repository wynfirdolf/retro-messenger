# Custom sounds · Özel sesler

🇬🇧 English · [🇹🇷 Türkçe](#-türkçe)

Every sound in Retro Messenger can be replaced with your own file. Drop it into the `sounds` folder and it plays instead of the built-in sound. No restart needed: files are read every time a sound plays.

## Where is the folder?

Open **Settings → Sounds → Open sounds folder**. It is:

| System | Folder |
| --- | --- |
| Windows | `sounds` inside the install folder, usually `%LOCALAPPDATA%\Programs\retro-messenger\sounds` |
| macOS | `~/Library/Application Support/Retro Messenger/sounds` (an app bundle must not be modified, so it lives in the app's data folder) |

The app creates the folder, and a `README.txt` with this guide, on first start (and again if you delete it). Updates keep your files.

## File names

The **name** decides which sound a file replaces. The extension can be `.mp3`, `.wav` or `.ogg`; upper or lower case doesn't matter (`Nudge.MP3` works).

| File name | Played when | Max length |
| --- | --- | --- |
| `startup` | the app opens | 5 s |
| `shutdown` | the app quits (the app waits for it to finish) | 3 s |
| `login` | you sign in | 4 s |
| `logoff` | you sign out | 3 s |
| `message` | a new message or notification arrives | 3 s |
| `nudge` | a nudge is sent or received | 1.5 s |

Examples: `nudge.mp3`, `login.wav`, `startup.ogg`.

## Format

| Type | Settings |
| --- | --- |
| **MP3** | 128 kbps constant bitrate (CBR), 44.1 kHz, mono or stereo. Anything from 96 to 320 kbps works. |
| **WAV** | PCM, 16-bit, 44.1 kHz, mono or stereo |
| **OGG** | Vorbis, about 128 kbps |

- **Length:** keep each sound at or under the "Max length" above. A longer file is cut off at that length with a short fade-out.
- **Size:** at most 2 MB per file.
- **Volume:** the file plays at its own volume. Normalize it so it isn't louder than your other apps.

## Fallback

If a file is missing, empty, bigger than 2 MB, or can't be decoded, the app plays its **built-in sound** for that event instead. You can replace only the sounds you want. Delete a file to go back to the original sound. If you delete the whole folder, the app creates it again on the next start.

---

## 🇹🇷 Türkçe

Retro Messenger'daki her ses kendi dosyanla değiştirilebilir. Dosyayı `sounds` klasörüne at, yerleşik ses yerine o çalar. Yeniden başlatmak gerekmez: dosyalar her ses çalınırken okunur.

### Klasör nerede?

**Ayarlar → Sesler → Sesler klasörünü aç** ile açılır:

| Sistem | Klasör |
| --- | --- |
| Windows | Kurulum klasörünün içindeki `sounds`, genelde `%LOCALAPPDATA%\Programs\retro-messenger\sounds` |
| macOS | `~/Library/Application Support/Retro Messenger/sounds` (uygulama paketi değiştirilmemeli, bu yüzden uygulamanın veri klasöründe) |

Klasör ve bu rehberin kopyası olan `README.txt`, ilk açılışta (silersen yeniden) uygulama tarafından oluşturulur. Güncellemeler dosyalarını korur.

### Dosya adları

Hangi sesin değişeceğini dosyanın **adı** belirler. Uzantı `.mp3`, `.wav` ya da `.ogg` olabilir; büyük/küçük harf fark etmez (`Nudge.MP3` çalışır).

| Dosya adı | Ne zaman çalar | En uzun süre |
| --- | --- | --- |
| `startup` | uygulama açılırken | 5 sn |
| `shutdown` | uygulama kapanırken (uygulama bitmesini bekler) | 3 sn |
| `login` | oturum açarken | 4 sn |
| `logoff` | oturum kapatırken | 3 sn |
| `message` | yeni ileti ya da bildirim gelince | 3 sn |
| `nudge` | titreşim gönderilince ya da gelince | 1,5 sn |

Örnekler: `nudge.mp3`, `login.wav`, `startup.ogg`.

### Biçim

| Tür | Ayarlar |
| --- | --- |
| **MP3** | 128 kbps sabit bitrate (CBR), 44,1 kHz, mono ya da stereo. 96 ile 320 kbps arası her şey çalışır. |
| **WAV** | PCM, 16 bit, 44,1 kHz, mono ya da stereo |
| **OGG** | Vorbis, yaklaşık 128 kbps |

- **Süre:** her sesi yukarıdaki "En uzun süre"yi geçmeyecek şekilde hazırla. Daha uzun dosya o sürede kısa bir sesle kısılarak kesilir.
- **Boyut:** dosya başına en fazla 2 MB.
- **Ses seviyesi:** dosya kendi seviyesinde çalar. Diğer uygulamalardan yüksek olmasın diye normalleştir.

### Yedek (fallback)

Dosya yoksa, boşsa, 2 MB'tan büyükse ya da çözülemezse uygulama o olay için **yerleşik sesini** çalar. Sadece istediğin sesleri değiştirebilirsin. Orijinal sese dönmek için dosyayı sil. Klasörün tamamını silersen uygulama bir sonraki açılışta yeniden oluşturur.
