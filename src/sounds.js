// Custom sounds: a `sounds` folder where the user can drop mp3 / wav / ogg files named after the event they replace.
// Anything missing, unreadable or too big is simply skipped and the app plays its built-in synthesized sound instead.
// On Windows the folder sits next to the app (the install folder); elsewhere it is in the app's data folder, because
// a macOS .app bundle must not be modified.
const fs = require('fs');
const path = require('path');

// max: the longest a sound may play, in seconds; longer files are cut off there.
const SOUNDS = [
  { name: 'startup', max: 5 },
  { name: 'shutdown', max: 3 },
  { name: 'login', max: 4 },
  { name: 'logoff', max: 3 },
  { name: 'message', max: 3 },
  { name: 'nudge', max: 1.5 },
];
const EXTS = ['.mp3', '.wav', '.ogg'];
const MAX_BYTES = 2 * 1024 * 1024;

let dir = null;

const maxOf = (name) => (SOUNDS.find((s) => s.name === name) || { max: 3 }).max;

function writable(d) {
  try {
    fs.mkdirSync(d, { recursive: true });
    const probe = path.join(d, '.write-test');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function guideText() {
  const rows = (tr) => SOUNDS.map((s) => {
    const when = {
      startup: tr ? 'Uygulama açılırken' : 'The app starts',
      shutdown: tr ? 'Uygulama kapanırken' : 'The app quits',
      login: tr ? 'Oturum açılırken' : 'You sign in',
      logoff: tr ? 'Oturum kapatılırken' : 'You sign out',
      message: tr ? 'Yeni ileti / bildirim' : 'A new message / notification',
      nudge: tr ? 'Titreşim' : 'A nudge',
    }[s.name];
    return `  ${s.name.padEnd(9)} ${String(s.max).padEnd(4)} ${when}`;
  }).join('\n');
  return `RETRO MESSENGER - CUSTOM SOUNDS
===============================

Put a sound file in this folder and the app plays it instead of the built-in sound.
Restart is not needed: files are read every time a sound plays.

FILE NAMES (extension: .mp3, .wav or .ogg - the name decides which sound it replaces)
  name      max s  played when
${rows(false)}
  Example: nudge.mp3, login.wav

FORMAT
  MP3  : 128 kbps CBR, 44.1 kHz, mono or stereo (anything from 96 to 320 kbps works)
  WAV  : PCM, 16-bit, 44.1 kHz, mono or stereo
  OGG  : Vorbis, about 128 kbps
LENGTH
  Keep each sound at or under the "max s" column. Longer files are cut off at that length.
SIZE
  At most 2 MB per file.

FALLBACK
  If a file is missing, empty, over 2 MB or can't be decoded, the app uses its built-in sound for
  that event. Delete a file to go back to the original sound. If you delete this whole folder, the
  app creates it again on the next start.

------------------------------------------------------------------------------------------

RETRO MESSENGER - ÖZEL SESLER
=============================

Bu klasöre bir ses dosyası koyarsanız uygulama yerleşik ses yerine onu çalar.
Yeniden başlatmak gerekmez: dosyalar her ses çalınırken okunur.

DOSYA ADLARI (uzantı: .mp3, .wav veya .ogg - hangi sesin değişeceğini dosya adı belirler)
  ad        en çok sn  ne zaman çalar
${rows(true)}
  Örnek: nudge.mp3, login.wav

BİÇİM
  MP3  : 128 kbps sabit hız (CBR), 44,1 kHz, mono ya da stereo (96 ile 320 kbps arası çalışır)
  WAV  : PCM, 16 bit, 44,1 kHz, mono ya da stereo
  OGG  : Vorbis, yaklaşık 128 kbps
SÜRE
  Her sesi "en çok sn" sütunundaki süreyi geçmeyecek şekilde hazırlayın. Daha uzun dosyalar o sürede kesilir.
BOYUT
  Dosya başına en fazla 2 MB.

YEDEK (FALLBACK)
  Dosya yoksa, boşsa, 2 MB'ı aşıyorsa ya da çözülemezse uygulama o olay için kendi yerleşik sesini
  çalar. Orijinal sese dönmek için dosyayı silmeniz yeterli. Bu klasörün tamamını silerseniz uygulama
  bir sonraki açılışta yeniden oluşturur.
`;
}

function writeGuide() {
  try {
    const file = path.join(dir, 'README.txt');
    const text = guideText().replace(/\r?\n/g, '\r\n');
    let current = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch { /* not there yet */ }
    if (current !== text) fs.writeFileSync(file, text);
  } catch { /* read-only folder: the guide is a nicety */ }
}

// Called once at startup, and again by dirPath() if the folder was deleted while the app runs.
function ensure(app) {
  if (!dir) {
    const next = path.join(path.dirname(process.execPath), 'sounds');
    dir = process.platform === 'win32' && app.isPackaged && writable(next) ? next : path.join(app.getPath('userData'), 'sounds');
  }
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* reported as "default" below */ }
  writeGuide();
  return dir;
}

const dirPath = () => dir;

// The file for a sound, matched case-insensitively ("Nudge.MP3" works), or null.
function find(name) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  for (const ext of EXTS) {
    const hit = names.find((n) => n.toLowerCase() === name + ext);
    if (!hit) continue;
    const p = path.join(dir, hit);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 0 && st.size <= MAX_BYTES) return p;
    } catch { /* try the next extension */ }
  }
  return null;
}

function read(name) {
  if (!SOUNDS.some((s) => s.name === name)) return null;
  const p = find(name);
  if (!p) return null;
  try { return { bytes: fs.readFileSync(p), max: maxOf(name), file: path.basename(p) }; } catch { return null; }
}

function list() {
  return SOUNDS.map((s) => {
    const p = find(s.name);
    return { name: s.name, max: s.max, file: p ? path.basename(p) : null };
  });
}

module.exports = { SOUNDS, ensure, dirPath, read, list, maxOf, guideText };
